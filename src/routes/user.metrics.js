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
        
        // Get total count
        const totalUsers = snapshot.size;
        
        // Get users with timestamps and accumulate counts
        const usersByDate = {};
        snapshot.forEach(doc => {
            const data = doc.data();
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
                date: item.date,
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
            'Male': 0,
            'Female': 0,
            'Other': 0,
            'Prefer not to answer': 0
        };

        snapshot.forEach(doc => {
            const rawGender = doc.data().gender;
            
            // Handle blank/null/undefined as "Prefer not to answer"
            if (!rawGender || rawGender.trim() === '') {
                genderDistribution['Prefer not to answer']++;
                return;
            }

            // Normalize gender to capitalize first letter
            const normalizedGender = rawGender.toLowerCase().charAt(0).toUpperCase() + 
                                   rawGender.toLowerCase().slice(1);

            // Map to one of our categories
            if (['Male', 'Female'].includes(normalizedGender)) {
                genderDistribution[normalizedGender]++;
            } else {
                genderDistribution['Other']++;
            }
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
        
        const ageDistribution = {
            '21-25': 0,
            '26-30': 0,
            '31-35': 0,
            '36-40': 0,
            '40+': 0,
            'unspecified': 0
        };

        snapshot.forEach(doc => {
            const birthdate = doc.data().birthdate;
            if (!birthdate) {
                ageDistribution.unspecified++;
                return;
            }

            const age = calculateAge(birthdate);
            if (age <= 25) ageDistribution['21-25']++;
            else if (age <= 30) ageDistribution['26-30']++;
            else if (age <= 35) ageDistribution['31-35']++;
            else if (age <= 40) ageDistribution['36-40']++;
            else ageDistribution['40+']++;
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

module.exports = router; 