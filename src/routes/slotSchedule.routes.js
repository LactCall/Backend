const express = require('express');
const router = express.Router();
const { saveScheduledBlast, getScheduledBlasts } = require('../services/schedulingService');

// Schedule a blast
router.post('/schedule/:accountId/:blastId', async (req, res) => {
    try {
        const { accountId, blastId } = req.params;
        const { scheduledDate } = req.body;

        if (!scheduledDate) {
            return res.status(400).json({
                success: false,
                message: 'Scheduled date is required'
            });
        }

        // Determine time slot based on hour
        const hour = new Date(scheduledDate).getHours();
        let timeSlot = 'afternoon'; // default
        if (hour < 12) {
            timeSlot = 'morning';
        } else if (hour >= 17) {
            timeSlot = 'evening';
        }

        // Save the scheduled blast
        const result = await saveScheduledBlast(accountId, blastId, {
            scheduledDate,
            timeSlot
        });

        res.json(result);

    } catch (error) {
        console.error('Error scheduling blast:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to schedule blast',
            error: error.message
        });
    }
});

// Get all scheduled blasts for an account
router.get('/scheduled/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const scheduledBlasts = await getScheduledBlasts(accountId);
        res.json(scheduledBlasts);
    } catch (error) {
        console.error('Error fetching scheduled blasts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch scheduled blasts',
            error: error.message
        });
    }
});

module.exports = router; 