const express = require('express');
const router = express.Router();
const dotenv = require('dotenv');
dotenv.config();

const { db } = require('../config/firebase');

// Initialize Telnyx client
const Telnyx = require('telnyx');
const telnyxClient = Telnyx(process.env.TELNYX_API_KEY);

// Get all blasts for an account
router.get('/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        console.log('Fetching blasts for accountId:', accountId);

        // Use the correct subcollection path
        const blastsRef = db.collection('accounts').doc(accountId).collection('blasts');
        console.log('Created blasts reference');

        const snapshot = await blastsRef
            .orderBy('createdAt', 'desc')
            .get();

        console.log('Query executed, snapshot empty?', snapshot.empty);
        console.log('Snapshot size:', snapshot.size);

        const blasts = [];
        snapshot.forEach(doc => {
            console.log('Processing doc:', doc.id);
            console.log('Doc data:', doc.data());
            blasts.push({
                id: doc.id,
                ...doc.data()
            });
        });

        console.log('Final blasts array:', blasts);
        res.json(blasts);
    } catch (error) {
        console.error('Error getting blasts:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to get blasts', details: error.message });
    }
});

// Get sent blasts for an account
router.get('/:accountId/sent', async (req, res) => {
    try {
        const { accountId } = req.params;
        console.log('Fetching sent blasts for accountId:', accountId);

        // Use the correct subcollection path
        const blastsRef = db.collection('accounts').doc(accountId).collection('blasts');
        const snapshot = await blastsRef
            .where('status', '==', 'sent')
            .orderBy('sentAt', 'desc')
            .get();

        console.log('Sent blasts snapshot size:', snapshot.size);

        const sentBlasts = [];
        snapshot.forEach(doc => {
            console.log('Processing sent blast doc:', doc.id);
            sentBlasts.push({
                id: doc.id,
                ...doc.data()
            });
        });

        console.log('Final sent blasts array:', sentBlasts);
        res.json(sentBlasts);
    } catch (error) {
        console.error('Error getting sent blasts:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to get sent blasts', details: error.message });
    }
});

// Create a new blast
router.post('/', async (req, res) => {
    try {
        const { accountId, message, scheduledDate } = req.body;
        console.log('Creating new blast:', { accountId, message, scheduledDate });
        
        // Create blast object with required fields
        const newBlast = {
            message,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Only add scheduledDate if it's provided
        if (scheduledDate) {
            newBlast.scheduledDate = scheduledDate;
        }

        // Use the correct subcollection path
        const docRef = await db.collection('accounts').doc(accountId).collection('blasts').add(newBlast);
        console.log('Blast created with ID:', docRef.id);
        
        res.status(201).json({
            id: docRef.id,
            ...newBlast
        });
    } catch (error) {
        console.error('Error creating blast:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to create blast', details: error.message });
    }
});

// Update a blast
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { accountId } = req.body;
        console.log('Updating blast:', id, 'for account:', accountId);

        if (!accountId) {
            throw new Error('accountId is required in the request body');
        }

        const updateData = {
            ...req.body,
            updatedAt: new Date()
        };
        delete updateData.accountId; // Remove accountId from the update data

        // Use the correct subcollection path
        await db.collection('accounts').doc(accountId).collection('blasts').doc(id).update(updateData);
        console.log('Blast updated successfully');
        
        res.json({ id, ...updateData });
    } catch (error) {
        console.error('Error updating blast:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to update blast', details: error.message });
    }
});

// Delete a blast
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { accountId } = req.query; // Get accountId from query parameters
        console.log('Deleting blast:', id, 'for account:', accountId);

        if (!accountId) {
            throw new Error('accountId is required as a query parameter');
        }

        // Use the correct subcollection path
        await db.collection('accounts').doc(accountId).collection('blasts').doc(id).delete();
        console.log('Blast deleted successfully');

        res.json({ message: 'Blast deleted successfully' });
    } catch (error) {
        console.error('Error deleting blast:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to delete blast', details: error.message });
    }
});

// Send a blast to all users
router.post('/:id/send', async (req, res) => {
    try {
        const { id } = req.params;
        const { accountId, filters } = req.body;

        if (!accountId) {
            throw new Error('accountId is required');
        }

        // Get the blast message
        const blastRef = db.collection('accounts').doc(accountId).collection('blasts').doc(id);
        const blastDoc = await blastRef.get();
        
        if (!blastDoc.exists) {
            throw new Error('Blast not found');
        }

        const blast = blastDoc.data();

        // Get account details including messagingProfileId
        const accountDoc = await db.collection('accounts').doc(accountId).get();
        const accountData = accountDoc.data();
        
        // Check for messaging profile ID
        const messagingProfileId = accountData.messagingProfileId;
        if (!messagingProfileId) {
            throw new Error('Messaging Profile ID not configured for this account');
        }

        // Get Telnyx number from .env
        const telnyxNumber = accountData.phoneNumber;
        if (!telnyxNumber) {
            throw new Error('Telnyx number not configured in environment variables');
        }

        // Build query for users based on filters
        let usersQuery = db.collection('accounts')
            .doc(accountId)
            .collection('users')
            .where('consent', '==', true)
            .where('subscribe', '==', true);

        // Apply gender filter if specified
        if (filters?.selectedGenders && filters.selectedGenders.length > 0) {
            if (!filters.selectedGenders.includes('all')) {
                usersQuery = usersQuery.where('gender', 'in', filters.selectedGenders);
            }
        }

        // Apply age range filter if specified
        if (filters?.ageRange && filters.ageRange !== 'all') {
            usersQuery = usersQuery.where('ageRange', '==', filters.ageRange);
        }

        // Apply membership filter if specified
        if (filters?.membershipStatus && filters.membershipStatus !== 'all') {
            usersQuery = usersQuery.where('membershipStatus', '==', filters.membershipStatus);
        }

        // Execute the query
        const usersSnapshot = await usersQuery.get();
        const users = [];
        usersSnapshot.forEach(doc => users.push({
            id: doc.id,
            ...doc.data()
        }));

        // Log the filters and matched users for debugging
        console.log('Sending blast with filters:', {
            filters,
            matchedUsers: users.length
        });

        // If no users match the criteria, return early
        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No users match the selected criteria'
            });
        }

        // Send messages using Telnyx with messaging profile
        const promises = [];
        const results = [];

        users.forEach(user => {
            try {
                console.log(`Preparing to send to ${user.phoneNumber} using profile ${messagingProfileId}`);
                
                const messagePromise = telnyxClient.messages.create({
                    to: user.phoneNumber,
                    from: telnyxNumber,
                    text: blast.message,
                    messaging_profile_id: messagingProfileId
                }).then(messageResponse => {
                    console.log('Message sent successfully:', {
                        userId: user.id,
                        phoneNumber: user.phoneNumber,
                        messageId: messageResponse.data.id,
                        status: messageResponse.data.to?.[0]?.status,
                        carrier: messageResponse.data.to?.[0]?.carrier
                    });
                    results.push({ 
                        success: true, 
                        phoneNumber: user.phoneNumber,
                        messageId: messageResponse.data.id,
                        status: messageResponse.data.to?.[0]?.status
                    });
                }).catch(error => {
                    console.error(`Failed to send to ${user.phoneNumber}:`, {
                        error: error.message,
                        code: error.code,
                        details: error.details
                    });
                    results.push({ 
                        success: false, 
                        phoneNumber: user.phoneNumber,
                        error: error.message 
                    });
                });

                promises.push(messagePromise);
            } catch (error) {
                console.error(`Failed to create promise for ${user.phoneNumber}:`, error);
                results.push({ 
                    success: false, 
                    phoneNumber: user.phoneNumber,
                    error: error.message 
                });
            }
        });

        // Wait for all messages to be sent
        await Promise.all(promises);

        // Process results
        const successfulSends = results.filter(r => r.success).length;
        const failedSends = results.filter(r => !r.success).map(failure => ({
            phoneNumber: failure.phoneNumber,
            error: failure.error || 'Unknown error'
        }));

        // Update blast status
        await blastRef.update({
            status: 'sent',
            dateSent: new Date().toISOString(),
            successfulSends,
            failedSends: failedSends.length > 0 ? failedSends : [],
            recipientCount: users.length,
            messagingProfileId, // Store which profile was used
            updatedAt: new Date().toISOString()
        });

        res.json({
            success: true,
            totalAttempted: users.length,
            successfulSends,
            failedSends,
            messagingProfileId
        });

    } catch (error) {
        console.error('Error sending blast:', error);
        res.status(500).json({ error: 'Failed to send blast' });
    }
});

// Add this new endpoint for testing the filtered count
router.post('/test-count', async (req, res) => {
    try {
        const { accountId, filters } = req.body;

        if (!accountId) {
            throw new Error('accountId is required');
        }

        // Build query for users based on filters
        let usersQuery = db.collection('accounts')
            .doc(accountId)
            .collection('users')
            .where('consent', '==', true);

        // Apply gender filter if specified
        if (filters?.selectedGenders && filters.selectedGenders.length > 0) {
            // If we're not selecting all genders, apply the filter
            if (!filters.selectedGenders.includes('all')) {
                usersQuery = usersQuery.where('gender', 'in', filters.selectedGenders);
            }
        }

        // Apply age range filter if specified
        if (filters?.ageRange && filters.ageRange !== 'all') {
            usersQuery = usersQuery.where('ageRange', '==', filters.ageRange);
        }

        // Apply membership filter if specified
        if (filters?.membershipStatus && filters.membershipStatus !== 'all') {
            usersQuery = usersQuery.where('membershipStatus', '==', filters.membershipStatus);
        }

        // Get the actual users that match the criteria
        const usersSnapshot = await usersQuery.get();
        const matchedUsers = usersSnapshot.size;

        console.log('Filtered users count:', {
            filters,
            matchedUsers
        });

        res.json({ 
            success: true,
            matchedUsers
        });
    } catch (error) {
        console.error('Error testing filtered count:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to test user count', 
            details: error.message 
        });
    }
});

module.exports = router; 