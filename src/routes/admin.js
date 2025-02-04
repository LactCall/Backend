const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    const adminEmails = ['disgollc@gmail.com', 'manankdave1999@gmail.com'];
    if (!adminEmails.includes(req.user.email)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
};

// Get all bars
router.get('/bars', isAdmin, async (req, res) => {
    try {
        const querySnapshot = await db.collection('accounts').get();
        const bars = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            barName: doc.data().barName || 'Unnamed Bar',
            slug: doc.data().slug || doc.id
        }));
        res.json(bars);
    } catch (error) {
        console.error('Error fetching bars:', error);
        res.status(500).json({ error: 'Failed to fetch bars' });
    }
});

// Create new bar
router.post('/bars', isAdmin, async (req, res) => {
    try {
        const { barName, messagingServiceSID, phoneNumber } = req.body;
        
        // Create slug from bar name
        const slug = barName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        
        // Check if slug exists
        const slugCheck = await db.collection('accounts')
            .where('slug', '==', slug)
            .get();
            
        if (!slugCheck.empty) {
            return res.status(400).json({ error: 'A bar with a similar name already exists' });
        }

        // Create new bar document
        const barRef = await db.collection('accounts').add({
            barName,
            messagingServiceSID,
            phoneNumber,
            slug,
            signupEnabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        res.status(201).json({
            id: barRef.id,
            barName,
            messagingServiceSID,
            phoneNumber,
            slug
        });
    } catch (error) {
        console.error('Error creating bar:', error);
        res.status(500).json({ error: 'Failed to create bar' });
    }
});

// Delete bar
router.delete('/bars/:id', isAdmin, async (req, res) => {
    try {
        await db.collection('accounts').doc(req.params.id).delete();
        res.json({ message: 'Bar deleted successfully' });
    } catch (error) {
        console.error('Error deleting bar:', error);
        res.status(500).json({ error: 'Failed to delete bar' });
    }
});

module.exports = router; 