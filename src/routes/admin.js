const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    const adminEmails = ['disgollc@gmail.com', 'mkdave27@gmail.com'];
    if (!adminEmails.includes(req.user.email)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
};

// Get all bars
router.get('/bars', isAdmin, async (req, res) => {
    try {
        const querySnapshot = await db.collection('accounts').get();
        
        // Get bars with user counts
        const barsPromises = querySnapshot.docs.map(async doc => {
            // Get user count for this bar
            const usersSnapshot = await doc.ref.collection('users').count().get();
            const userCount = usersSnapshot.data().count;

            return {
                id: doc.id,
                ...doc.data(),
                barName: doc.data().barName || 'Unnamed Bar',
                slug: doc.data().slug || doc.id,
                userCount: userCount || 0
            };
        });

        const bars = await Promise.all(barsPromises);
        res.json(bars);
    } catch (error) {
        console.error('Error fetching bars:', error);
        res.status(500).json({ error: 'Failed to fetch bars' });
    }
});

// Create new bar
router.post('/bars', isAdmin, async (req, res) => {
    try {
        const { 
            barName, 
            messagingProfileId, 
            phoneNumber, 
            email,
            includeMembershipQuestion 
        } = req.body;
        
        if (!barName) {
            return res.status(400).json({ error: 'Bar name is required' });
        }

        // Create slug from bar name
        const slug = barName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        
        // Check if slug exists
        const slugCheck = await db.collection('accounts')
            .where('slug', '==', slug)
            .get();
            
        if (!slugCheck.empty) {
            return res.status(400).json({ error: 'A bar with a similar name already exists' });
        }

        // Create document data with only defined values
        const barData = {
            barName,
            slug,
            signupEnabled: true,
            includeMembershipQuestion: includeMembershipQuestion || false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Only add optional fields if they are defined and not empty
        if (messagingProfileId) barData.messagingProfileId = messagingProfileId;
        if (phoneNumber) barData.phoneNumber = phoneNumber;
        if (email) barData.email = email;

        // Create new bar document
        const barRef = await db.collection('accounts').add(barData);

        res.status(201).json({
            id: barRef.id,
            ...barData
        });
    } catch (error) {
        console.error('Error creating bar:', error);
        res.status(500).json({ error: 'Failed to create bar' });
    }
});

// Update bar
router.put('/bars/:id', isAdmin, async (req, res) => {
    try {
        const barId = req.params.id;
        const updateData = req.body;
        
        // Remove any undefined or null values
        Object.keys(updateData).forEach(key => 
            (updateData[key] === undefined || updateData[key] === null) && delete updateData[key]
        );
        
        // Add updated timestamp
        updateData.updatedAt = new Date().toISOString();
        
        // If barName is being updated, update the slug too
        if (updateData.barName) {
            updateData.slug = updateData.barName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            
            // Check if new slug would conflict with existing bar
            const slugCheck = await db.collection('accounts')
                .where('slug', '==', updateData.slug)
                .get();
                
            if (!slugCheck.empty && slugCheck.docs[0].id !== barId) {
                return res.status(400).json({ error: 'A bar with a similar name already exists' });
            }
        }

        // Update the bar
        const barRef = db.collection('accounts').doc(barId);
        await barRef.update(updateData);
        
        // Get the updated document
        const updatedBar = await barRef.get();
        
        if (!updatedBar.exists) {
            return res.status(404).json({ error: 'Bar not found' });
        }
        
        res.json({
            id: updatedBar.id,
            ...updatedBar.data()
        });
    } catch (error) {
        console.error('Error updating bar:', error);
        res.status(500).json({ error: 'Failed to update bar' });
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