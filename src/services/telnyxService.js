const telnyx = require('telnyx');
const { db } = require('../config/firebase');

// Initialize Telnyx client
const telnyxClient = telnyx(process.env.TELNYX_API_KEY);

/**
 * Send a message using Telnyx
 * @param {string} to - Recipient phone number
 * @param {string} from - Sender phone number
 * @param {string} text - Message text
 * @param {string} messagingProfileId - Telnyx messaging profile ID
 * @returns {Promise} - Promise that resolves when message is sent
 */
const sendMessage = async (to, from, text, messagingProfileId) => {
    try {
        const message = await telnyxClient.messages.create({
            from,
            to,
            text,
            messaging_profile_id: messagingProfileId
        });
        return message;
    } catch (error) {
        console.error('Error sending message via Telnyx:', error);
        throw error;
    }
};

module.exports = {
    sendMessage
}; 