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
        
        // Get users with timestamps for growth data
        const users = [];
        snapshot.forEach(doc => {
            users.push({
                id: doc.id,
                createdAt: doc.data().createdAt
            });
        });

        res.json({
            totalUsers,
            users
        });
    } catch (error) {
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
            male: 0,
            female: 0,
            other: 0,
            unspecified: 0
        };

        snapshot.forEach(doc => {
            const gender = doc.data().gender?.toLowerCase() || 'unspecified';
            genderDistribution[gender]++;
        });

        res.json({ gender_distribution: genderDistribution });
    } catch (error) {
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