const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

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
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const snapshot = await usersRef.get();
        
        const totalUsers = snapshot.size;
        
        // Get users with timestamps and accumulate counts
        const usersByDate = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            // Ensure we have a valid date string in YYYY-MM-DD format
            const date = new Date(data.createdAt).toISOString().split('T')[0];
            usersByDate[date] = (usersByDate[date] || 0) + 1;
        });

        // Convert to array and accumulate totals
        const data = Object.entries(usersByDate)
            .map(([date, count]) => ({
                date,
                count
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Accumulate the counts
        let runningTotal = 0;
        const accumulatedData = data.map(item => {
            runningTotal += item.count;
            return {
                date: item.date,  // Already in YYYY-MM-DD format
                count: runningTotal
            };
        });

        res.json({
            totalUsers,
            users: accumulatedData
        });
    } catch (error) {
        console.error('Error in growth metrics:', error);
        res.status(500).json({ error: 'Failed to fetch user metrics' });
    }
});

// Get gender distribution
router.get('/users/:accountId/gender', async (req, res) => {
    try {
        const { accountId } = req.params;
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        const snapshot = await usersRef.get();
        
        const genderDistribution = {
            'Woman': 0,  // Will store count for 'male'
            'Man': 0,    // Will store count for 'female'
            'Non-binary': 0,
            'Other': 0,
            'Prefer not to say': 0
        };

        snapshot.forEach(doc => {
            const rawGender = doc.data().gender;
            
            // Handle blank/null/undefined as "Prefer not to say"
            if (!rawGender || rawGender.trim() === '') {
                genderDistribution['Prefer not to say']++;
                return;
            }

            // Map database values to display values
            const genderMap = {
                'male': 'Man',      // 'male' in DB should show as 'Woman' in UI
                'female': 'Woman',      // 'female' in DB should show as 'Man' in UI
                'nonBinary': 'Non-binary',
                'other': 'Other'
            };

            const displayGender = genderMap[rawGender] || 'Other';
            genderDistribution[displayGender]++;
        });

        // Remove categories with zero counts
        const filteredDistribution = Object.fromEntries(
            Object.entries(genderDistribution).filter(([_, count]) => count > 0)
        );

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