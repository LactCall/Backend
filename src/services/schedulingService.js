const { db } = require('../config/firebase');

/**
 * Saves a scheduled blast to Firebase
 * @param {string} accountId - The account ID
 * @param {string} blastId - The blast ID
 * @param {Object} scheduleData - The scheduling data
 * @param {string} scheduleData.scheduledDate - ISO string of scheduled date
 * @param {string} scheduleData.timeSlot - Time slot (morning, afternoon, evening)
 * @returns {Promise} - Promise that resolves when the data is saved
 */
const saveScheduledBlast = async (accountId, blastId, scheduleData) => {
    try {
        const blastRef = db.collection('accounts')
            .doc(accountId)
            .collection('blasts')
            .doc(blastId);

        // Get the current blast data
        const blastDoc = await blastRef.get();
        if (!blastDoc.exists) {
            throw new Error('Blast not found');
        }

        // Update the blast with scheduling information
        await blastRef.update({
            status: 'scheduled',
            scheduledDate: scheduleData.scheduledDate,
            timeSlot: scheduleData.timeSlot,
            scheduledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        // Also store in a separate schedules collection for easier querying
        const scheduleRef = db.collection('accounts')
            .doc(accountId)
            .collection('schedules')
            .doc(blastId);

        await scheduleRef.set({
            blastId,
            scheduledDate: scheduleData.scheduledDate,
            timeSlot: scheduleData.timeSlot,
            message: blastDoc.data().message,
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        return {
            success: true,
            message: 'Blast scheduled successfully'
        };
    } catch (error) {
        console.error('Error saving scheduled blast:', error);
        throw error;
    }
};

/**
 * Gets all scheduled blasts for an account
 * @param {string} accountId - The account ID
 * @returns {Promise<Array>} - Promise that resolves to array of scheduled blasts
 */
const getScheduledBlasts = async (accountId) => {
    try {
        const schedulesRef = db.collection('accounts')
            .doc(accountId)
            .collection('schedules')
            .where('status', '==', 'pending');

        const snapshot = await schedulesRef.get();
        const schedules = [];

        snapshot.forEach(doc => {
            schedules.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return schedules;
    } catch (error) {
        console.error('Error getting scheduled blasts:', error);
        throw error;
    }
};

/**
 * Updates the status of a scheduled blast
 * @param {string} accountId - The account ID
 * @param {string} blastId - The blast ID
 * @param {string} status - The new status
 * @returns {Promise} - Promise that resolves when the status is updated
 */
const updateScheduleStatus = async (accountId, blastId, status) => {
    try {
        const scheduleRef = db.collection('accounts')
            .doc(accountId)
            .collection('schedules')
            .doc(blastId);

        await scheduleRef.update({
            status,
            updatedAt: new Date().toISOString()
        });

        // Also update the blast status if needed
        if (status === 'completed' || status === 'failed') {
            const blastRef = db.collection('accounts')
                .doc(accountId)
                .collection('blasts')
                .doc(blastId);

            await blastRef.update({
                status: status === 'completed' ? 'sent' : 'failed',
                updatedAt: new Date().toISOString()
            });
        }

        return {
            success: true,
            message: `Schedule status updated to ${status}`
        };
    } catch (error) {
        console.error('Error updating schedule status:', error);
        throw error;
    }
};

module.exports = {
    saveScheduledBlast,
    getScheduledBlasts,
    updateScheduleStatus
}; 