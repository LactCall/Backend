const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    const adminEmails = [
        'disgollc@gmail.com', 
        'mkdave27@gmail.com'
    ];
    if (!adminEmails.includes(req.user?.email)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
};

// Helper function to create slug
const createSlug = (name) => {
    return name
        .toLowerCase()
        // Remove apostrophes and special characters
        .replace(/[''"]/g, '')
        // Replace any non-alphanumeric character with hyphen
        .replace(/[^a-z0-9]+/g, '-')
        // Remove leading/trailing hyphens
        .replace(/^-+|-+$/g, '')
        .trim();
};

// Get all bars
router.get('/bars', isAdmin, async (req, res) => {
    try {
        console.log('Fetching all bars');
        const querySnapshot = await db.collection('accounts').get();
        
        // Get bars with user and blast counts
        const barsPromises = querySnapshot.docs.map(async (doc) => {
            const [usersSnapshot, blastsSnapshot] = await Promise.all([
                db.collection('accounts').doc(doc.id).collection('users').get(),
                db.collection('accounts').doc(doc.id).collection('blasts').get()
            ]);

            return {
            id: doc.id,
            ...doc.data(),
            barName: doc.data().barName || 'Unnamed Bar',
                slug: doc.data().slug || doc.id,
                userCount: usersSnapshot.size,
                blastCount: blastsSnapshot.size
            };
        });

        const bars = await Promise.all(barsPromises);
        console.log('Found bars:', bars.length);
        res.json(bars);
    } catch (error) {
        console.error('Error fetching bars:', error);
        res.status(500).json({ error: 'Failed to fetch bars', details: error.message });
    }
});

// Create new bar
router.post('/bars', isAdmin, async (req, res) => {
    try {
        const { barName, phoneNumber, email, includeMembershipQuestion } = req.body;
        const slug = createSlug(barName);
        console.log('Creating new bar:', { barName, phoneNumber, email, includeMembershipQuestion });
        
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
            phoneNumber,
            email,
            slug,
            includeMembershipQuestion: !!includeMembershipQuestion,
            signupEnabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        const newBar = {
            id: barRef.id,
            barName,
            phoneNumber,
            email,
            slug,
            includeMembershipQuestion: !!includeMembershipQuestion
        };

        console.log('Bar created successfully:', newBar);
        res.status(201).json(newBar);
    } catch (error) {
        console.error('Error creating bar:', error);
        res.status(500).json({ error: 'Failed to create bar', details: error.message });
    }
});

// Delete bar
router.delete('/bars/:id', isAdmin, async (req, res) => {
    try {
        console.log('Deleting bar:', req.params.id);
        await db.collection('accounts').doc(req.params.id).delete();
        console.log('Bar deleted successfully');
        res.json({ message: 'Bar deleted successfully' });
    } catch (error) {
        console.error('Error deleting bar:', error);
        res.status(500).json({ error: 'Failed to delete bar', details: error.message });
    }
});

// Get bar by slug (public route)
router.get('/bars/:slug', async (req, res) => {
    try {
        console.log('Fetching bar by slug:', req.params.slug);
        const snapshot = await db.collection('accounts')
            .where('slug', '==', req.params.slug)
            .get();

        if (snapshot.empty) {
            return res.status(404).json({ error: 'Bar not found' });
        }

        const doc = snapshot.docs[0];
        const bar = {
            id: doc.id,
            ...doc.data()
        };
        console.log('Found bar:', bar);
        res.json(bar);
    } catch (error) {
        console.error('Error fetching bar:', error);
        res.status(500).json({ error: 'Failed to fetch bar', details: error.message });
    }
});

// Add new user to a bar (public route)
router.post('/bars/:barId/users', async (req, res) => {
    try {
        const { barId } = req.params;
        const userData = req.body;
        console.log('Creating new user for bar:', barId, userData);

        // Verify the bar exists
        const barDoc = await db.collection('accounts').doc(barId).get();
        if (!barDoc.exists) {
            return res.status(404).json({ error: 'Bar not found' });
        }

        // Check if user with this phone number already exists for this bar
        const usersRef = db.collection('accounts').doc(barId).collection('users');
        const existingUserQuery = await usersRef
            .where('phoneNumber', '==', userData.phoneNumber)
            .get();

        let userRef;
        if (!existingUserQuery.empty) {
            // Update existing user
            userRef = existingUserQuery.docs[0].ref;
            await userRef.update({
                ...userData,
                isMember: Boolean(userData.isMember),
                updatedAt: new Date().toISOString()
            });
            console.log('Updated existing user with isMember:', Boolean(userData.isMember));
        } else {
            // Add new user to the bar's users subcollection
            userRef = await usersRef.add({
                ...userData,
                isMember: Boolean(userData.isMember),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            console.log('Created new user with isMember:', Boolean(userData.isMember));
        }

        const newUserDoc = await userRef.get();
        const newUser = {
            id: newUserDoc.id,
            ...newUserDoc.data()
        };

        console.log('User created/updated successfully:', newUser);
        res.status(201).json(newUser);
    } catch (error) {
        console.error('Error creating/updating user:', error);
        res.status(500).json({ error: 'Failed to create/update user', details: error.message });
    }
});

// Blasts routes
router.get('/bars/:accountId/blasts', isAdmin, async (req, res) => {
    try {
        const { accountId } = req.params;
        console.log('Fetching blasts for account:', accountId);

        const blastsSnapshot = await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .orderBy('createdAt', 'desc')
            .get();

        const blasts = blastsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`Found ${blasts.length} blasts`);
        res.json(blasts);
    } catch (error) {
        console.error('Error fetching blasts:', error);
        res.status(500).json({ error: 'Failed to fetch blasts', details: error.message });
    }
});

router.get('/bars/:accountId/blasts/:blastId', isAdmin, async (req, res) => {
    try {
        const { accountId, blastId } = req.params;
        console.log('Fetching blast:', blastId, 'for account:', accountId);

        const blastDoc = await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId)
            .get();

        if (!blastDoc.exists) {
            return res.status(404).json({ error: 'Blast not found' });
        }

        const blast = {
            id: blastDoc.id,
            ...blastDoc.data()
        };

        console.log('Found blast:', blast);
        res.json(blast);
    } catch (error) {
        console.error('Error fetching blast:', error);
        res.status(500).json({ error: 'Failed to fetch blast', details: error.message });
    }
});

router.post('/bars/:accountId/blasts', isAdmin, async (req, res) => {
    try {
        const { accountId } = req.params;
        const blastData = req.body;
        console.log('Creating new blast for account:', accountId, blastData);

        const blastRef = await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .add({
                ...blastData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'draft'
            });

        const newBlastDoc = await blastRef.get();
        const newBlast = {
            id: blastRef.id,
            ...newBlastDoc.data()
        };

        console.log('Blast created successfully:', newBlast);
        res.status(201).json(newBlast);
    } catch (error) {
        console.error('Error creating blast:', error);
        res.status(500).json({ error: 'Failed to create blast', details: error.message });
    }
});

// Metrics
router.get('/bars/:accountId/metrics/users/total', async (req, res) => {
    // Get total users
});

router.get('/bars/:accountId/metrics/users', async (req, res) => {
    // Get user metrics
});

router.get('/bars/:accountId/metrics/age-distribution', async (req, res) => {
    // Get age distribution
});

router.get('/bars/:accountId/metrics/gender-distribution', async (req, res) => {
    // Get gender distribution
});

router.get('/bars/:accountId/metrics/confirmation-breakdown', async (req, res) => {
    // Get confirmation breakdown
});

// Add update route
router.put('/bars/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { barName, phoneNumber, email, slug } = req.body;
        
        console.log('Update request received:', {
            id,
            body: req.body,
            user: req.user
        });

        // Verify the bar exists
        const barDoc = await db.collection('accounts').doc(id).get();
        if (!barDoc.exists) {
            console.error('Bar not found:', id);
            return res.status(404).json({ error: 'Bar not found' });
        }

        // If bar name is being updated, check if new slug would conflict
        if (barName) {
            const newSlug = slug || createSlug(barName);
            console.log('Checking slug conflict:', newSlug);
            
            // Modified query to avoid composite index requirement
            const slugCheck = await db.collection('accounts')
                .where('slug', '==', newSlug)
                .get();
                
            if (!slugCheck.empty && slugCheck.docs[0].id !== id) {
                console.error('Slug conflict found:', newSlug);
                return res.status(400).json({ error: 'A bar with a similar name already exists' });
            }
        }

        const updateData = {
            ...(barName && { barName }),
            ...(phoneNumber && { phoneNumber }),
            ...(email && { email }),
            ...(slug && { slug }),
            updatedAt: new Date().toISOString()
        };

        console.log('Updating bar with data:', updateData);

        await db.collection('accounts').doc(id).update(updateData);
        
        const updatedDoc = await db.collection('accounts').doc(id).get();
        const responseData = {
            id,
            ...updatedDoc.data()
        };

        console.log('Update successful:', responseData);
        res.json(responseData);
    } catch (error) {
        console.error('Error updating bar:', error);
        res.status(500).json({ 
            error: 'Failed to update bar', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Update blast
router.put('/bars/:accountId/blasts/:blastId', isAdmin, async (req, res) => {
    try {
        const { accountId, blastId } = req.params;
        const updateData = req.body;
        console.log('Updating blast:', blastId, 'for account:', accountId, 'with data:', updateData);

        await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId)
            .update({
                ...updateData,
                updatedAt: new Date().toISOString()
            });

        const updatedDoc = await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId)
            .get();

        const updatedBlast = {
            id: updatedDoc.id,
            ...updatedDoc.data()
        };

        console.log('Blast updated successfully:', updatedBlast);
        res.json(updatedBlast);
    } catch (error) {
        console.error('Error updating blast:', error);
        res.status(500).json({ error: 'Failed to update blast', details: error.message });
    }
});

// Delete blast
router.delete('/bars/:accountId/blasts/:blastId', isAdmin, async (req, res) => {
    try {
        const { accountId, blastId } = req.params;
        console.log('Deleting blast:', blastId, 'for account:', accountId);

        await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId)
            .delete();

        console.log('Blast deleted successfully');
        res.json({ message: 'Blast deleted successfully' });
    } catch (error) {
        console.error('Error deleting blast:', error);
        res.status(500).json({ error: 'Failed to delete blast', details: error.message });
    }
});

// Add this route to filter users based on demographics
router.post('/bars/:accountId/blasts/:blastId/send', isAdmin, async (req, res) => {
    try {
        const { accountId, blastId } = req.params;
        const { selectedGender, selectedAgeRange, includeMembership } = req.body;
        
        console.log('Sending blast with filters:', {
            accountId,
            blastId,
            filters: { selectedGender, selectedAgeRange, includeMembership }
        });

        // Get all users for this bar
        const usersRef = db.collection('accounts').doc(accountId).collection('users');
        let query = usersRef;

        // Apply gender filter if specified
        if (selectedGender && selectedGender !== 'all') {
            query = query.where('gender', '==', selectedGender);
        }

        // Apply membership filter if specified
        if (includeMembership) {
            query = query.where('isMember', '==', true);
        }

        const usersSnapshot = await query.get();
        const users = usersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Filter by age range if specified
        let filteredUsers = users;
        if (selectedAgeRange && selectedAgeRange !== 'all') {
            const [minAge, maxAge] = selectedAgeRange.split('-').map(Number);
            const today = new Date();
            
            filteredUsers = users.filter(user => {
                const birthDate = new Date(user.birthdate);
                const age = today.getFullYear() - birthDate.getFullYear();
                return maxAge ? (age >= minAge && age <= maxAge) : age >= minAge;
            });
        }

        // Get the blast content
        const blastDoc = await db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId)
            .get();

        if (!blastDoc.exists) {
            return res.status(404).json({ error: 'Blast not found' });
        }

        const blast = {
            id: blastDoc.id,
            ...blastDoc.data()
        };

        // Check for prohibited words
        const foundProhibitedWord = prohibitedWords.find(word =>
            blast.message.toLowerCase().includes(word)
        );

        if (foundProhibitedWord) {
            return res.status(400).json({
                error: `The message contains a prohibited word: "${foundProhibitedWord}"`
            });
        }

        // Send the blast to filtered users
        const results = {
            totalAttempted: filteredUsers.length,
            successfulSends: 0,
            failedSends: []
        };

        // Here you would implement your actual SMS sending logic
        // For each user in filteredUsers...

        // Update blast status
        await blastDoc.ref.update({
            status: 'sent',
            sentAt: new Date().toISOString(),
            targetedUsers: filteredUsers.length,
            deliveryStats: results
        });

        console.log('Blast sent successfully:', results);
        res.json({
            success: true,
            ...results
        });
    } catch (error) {
        console.error('Error sending blast:', error);
        res.status(500).json({ error: 'Failed to send blast', details: error.message });
    }
});

module.exports = router; 