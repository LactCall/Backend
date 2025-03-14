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
            .where('consent', '==', true);

        // Apply gender filter if specified
        if (filters?.selectedGenders && !filters.selectedGenders.includes('all')) {
            usersQuery = usersQuery.where('gender', 'in', filters.selectedGenders);
        }

        // Get all matching users first (we'll filter by age after)
        const usersSnapshot = await usersQuery.get();
        const users = [];

        // Calculate age and apply filters
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            console.log('Processing user:', {
                id: doc.id,
                hasPhoneNumber: !!userData.phoneNumber,
                hasBirthdate: !!userData.birthdate,
                birthdate: userData.birthdate,
                gender: userData.gender,
                membershipStatus: userData.membershipStatus
            });
            
            // Skip users without phone numbers
            if (!userData.phoneNumber) {
                console.log('Skipping user - no phone number');
                return;
            }

            // Apply age filter if specified
            if (filters?.ageRange && filters.ageRange !== 'all') {
                const birthdate = userData.birthdate;
                if (!birthdate) {
                    console.log('Skipping user - no birthdate');
                    return;
                }

                console.log('Calculating age for birthdate:', birthdate);

                // Calculate age
                const today = new Date();
                const birth = new Date(birthdate);
                const age = today.getFullYear() - birth.getFullYear();
                console.log('Calculated age:', age);

                // Parse age range
                if (filters.ageRange.endsWith('+')) {
                    // Handle ranges like "41+"
                    const minAge = parseInt(filters.ageRange);
                    console.log(`Checking if age ${age} >= ${minAge}`);
                    if (age < minAge) {
                        console.log('Skipping user - age below minimum');
                        return;
                    }
                } else {
                    // Handle ranges like "21-25"
                    const [minAge, maxAge] = filters.ageRange.split('-').map(Number);
                    console.log(`Checking if age ${age} is between ${minAge} and ${maxAge}`);
                    if (age < minAge || age > maxAge) {
                        console.log('Skipping user - age outside range');
                        return;
                    }
                }
                console.log('User passed age filter');
            }

            // Apply membership filter if specified
            if (filters?.membershipStatus && filters.membershipStatus !== 'all') {
                if (userData.membershipStatus !== filters.membershipStatus) {
                    console.log('Skipping user - membership status mismatch');
                    return;
                }
                console.log('User passed membership filter');
            }

            console.log('User matched all criteria - adding to recipients list');
            users.push(userData);
        });

        console.log('Final filtering results:', {
            totalUsers: usersSnapshot.size,
            matchedUsers: users.length,
            filters: {
                genders: filters?.selectedGenders,
                ageRange: filters?.ageRange,
                membershipStatus: filters?.membershipStatus
            }
        });

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No users match the specified targeting criteria'
            });
        }

        console.log(`Sending blast to ${users.length} filtered users. Filters:`, {
            gender: filters?.selectedGenders,
            ageRange: filters?.ageRange,
            membershipStatus: filters?.membershipStatus,
            matchedUsers: users.length
        });

        // Send messages using Telnyx with messaging profile
        const promises = [];
        const results = [];

        users.forEach(user => {
            try {
                console.log(`Preparing to send to ${user.phoneNumber} using profile ${messagingProfileId}`);
                
                if (!isValidPhoneNumber(user.phoneNumber)) {
                    console.error(`Invalid phone number: ${user.phoneNumber}`);
                    results.push({
                        success: false,
                        phoneNumber: user.phoneNumber,
                        error: 'Invalid phone number'
                    });
                    return;
                }
                
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
        res.status(500).json({ 
            success: false, 
            error: 'Failed to send blast', 
            details: error.message 
        });
    }
});

// Add this new endpoint for testing the filtered count
router.post('/test-count', async (req, res) => {
    try {
        const { accountId, filters } = req.body;

        if (!accountId) {
            throw new Error('accountId is required');
        }

        console.log('Testing count with filters:', filters);

        // Build query for users based on filters
        let usersQuery = db.collection('accounts')
            .doc(accountId)
            .collection('users')
            .where('consent', '==', true);

        // Apply gender filter if specified
        if (filters?.selectedGenders && !filters.selectedGenders.includes('all')) {
            usersQuery = usersQuery.where('gender', 'in', filters.selectedGenders);
        }

        // Get all matching users first (we'll filter by age after)
        const usersSnapshot = await usersQuery.get();
        const users = [];

        // Calculate age and apply filters
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            console.log('Testing user:', {
                id: doc.id,
                hasPhoneNumber: !!userData.phoneNumber,
                hasBirthdate: !!userData.birthdate,
                birthdate: userData.birthdate,
                gender: userData.gender
            });

            // Skip users without phone numbers
            if (!userData.phoneNumber) {
                console.log('Skipping user in count - no phone number');
                return;
            }

            // Apply age filter if specified
            if (filters?.ageRange && filters.ageRange !== 'all') {
                const birthdate = userData.birthdate;
                if (!birthdate) {
                    console.log('Skipping user in count - no birthdate');
                    return;
                }

                // Calculate age
                const today = new Date();
                const birth = new Date(birthdate);
                const age = today.getFullYear() - birth.getFullYear();
                console.log('Test count - calculated age:', age);

                // Parse age range
                if (filters.ageRange.endsWith('+')) {
                    // Handle ranges like "41+"
                    const minAge = parseInt(filters.ageRange);
                    if (age < minAge) {
                        console.log('Skipping user in count - age below minimum');
                        return;
                    }
                } else {
                    // Handle ranges like "21-25"
                    const [minAge, maxAge] = filters.ageRange.split('-').map(Number);
                    if (age < minAge || age > maxAge) {
                        console.log('Skipping user in count - age outside range');
                        return;
                    }
                }
            }

            // Apply membership filter if specified
            if (filters?.membershipStatus && filters.membershipStatus !== 'all') {
                if (userData.membershipStatus !== filters.membershipStatus) {
                    console.log('Skipping user in count - membership status mismatch');
                    return;
                }
            }

            users.push(userData);
        });

        console.log('Test count results:', {
            totalUsers: usersSnapshot.size,
            matchedUsers: users.length,
            filters
        });

        res.json({ 
            success: true,
            matchedUsers: users.length
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

function isValidPhoneNumber(phoneNumber) {
    // Example regex for validating US phone numbers (adjust as needed for your use case)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
    return phoneRegex.test(phoneNumber);
}
module.exports = router; 