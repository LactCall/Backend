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
        
        // Get current total user count first
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const totalUsersSnapshot = await usersRef.count().get();
        const totalUsers = totalUsersSnapshot.data().count;
        
        // Try to call the Cloud Function to update metrics, but don't wait for it
        try {
            const processUserMetrics = httpsCallable(functions, 'get_user_metrics');
            processUserMetrics({ accountId }).catch(err => {
                console.warn('Background metrics update failed:', err.message);
            });
        } catch (fnError) {
            console.warn('Failed to call metrics function:', fnError.message);
            // Continue with the request even if the function call fails
        }
        
        // Get the user_growth document from metrics collection
        const metricsRef = db.collection('accounts')
            .doc(accountId)
            .collection('metrics')
            .doc('user_growth');
        
        const metricsDoc = await metricsRef.get();
        
        if (!metricsDoc.exists) {
            // Even if we don't have historical data, we can return current count
            return res.json({
                totalUsers,
                users: [{
                    date: new Date().toISOString().split('T')[0],
                    count: totalUsers
                }]
            });
        }

        const growthData = metricsDoc.data();
        console.log('Raw growth data:', growthData);

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
        console.error('Error in growth metrics:', error);
        res.status(500).json({ 
            error: 'Failed to fetch user metrics',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get gender distribution
router.get('/users/:accountId/gender', async (req, res) => {
    try {
        const { accountId } = req.params;
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const snapshot = await usersRef.get();
        
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
        const snapshot = await usersRef.get();
        
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