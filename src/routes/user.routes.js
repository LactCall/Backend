const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const Telnyx = require('telnyx');
const telnyxClient = Telnyx(process.env.TELNYX_API_KEY);

// In-memory storage
let users = [];
let nextId = 1;

// Get all users
router.get('/', async (req, res) => {
  try {
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single user
router.get('/:id', async (req, res) => {
  try {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user
router.post('/', async (req, res) => {
  try {
    const user = {
      id: nextId++,
      name: req.body.name,
      email: req.body.email,
      age: req.body.age,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    users.push(user);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update user
router.put('/:id', async (req, res) => {
  try {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      users[index] = {
        ...users[index],
        name: req.body.name || users[index].name,
        email: req.body.email || users[index].email,
        age: req.body.age || users[index].age,
        updatedAt: new Date()
      };
      res.json(users[index]);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      users.splice(index, 1);
      res.json({ message: 'User deleted' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user (signup)
router.post('/signup', async (req, res) => {
  try {
    const { 
      name, 
      phoneNumber, 
      email, 
      gender, 
      birthdate, 
      consent,
      accountID,
      form
    } = req.body;

    // Validate required fields
    if (!name || !phoneNumber || !email || !birthdate || !accountID) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
      });
    }

    // Validate phone number format
    const phoneRegex = /^\+1[0-9]{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Must be +1 followed by 10 digits'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Get account details
    const accountRef = db.collection('accounts').doc(accountID);
    const accountDoc = await accountRef.get();

    if (!accountDoc.exists) {
      return res.status(404).json({ 
        success: false,
        message: 'Account not found' 
      });
    }

    const accountData = accountDoc.data();
    const barName = accountData.barName;
    
    // Get Telnyx number and messaging profile ID from account data
    const telnyxNumber = accountData.phoneNumber;
    const messagingProfileId = accountData.messagingProfileId;
    if (!telnyxNumber || !messagingProfileId) {
      throw new Error('Telnyx number or messaging profile ID not configured for this account');
    }

    // Check if user with this phone number already exists
    const usersRef = accountRef.collection('users');
    const existingUserQuery = await usersRef
      .where('phoneNumber', '==', phoneNumber)
      .get();

    const timestamp = new Date().toISOString();
    let userId;

    if (!existingUserQuery.empty) {
      // Update existing user
      const existingUserDoc = existingUserQuery.docs[0];
      await existingUserDoc.ref.update({
        name,
        email,
        gender: gender || '',
        birthdate,
        consent,
        form: form || '',
        updatedAt: timestamp,
        birthdateConfirmed: false // Reset confirmation when updating
      });
      userId = existingUserDoc.id;
    } else {
      // Create new user
      const newUser = {
        name,
        phoneNumber,
        email,
        gender: gender || '',
        birthdate,
        consent,
        form: form || '',
        createdAt: timestamp,
        updatedAt: timestamp,
        birthdateConfirmed: false
      };

      const userDoc = await usersRef.add(newUser);
      userId = userDoc.id;
    }

    // Send welcome SMS if user gave consent
    if (consent) {
      try {
        console.log('Attempting to send welcome SMS:', {
          from: telnyxNumber,
          to: phoneNumber,
          messagingProfileId
        });

        const messageResponse = await telnyxClient.messages.create({
          from: telnyxNumber,
          to: phoneNumber,
          text: `Hey what's up! This is LastCall, connecting you to ${barName}. Respond with your birthday in the following format to get exclusive deal access! mm/dd/yyyy. You must be 21 or older to proceed. Respond STOP at any time to opt out.`,
          messaging_profile_id: messagingProfileId
        });

        console.log('Welcome message sent successfully:', {
          messageId: messageResponse.data.id,
          status: messageResponse.data.to?.[0]?.status,
          carrier: messageResponse.data.to?.[0]?.carrier
        });

        // If message is queued, check for specific error codes
        if (messageResponse.data.to?.[0]?.status === 'queued') {
          console.log('Message queued. Checking for specific issues:', {
            errors: messageResponse.data.to?.[0]?.errors,
            carrier: messageResponse.data.to?.[0]?.carrier,
            phoneType: messageResponse.data.to?.[0]?.phone_type,
            lineType: messageResponse.data.to?.[0]?.line_type
          });
        }
      } catch (smsError) {
        console.error('Error sending welcome SMS:', {
          error: smsError.message,
          code: smsError.code,
          details: smsError.details
        });
        // Don't fail the signup if SMS fails
      }
    }

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      userId: userId
    });

  } catch (error) {
    console.error('Error in user signup:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create user',
      error: error.message 
    });
  }
});

// Webhook endpoint for incoming SMS messages
router.post('/webhook/sms', async (req, res) => {
  try {
    // Extract data from Telnyx webhook
    const data = req.body.data;
    
    // Verify this is an inbound message
    if (data.event_type !== 'message.received') {
      return res.sendStatus(200);
    }

    const fromNumber = data.payload.from.phone_number;
    const toNumber = data.payload.to[0].phone_number;
    const messageText = data.payload.text.trim();

    console.log('Received SMS:', {
      from: fromNumber,
      to: toNumber,
      text: messageText
    });

    // Find the account by Telnyx number
    const accountsSnapshot = await db.collection('accounts')
      .where('phoneNumber', '==', toNumber)
      .get();

    if (accountsSnapshot.empty) {
      console.error('No account found for Telnyx number:', toNumber);
      return res.sendStatus(200);
    }

    const accountDoc = accountsSnapshot.docs[0];
    const accountId = accountDoc.id;
    const accountData = accountDoc.data();
    
    console.log('Found account:', {
      accountId,
      barName: accountData.barName
    });

    // Search for user across all accounts
    let foundUserDoc = null;
    let foundAccountId = null;
    
    const allAccountsSnapshot = await db.collection('accounts').get();
    
    for (const account of allAccountsSnapshot.docs) {
      console.log('Searching in account:', account.id);
      
      const usersSnapshot = await account.ref.collection('users')
        .where('phoneNumber', '==', fromNumber)
        .get();
      
      if (!usersSnapshot.empty) {
        foundUserDoc = usersSnapshot.docs[0];
        foundAccountId = account.id;
        console.log('Found user in account:', {
          accountId: account.id,
          barName: account.data().barName,
          userId: foundUserDoc.id
        });
        break;
      }
    }

    if (!foundUserDoc) {
      console.error('User not found in any account. Phone number:', fromNumber);
      return res.sendStatus(200);
    }

    // If user was found in a different account
    if (foundAccountId !== accountId) {
      console.log('User found in different account than the one they texted');
      console.log('Texted account:', accountId);
      console.log('User\'s account:', foundAccountId);
      
      // Send message about wrong number
      const messagingProfileId = accountData.messagingProfileId;
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `It looks like you're trying to verify your birthdate with the wrong bar. Please check the welcome message you received and use that number instead.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    // Continue with normal flow - user found in correct account
    const userData = foundUserDoc.data();

    console.log('Found user:', {
      userId: foundUserDoc.id,
      name: userData.name,
      consent: userData.consent,
      birthdateConfirmed: userData.birthdateConfirmed
    });

    // Check if user has given consent
    if (!userData.consent) {
      console.log('User has not given consent:', fromNumber);
      return res.sendStatus(200);
    }

    // Get messaging profile ID
    const messagingProfileId = accountData.messagingProfileId;
    if (!messagingProfileId) {
      console.error('No messaging profile ID found for account:', accountId);
      return res.sendStatus(200);
    }

    // If user is already verified, send them a message
    if (userData.birthdateConfirmed) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Your birthdate has already been verified. You have access to exclusive deals from ${accountData.barName}!`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    // Check if message matches birthdate format (mm/dd/yyyy)
    const birthdateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = messageText.match(birthdateRegex);

    if (!match) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Invalid birthdate format. Please send your birthdate as mm/dd/yyyy (example: 01/31/1990)`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    const [_, month, day, year] = match;
    
    // Validate month and day
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    const yearNum = parseInt(year);

    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Invalid date. Please send a valid birthdate in mm/dd/yyyy format.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    // Calculate age
    const birthDate = new Date(yearNum, monthNum - 1, dayNum);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    // Check if user is 21 or older
    if (age < 21) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Sorry, you must be 21 or older to access our deals.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    // Format dates for comparison
    const submittedBirthdate = `${yearNum}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const storedBirthdate = userData.birthdate;

    console.log('Comparing birthdates:', {
      submitted: submittedBirthdate,
      stored: storedBirthdate
    });

    // Extract date from stored ISO string
    const storedDate = new Date(storedBirthdate);
    const storedYear = storedDate.getFullYear();
    const storedMonth = (storedDate.getMonth() + 1).toString().padStart(2, '0');
    const storedDay = storedDate.getDate().toString().padStart(2, '0');
    const storedDateString = `${storedYear}-${storedMonth}-${storedDay}`;

    console.log('Normalized dates for comparison:', {
      submitted: submittedBirthdate,
      stored: storedDateString
    });

    // Compare submitted birthdate with stored birthdate
    if (submittedBirthdate === storedDateString) {
      // Update user's verification status
      await foundUserDoc.ref.update({
        birthdateConfirmed: true,
        updatedAt: new Date().toISOString()
      });

      console.log('Birthdate verified for user:', foundUserDoc.id);

      // Send success message
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Birthday verified! 🎉 Welcome to ${accountData.barName}'s exclusive deals program. We'll text you whenever there are special offers available!`,
        messaging_profile_id: messagingProfileId
      });
    } else {
      console.log('Birthdate mismatch:', {
        submitted: submittedBirthdate,
        stored: storedDateString
      });

      // Send error message
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `The birthdate you provided (${month}/${day}/${year}) doesn't match our records. Please try again with the same birthdate you used during signup.`,
        messaging_profile_id: messagingProfileId
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing SMS webhook:', error);
    res.sendStatus(200); // Always return 200 to Telnyx even if we have an error
  }
});

module.exports = router; 