const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { db } = require('../config/firebase');
const { sendMessage } = require('./telnyxService');

dayjs.extend(utc);
dayjs.extend(timezone);

// Define when each time slot messages will be sent
const TIME_SLOTS = {
    morning: { hour: 10, minute: 0 },    // 10:00 AM EST
    afternoon: { hour: 15, minute: 0 },   // 3:00 PM EST
    evening: { hour: 20, minute: 0 }      // 8:00 PM EST
};

/**
 * Process scheduled blasts for a specific time slot
 */
const processScheduledBlasts = async (timeSlot) => {
    try {
        // Get current date in EST
        const now = dayjs().tz("America/New_York");
        const today = now.format('YYYY-MM-DD');
        
        console.log(`Processing ${timeSlot} blasts for ${today}`);
        
        // First get all accounts
        const accountsSnapshot = await db.collection('accounts').get();
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;

        // Process each account's blasts
        for (const accountDoc of accountsSnapshot.docs) {
            const accountId = accountDoc.id;

            // Query for scheduled blasts that match timeSlot and today's date
            const scheduledBlastsRef = db.collection('accounts')
                .doc(accountId)
                .collection('blasts')
                .where('status', '==', 'scheduled')
                .where('timeSlot', '==', timeSlot);
            
            const snapshot = await scheduledBlastsRef.get();

            if (snapshot.empty) {
                continue;
            }

            // Process each blast
            for (const doc of snapshot.docs) {
                const blast = { id: doc.id, ...doc.data(), accountId };
                const blastDate = dayjs(blast.scheduledDate).tz("America/New_York").format('YYYY-MM-DD');
                
                // Only process if date matches today
                if (blastDate === today) {
                    console.log(`Found ${timeSlot} blast ${blast.id} scheduled for today`);
                    
                    try {
                        const result = await sendScheduledBlast(blast);
                        totalProcessed++;
                        totalSuccessful += result.successCount;
                        totalFailed += result.failureCount;
                    } catch (error) {
                        console.error(`Failed to process blast ${blast.id}:`, error);
                        totalProcessed++;
                        totalFailed++;
                    }
                }
            }
        }

        if (totalProcessed > 0) {
            console.log(`${timeSlot.charAt(0).toUpperCase() + timeSlot.slice(1)} Blast Summary:
                Total Blasts Processed: ${totalProcessed}
                Total Messages Successful: ${totalSuccessful}
                Total Messages Failed: ${totalFailed}
            `);
        } else {
            console.log(`No ${timeSlot} blasts found for today (${today})`);
        }
    } catch (error) {
        console.error(`Error processing ${timeSlot} blasts:`, error);
    }
};

/**
 * Send a scheduled blast
 * @returns {Promise<{successCount: number, failureCount: number}>}
 */
const sendScheduledBlast = async (blast) => {
    try {
        console.log(`Sending scheduled blast: ${blast.id}`);
        
        // Get account details
        const accountDoc = await db.collection('accounts').doc(blast.accountId).get();
        if (!accountDoc.exists) {
            throw new Error('Account not found');
        }
        
        const account = accountDoc.data();
        const accountId = accountDoc.id;
        if (!account.messagingProfileId || !account.phoneNumber) {
            throw new Error('Account missing Telnyx configuration');
        }

        // Get all users for this account
        const usersRef = db.collection('accounts')
            .doc(accountId)
            .collection('users')
            .where('consent', '==', true)
            .where('subscribe', '==', true);
        
        const users = await usersRef.get();
        console.log(`Found ${users.size} total users`);

        let successCount = 0;
        let failureCount = 0;
        const failedNumbers = [];

        // Send messages to all users with phone numbers
        for (const userDoc of users.docs) {
            const user = userDoc.data();
            if (!user.phoneNumber) {
                console.log(`Skipping user without phone number: ${user.name}`);
                continue;
            }

            try {
                await sendMessage(
                    user.phoneNumber,
                    account.phoneNumber,
                    blast.message,
                    account.messagingProfileId
                );
                successCount++;
                console.log(`Successfully sent message to ${user.name} (${user.phoneNumber})`);
            } catch (error) {
                console.error(`Failed to send message to ${user.phoneNumber}:`, error);
                failureCount++;
                failedNumbers.push(user.phoneNumber);
            }
        }

        // Update blast status in the correct collection path
        await db.collection('accounts')
            .doc(blast.accountId)
            .collection('blasts')
            .doc(blast.id)
            .update({
                status: 'sent',
                sentAt: dayjs().tz("America/New_York").toISOString(),
                deliveryStats: {
                    totalAttempted: successCount + failureCount,
                    failedSends: failedNumbers
                },
                successfulSends: successCount,
                recipientCount: successCount
            });

        console.log(`Blast ${blast.id} sent successfully to ${successCount} users with ${failureCount} failures`);
        return { successCount, failureCount };
    } catch (error) {
        console.error(`Error sending scheduled blast ${blast.id}:`, error);
        await db.collection('accounts')
            .doc(blast.accountId)
            .collection('blasts')
            .doc(blast.id)
            .update({
                status: 'failed',
                error: error.message
            });
        throw error;
    }
};

// Initialize the scheduler to run at specified times
const initializeScheduler = () => {
    // Schedule jobs for each time slot
    const morningSchedule = `${TIME_SLOTS.morning.minute} ${TIME_SLOTS.morning.hour} * * *`;
    const afternoonSchedule = `${TIME_SLOTS.afternoon.minute} ${TIME_SLOTS.afternoon.hour} * * *`;
    const eveningSchedule = `${TIME_SLOTS.evening.minute} ${TIME_SLOTS.evening.hour} * * *`;
    
    // Morning schedule (10:10 AM EST)
    cron.schedule(morningSchedule, async () => {
        await processScheduledBlasts('morning');
    }, {
        timezone: "America/New_York"
    });

    // Afternoon schedule (3:00 PM EST)
    cron.schedule(afternoonSchedule, async () => {
        await processScheduledBlasts('afternoon');
    }, {
        timezone: "America/New_York"
    });

    // Evening schedule (5:00 PM EST)
    cron.schedule(eveningSchedule, async () => {
        await processScheduledBlasts('evening');
    }, {
        timezone: "America/New_York"
    });

    console.log('Blast scheduler initialized for the following times (EST):');
    console.log(`- Morning: ${TIME_SLOTS.morning.hour}:${TIME_SLOTS.morning.minute.toString().padStart(2, '0')}`);
    console.log(`- Afternoon: ${TIME_SLOTS.afternoon.hour}:${TIME_SLOTS.afternoon.minute.toString().padStart(2, '0')}`);
    console.log(`- Evening: ${TIME_SLOTS.evening.hour}:${TIME_SLOTS.evening.minute.toString().padStart(2, '0')}`);
};

module.exports = {
    initializeScheduler,
    processScheduledBlasts
};