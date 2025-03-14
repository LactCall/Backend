const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const Telnyx = require('telnyx');
const telnyxClient = Telnyx(process.env.TELNYX_API_KEY);
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// In-memory storage
let users = [];
let nextId = 1;

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
  }
});

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
        subscribe: consent,
        membershipStatus: req.body.membershipStatus || '',
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
        subscribe: consent,
        membershipStatus: req.body.membershipStatus || '',
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

        if(accountData.couponsEnabled) {
        const messageResponse = await telnyxClient.messages.create({
          from: telnyxNumber,
          to: phoneNumber,
          text: `Hey! This is LastCall, connecting you to ${barName}. You must be 21 or older to proceed. We will be in touch with drink deals, upcoming events, and more 🎉 Respond STOP at any time to opt out. MSG frequency may vary. MSG & Data Rates may apply. Texting HELP for more info.\n\nTo receive a complimentary wine or beer with signup, save this contact as “Birdies Clubhouse” and text code "LASTCALL2025" to receive your one-time unique code. This code will expire in ten minutes, so send it when you are at the bar!
`,
          messaging_profile_id: messagingProfileId
        });
        } else {
          const messageResponse = await telnyxClient.messages.create({
            from: telnyxNumber,
            to: phoneNumber,
            text: `Hey! This is LastCall, connecting you to ${barName}. You must be 21 or older to proceed. We will be in touch with drink deals, upcoming events, and more 🎉 Respond STOP at any time to opt out. MSG frequency may vary. MSG & Data Rates may apply. Texting HELP for more info.`,
            messaging_profile_id: messagingProfileId
          });
        }

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
    const messageText = data.payload.text.trim().toUpperCase(); // Convert to uppercase for comparison

    console.log('Received SMS:', {
      from: fromNumber,
      to: toNumber,
      text: messageText
    });

    // First find the account by Telnyx number
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
      barName: accountData.barName,
      couponsEnabled: accountData.couponsEnabled
    });

    // Now search for user only in this account
    const usersSnapshot = await accountDoc.ref.collection('users')
      .where('phoneNumber', '==', fromNumber)
      .get();

    if (usersSnapshot.empty) {
      console.error('No user found with phone number:', fromNumber, 'in account:', accountId);
      return res.sendStatus(200);
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();

    console.log('Found user:', {
      userId: userDoc.id,
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

    // Check if the message is the LASTCALL2025 code request
    if (messageText === 'LASTCALL2025') {
      /* if (!userData.birthdateConfirmed) {
        await telnyxClient.messages.create({
          from: toNumber,
          to: fromNumber,
          text: `Please verify your birthdate first by sending it in mm/dd/yyyy format.`,
          messaging_profile_id: messagingProfileId
        });
        return res.sendStatus(200);
      } */

      // Check if user already has an active code
      const activeCouponsSnapshot = await userDoc.ref.collection('coupons')
        .where('used', '==', false)
        .where('expiresAt', '>', new Date())
        .get();

      if (!activeCouponsSnapshot.empty) {
        await telnyxClient.messages.create({
          from: toNumber,
          to: fromNumber,
          text: `You already have an active welcome drink code. Please use your existing code or wait for it to expire.`,
          messaging_profile_id: messagingProfileId
        });
        return res.sendStatus(200);
      }

      // Generate a unique 5-character code
      const uniqueCode = Math.random().toString(36).substring(2, 7).toUpperCase();
      
      // Store the code in Firebase with expiration time (10 minutes from now)
      const expirationTime = new Date();
      expirationTime.setMinutes(expirationTime.getMinutes() + 10);
      
      await userDoc.ref.collection('coupons').add({
        code: uniqueCode,
        createdAt: new Date(),
        expiresAt: expirationTime,
        used: false,
        type: 'welcome_drink'
      });

      // Send the welcome drink code
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Welcome Drink Code: ${uniqueCode}\n\nShow this code to the bartender to claim your free beer or wine. This code will expire in 10 minutes and can only be redeemed once. Cheers!`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    if (messageText === 'STOP') {
      await userDoc.ref.update({
        subscribe: false
      });

      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `You have been unsubscribed from ${accountData.barName} updates.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    if (messageText === 'START') {
      await userDoc.ref.update({
        subscribe: true
      });
      
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `You have been subscribed to ${accountData.barName} updates.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    if (messageText === 'HELP') {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `contact support@lastcallforbars.com for more information`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    }

    // If user is already verified and not requesting a code, send them a message
    /* if (userData.birthdateConfirmed) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Your birthdate has already been verified. You have access to exclusive deals from ${accountData.barName}!`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    } */

    // Handle birthday verification
    const birthdateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = messageText.match(birthdateRegex);

    /* if (!match) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Invalid birthdate format. Please send your birthdate as mm/dd/yyyy (example: 01/31/1990)`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    } */

    const [_, month, day, year] = match;
    
    // Validate month and day
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    const yearNum = parseInt(year);

    /* if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Invalid date. Please send a valid birthdate in mm/dd/yyyy format.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    } */

    // Calculate age
    const birthDate = new Date(yearNum, monthNum - 1, dayNum);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    /* if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    } */

    // Check if user is 21 or older
    /* if (age < 21) {
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Sorry, you must be 21 or older to access our deals.`,
        messaging_profile_id: messagingProfileId
      });
      return res.sendStatus(200);
    } */

    // Format the new birthdate
    const submittedBirthdate = new Date(yearNum, monthNum - 1, dayNum).toISOString();

    // Update user's birthdate and verification status
    await userDoc.ref.update({
      birthdate: submittedBirthdate,
      birthdateConfirmed: true,
      updatedAt: new Date().toISOString()
    });

    // Check if coupons are enabled for this bar
    /* if (accountData.couponsEnabled) {
      // Send success message with instructions to get the welcome drink code
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Birthday verified! 🎉 You're all set! Save this contact to get started, and we will be in touch with drink deals, upcoming events, and more!\n\nTo receive a complimentary wine or beer with signup, text code "LASTCALL2025" to receive your one-time unique code. This code will expire in ten minutes, so send it when you are at the bar!`,
        messaging_profile_id: messagingProfileId
      });
    } else {
      // Send regular success message without code
      await telnyxClient.messages.create({
        from: toNumber,
        to: fromNumber,
        text: `Birthday verified! 🎉 You're all set! Save this contact to get started, and we will be in touch with drink deals, upcoming events, and more!`,
        messaging_profile_id: messagingProfileId
      });
    } */

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing SMS webhook:', error);
    res.sendStatus(200);
  }
});

// Add this new endpoint with the existing routes
router.get('/accounts/:email', async (req, res) => {
    try {
        const { email } = req.params;
        console.log('Fetching accounts for email:', email);
        
        const accountsSnapshot = await db.collection('accounts')
            .where('email', '==', email)
            .get();
        
        console.log('Query snapshot size:', accountsSnapshot.size);
        
        const accounts = [];
        accountsSnapshot.forEach(doc => {
            console.log('Found account:', doc.id, doc.data());
            accounts.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log('Returning accounts:', accounts);
        res.json(accounts);
    } catch (error) {
        console.error('Error fetching user accounts:', error);
        res.status(500).json({ error: 'Failed to fetch user accounts' });
    }
});

// Create account (signup)
router.post('/create-account', async (req, res) => {
  try {
    const { 
      username,
      barName,
      email,
      password,
      slug = barName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    } = req.body;

    // Validate required fields
    if (!username || !barName || !email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields' 
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

    // Check if email already exists
    const accountsRef = db.collection('accounts');
    const emailQuery = await accountsRef.where('email', '==', email).get();
    if (!emailQuery.empty) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Check if username already exists
    const usernameQuery = await accountsRef.where('username', '==', username).get();
    if (!usernameQuery.empty) {
      return res.status(400).json({
        success: false,
        message: 'Username already taken'
      });
    }

    // Check if slug already exists
    const slugQuery = await accountsRef.where('slug', '==', slug).get();
    if (!slugQuery.empty) {
      return res.status(400).json({
        success: false,
        message: 'Bar name already taken'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new account document with locked status
    const newAccount = {
      username,
      barName,
      email,
      slug,
      password: hashedPassword,
      isLocked: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const accountRef = await accountsRef.add(newAccount);

    // Send welcome email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to LastCall - Account Under Review',
      html: `
        <h2>Welcome to LastCall!</h2>
        <p>Thank you for signing up with LastCall. Your account is currently under review.</p>
        <p>Our team will contact you within 24 hours to help you get started.</p>
        <p>Account Details:</p>
        <ul>
          <li>Bar Name: ${barName}</li>
          <li>Email: ${email}</li>
        </ul>
        <p>If you have any immediate questions, please contact us at support@lastcallforbars.com</p>
        <p>Best regards,<br>The LastCall Team</p>
      `
    };

    const mailOptions_admin = {
      from: process.env.EMAIL_USER,
      to: 'avivroskes@gmail.com' + ',' + 'mkdave27@gmail.com'+',' + 'aviv@lastcallforbars.com'+ ',' + 'support@lastcallforbars.com'+ ',' + 'emma@lastcallforbars.com',
      subject: 'New LastCall Account',
      html: `
        <h2>New LastCall Account</h2>
        <p>A new account has been created with the following details:</p>
        <ul>
          <li>Username: ${username}</li>
          <li>Bar Name: ${barName}</li>
          <li>Email: ${email}</li>
          <li>Slug: ${slug}</li>
          <li>Is Locked: ${newAccount.isLocked}</li>
          <li>Created At: ${newAccount.createdAt}</li>
          <li>Updated At: ${newAccount.updatedAt}</li>
        </ul>
        <p>Please review the account and update the status to active by changing the isLocked field to false if everything is correct.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    await transporter.sendMail(mailOptions_admin);

    // Return success without password
    const { password: _, ...accountData } = newAccount;
    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Our team will contact you within 24 hours.',
      account: {
        id: accountRef.id,
        ...accountData
      }
    });

  } catch (error) {
    console.error('Error creating account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create account'
    });
  }
});

// Login with email and password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find account by email
    const accountsRef = db.collection('accounts');
    const emailQuery = await accountsRef.where('email', '==', email).get();

    if (emailQuery.empty) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const accountDoc = emailQuery.docs[0];
    const accountData = accountDoc.data();

    // Check if account is locked
    if (accountData.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account is under review. Our team will contact you within 24 hours.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, accountData.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Create JWT token
    const user = {
      accountId: accountDoc.id,
      username: accountData.username,
      email: accountData.email,
      barName: accountData.barName,
      slug: accountData.slug
    };

    const token = jwt.sign(
      { user },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return success with token and user data
    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

module.exports = router;