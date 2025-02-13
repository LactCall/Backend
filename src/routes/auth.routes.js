const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');

// In-memory storage for users
let users = [];
let nextId = 1;

// Initialize Google OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Add this test route at the top of your routes
router.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  console.log('Environment variables in auth routes:');
  console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
  console.log('GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);
  
  res.json({ 
    message: 'Auth routes working',
    clientId: process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Missing',
    clientIdValue: process.env.GOOGLE_CLIENT_ID, // This will help debug
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    envKeys: Object.keys(process.env) // This will show what env variables are available
  });
});

// Generate Google OAuth URL
router.get('/google/url', (req, res) => {
  console.log('Generating Google OAuth URL');
  console.log('Using client ID:', process.env.GOOGLE_CLIENT_ID);
  console.log('Using redirect URI:', process.env.GOOGLE_REDIRECT_URI);
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    redirect_uri: process.env.GOOGLE_REDIRECT_URI // explicitly set redirect URI
  });
  
  console.log('Generated URL:', url);
  res.json({ url });
});

// Handle Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    console.log('Callback received with code:', req.query.code);
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Received tokens:', tokens);
    
    oauth2Client.setCredentials(tokens);

    // Get user info using access token
    const oauth2 = new OAuth2Client();
    oauth2.setCredentials({ access_token: tokens.access_token });
    
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );
    const googleUser = await response.json();
    console.log('Google user info:', googleUser);

    // Check if user exists
    let user = users.find(u => u.email === googleUser.email);

    if (!user) {
      // Create new user if doesn't exist
      user = {
        id: nextId++,
        name: googleUser.name,
        email: googleUser.email,
        picture: googleUser.picture,
        googleId: googleUser.id,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      users.push(user);
      console.log('New user created:', user);
    } else {
      console.log('Existing user found:', user);
    }

    console.log('Current users in memory:', users);

    res.json({
      user,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      }
    });
  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).json({ message: 'Authentication failed' });
  }
});

// Verify Google token (for client-side authentication)
router.post('/google/verify', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    // Check if user exists
    let user = users.find(u => u.email === payload.email);

    if (!user) {
      // Create new user if doesn't exist
      user = {
        id: nextId++,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
        googleId: payload.sub,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      users.push(user);
    }

    res.json({ user });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Add this to see current users
router.get('/users', (req, res) => {
  console.log('Current users:', users);
  res.json(users);
});

module.exports = router; 

//test
