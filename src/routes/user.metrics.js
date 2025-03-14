const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { getFunctions, httpsCallable } = require('firebase-admin/functions');

const functions = getFunctions();

// Get bar data with user count
router.get('/bar/:id', async (req, res) => {
    try {
        const barId = req.params.id;
        const accountRef = db.collection('accounts').doc(barId);
        const accountDoc = await accountRef.get();

        if (!accountDoc.exists) {
            return res.status(404).json({ error: 'Bar not found' });
        }

        const usersSnapshot = await accountRef.collection('users').count().get();
        const userCount = usersSnapshot.data().count;

        res.json({
            ...accountDoc.data(),
            userCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get bar metrics' });
    }
});

// Get user metrics (total count, growth over time)
router.get('/users/:accountId/growth', async (req, res) => {
    try {
        const { accountId } = req.params;
        
        // Get current total user count first - only count users who have given consent
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const totalUsersSnapshot = await usersRef.where('subscribed', '==', true).count().get();
        const totalUsers = totalUsersSnapshot.data().count;
        
        // Get all subscribed users to calculate metrics
        const usersSnapshot = await usersRef.where('subscribed', '==', true).get();
        
        // Initialize metrics structures
        const userGrowthMetrics = {
            total_users: totalUsers,
            per_day: {},
            per_month: {},
            last_updated: new Date().toISOString()
        };
        
        const genderDistributionMetrics = {
            gender_distribution: {},
            last_updated: new Date().toISOString()
        };
        
        const ageDistributionMetrics = {
            age_distribution: {},
            last_updated: new Date().toISOString()
        };
        
        // Process each user to build metrics
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            
            // Process creation date for daily/monthly metrics
            if (userData.createdAt) {
                let creationDate;
                
                // Handle different timestamp formats
                if (userData.createdAt instanceof Date) {
                    creationDate = userData.createdAt;
                } else if (userData.createdAt._seconds) {
                    // Firestore Timestamp
                    creationDate = new Date(userData.createdAt._seconds * 1000);
                } else if (typeof userData.createdAt === 'string') {
                    creationDate = new Date(userData.createdAt);
                }
                
                if (creationDate && !isNaN(creationDate.getTime())) {
                    // Format dates
                    const dayStr = creationDate.toISOString().split('T')[0]; // YYYY-MM-DD
                    const monthStr = dayStr.substring(0, 7); // YYYY-MM
                    
                    // Increment daily and monthly counts
                    userGrowthMetrics.per_day[dayStr] = (userGrowthMetrics.per_day[dayStr] || 0) + 1;
                    userGrowthMetrics.per_month[monthStr] = (userGrowthMetrics.per_month[monthStr] || 0) + 1;
                }
            }
            
            // Process gender distribution
            if (userData.gender) {
                const gender = String(userData.gender).toLowerCase();
                genderDistributionMetrics.gender_distribution[gender] = (genderDistributionMetrics.gender_distribution[gender] || 0) + 1;
            } else {
                genderDistributionMetrics.gender_distribution['unknown'] = (genderDistributionMetrics.gender_distribution['unknown'] || 0) + 1;
            }
            
            // Process age distribution
            if (userData.birthdate) {
                let birthDate;
                
                // Handle different timestamp formats
                if (userData.birthdate instanceof Date) {
                    birthDate = userData.birthdate;
                } else if (userData.birthdate._seconds) {
                    birthDate = new Date(userData.birthdate._seconds * 1000);
                } else if (typeof userData.birthdate === 'string') {
                    birthDate = new Date(userData.birthdate);
                }
                
                if (birthDate && !isNaN(birthDate.getTime())) {
                    const today = new Date();
                    const age = today.getFullYear() - birthDate.getFullYear();
                    
                    // Group ages into ranges
                    let ageRange;
                    if (age < 18) ageRange = 'under_18';
                    else if (age < 25) ageRange = '18-24';
                    else if (age < 35) ageRange = '25-34';
                    else if (age < 45) ageRange = '35-44';
                    else if (age < 55) ageRange = '45-54';
                    else ageRange = '55_plus';
                    
                    ageDistributionMetrics.age_distribution[ageRange] = (ageDistributionMetrics.age_distribution[ageRange] || 0) + 1;
                }
            }
        });
        
        // Convert counts to cumulative totals for growth metrics
        const dates = Object.keys(userGrowthMetrics.per_day).sort();
        let runningTotal = 0;
        
        for (const date of dates) {
            runningTotal += userGrowthMetrics.per_day[date];
            userGrowthMetrics.per_day[date] = runningTotal;
        }
        
        const months = Object.keys(userGrowthMetrics.per_month).sort();
        runningTotal = 0;
        
        for (const month of months) {
            runningTotal += userGrowthMetrics.per_month[month];
            userGrowthMetrics.per_month[month] = runningTotal;
        }
        
        // Save the updated metrics to their respective documents
        const metricsRef = db.collection('accounts').doc(accountId).collection('metrics');
        
        // Update user_growth document
        await metricsRef.doc('user_growth').set(userGrowthMetrics, { merge: true });
        
        // Update gender_distribution document
        await metricsRef.doc('gender_distribution').set(genderDistributionMetrics, { merge: true });
        
        // Update age_distribution document
        await metricsRef.doc('age_distribution').set(ageDistributionMetrics, { merge: true });
        
        console.log('Updated all metrics documents directly in API call');
        
        // Continue with your existing code to format and return the data
        const growthData = userGrowthMetrics;
        
        // Always get a year's worth of data
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        
        // Convert per_day map to sorted array of data points
        const perDayEntries = Object.entries(growthData.per_day || {})
            .map(([date, count]) => ({
                date,
                count: Number(count)
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
            
        // Generate continuous date range with proper counts
        const data = [];
        const currentDate = new Date(startDate);
        const endDate = new Date();
        let lastKnownCount = 0;
        
        // Find the last known count before the start date
        for (const entry of perDayEntries) {
            if (new Date(entry.date) <= startDate) {
                lastKnownCount = entry.count;
            } else {
                break;
            }
        }
        
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            
            // Find the actual count for this date if it exists
            const dayData = perDayEntries.find(entry => entry.date === dateStr);
            
            if (dayData) {
                lastKnownCount = dayData.count;
            }
            
            data.push({
                date: dateStr,
                count: lastKnownCount
            });
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Make sure the latest data point has the current total
        if (data.length > 0) {
            data[data.length - 1].count = totalUsers;
        }
        
        console.log('Processed data:', {
            totalUsers,
            dataPoints: data.length,
            firstPoint: data[0],
            lastPoint: data[data.length - 1]
        });
        
        res.json({
            totalUsers,
            users: data
        });
    } catch (error) {
        console.error('Error processing user metrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get gender distribution
router.get('/users/:accountId/gender', async (req, res) => {
    try {
        const { accountId } = req.params;
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const snapshot = await usersRef.where('subscribed', '==', true).get();
        
        // Initialize with the exact categories from the signup form
        const genderDistribution = {
            'Man': 0,
            'Woman': 0,
            'Non-binary': 0,
            'Other': 0,
            'Prefer not to say': 0
        };

        // Map database values to display labels (case-insensitive)
        const genderMap = {
            'male': 'Man',
            'man': 'Man',
            'm': 'Man',
            
            'female': 'Woman',
            'woman': 'Woman',
            'f': 'Woman',
            
            'nonbinary': 'Non-binary',
            'non-binary': 'Non-binary',
            'nonBinary': 'Non-binary',
            'nb': 'Non-binary',
            
            'other': 'Other',
            'o': 'Other',
            
            '': 'Prefer not to say',
            'prefer not to say': 'Prefer not to say',
            'not specified': 'Prefer not to say',
            'unspecified': 'Prefer not to say'
        };

        // Log raw gender values for debugging
        console.log('Raw gender values:', snapshot.docs.map(doc => doc.data().gender));

        snapshot.forEach(doc => {
            let rawGender = doc.data().gender;
            
            // Handle null/undefined values
            if (rawGender === null || rawGender === undefined) {
                genderDistribution['Prefer not to say']++;
                return;
            }
            
            // Convert to string and normalize to lowercase for case-insensitive matching
            rawGender = String(rawGender).toLowerCase().trim();
            
            // Map the gender value to our display categories
            if (rawGender in genderMap) {
                genderDistribution[genderMap[rawGender]]++;
            } else {
                // Try to match with our predefined categories directly
                const matchedCategory = Object.keys(genderDistribution).find(
                    category => category.toLowerCase() === rawGender
                );
                
                if (matchedCategory) {
                    genderDistribution[matchedCategory]++;
                } else {
                    // If it's not in our map, count as "Prefer not to say"
                    genderDistribution['Prefer not to say']++;
                    console.log(`Unmapped gender value: "${rawGender}" counted as "Prefer not to say"`);
                }
            }
        });

        // Remove categories with zero counts
        const filteredDistribution = Object.fromEntries(
            Object.entries(genderDistribution).filter(([_, count]) => count > 0)
        );

        console.log('Processed gender distribution:', filteredDistribution);
        
        res.json({ gender_distribution: filteredDistribution });
    } catch (error) {
        console.error('Error fetching gender distribution:', error);
        res.status(500).json({ error: 'Failed to fetch gender distribution' });
    }
});

// Get age distribution
router.get('/users/:accountId/age', async (req, res) => {
    try {
        const { accountId } = req.params;
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const snapshot = await usersRef.where('subscribed', '==', true).get();
        
        const ageDistribution = {};

        snapshot.forEach(doc => {
            const birthdate = doc.data().birthdate;
            if (!birthdate) {
                ageDistribution.unspecified = (ageDistribution.unspecified || 0) + 1;
                return;
            }

            const age = calculateAge(birthdate);
            if (age >= 21) {
                if (age >= 65) {
                    ageDistribution["65+"] = (ageDistribution["65+"] || 0) + 1;
                } else {
                    ageDistribution[age.toString()] = (ageDistribution[age.toString()] || 0) + 1;
                }
            }
        });

        res.json({ age_distribution: ageDistribution });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch age distribution' });
    }
});

function calculateAge(birthdate) {
    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

// Get confirmation breakdown metrics
router.get('/users/:accountId/confirmation-breakdown', async (req, res) => {
    try {
        const { accountId } = req.params;
        const metricsRef = db.collection('accounts')
                            .doc(accountId)
                            .collection('metrics')
                            .doc('confirmation_breakdown');
        
        const doc = await metricsRef.get();

        if (!doc.exists) {
            // Update default structure to match expected format
            return res.json({
                birthdateMissing: 0,
                overTwentyOne: 0,
                underTwentyOne: 0,
                timestamp: new Date().toISOString()
            });
        }

        res.json(doc.data());
    } catch (error) {
        console.error('Error fetching confirmation breakdown:', error);
        res.status(500).json({ 
            error: 'Failed to fetch confirmation breakdown',
            details: error.message 
        });
    }
});

module.exports = router; 