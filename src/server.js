const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const passport = require('passport');
const session = require('express-session');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { db } = require('./config/firebase');
const blastRoutes = require('./routes/blasts');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin');
// pipeline test
// Load environment variables
dotenv.config();

// Initialize OAuth2Client for token verification
const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();

// Update CORS configuration for React frontend
app.use(cors({
    origin: process.env.CORS_ORIGIN.split(','),  // Allow both backend and frontend URLs
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Initialize Passport and restore authentication state from session
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URI,
    proxy: true,
    scope: ['profile', 'email']
  },
  function(accessToken, refreshToken, profile, cb) {
    // Create user object with necessary information
    const user = {
      id: profile.id,
      displayName: profile.displayName,
      emails: profile.emails,
      photos: profile.photos
    };
    return cb(null, user);
  }
));

// Serialize user for the session
passport.serializeUser((user, done) => {
  done(null, user);
});

// Deserialize user from the session
passport.deserializeUser((user, done) => {
  done(null, user);
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Add this near the top of your file after dotenv.config()
console.log('OAuth Configuration:');
console.log('Client ID:', process.env.GOOGLE_CLIENT_ID);
console.log('Redirect URI:', process.env.GOOGLE_REDIRECT_URI);

// Add this after dotenv.config()
console.log('Environment Variables:');
console.log('Client ID:', process.env.GOOGLE_CLIENT_ID);
console.log('Redirect URI:', process.env.GOOGLE_REDIRECT_URI?.trim());

// Add this debugging line after dotenv.config()
console.log('Actual callback URL being used:', "http://localhost:3000/auth/google/callback");

// Add this near your other environment variables
const JWT_SECRET = process.env.JWT_SECRET;

// Google OAuth routes
app.get('/auth/google', (req, res, next) => {
  console.log('Starting Google OAuth flow');
  console.log('Using redirect URI:', "http://localhost:3000/auth/google/callback");
  next();
}, passport.authenticate('google', { 
  scope: ['profile', 'email'],
  accessType: 'offline',
  prompt: 'consent' 
}));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: 'http://localhost:3001/login' }),
  async (req, res) => {
    try {
      if (req.isAuthenticated()) {
        const userEmail = req.user.emails[0].value;

        // Check if user exists in Firestore
        const accountsRef = db.collection('accounts');
        const snapshot = await accountsRef.where('email', '==', userEmail).get();

        if (snapshot.empty) {
          return res.redirect('http://localhost:3001/login?error=unauthorized');
        }

        const accountDoc = snapshot.docs[0];
        const accountData = accountDoc.data();

        const user = {
          googleId: req.user.id,
          name: req.user.displayName,
          email: userEmail,
          picture: req.user.photos[0].value,
          emailVerified: req.user.emails[0].verified,
          accountId: accountDoc.id,
          messagingServiceSID: accountData.messagingServiceSID,
          ...accountData
        };

        // Generate JWT token
        const token = jwt.sign(
          { user },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Redirect to frontend with token
        res.redirect(`http://localhost:3001/auth/callback?token=${token}`);
      } else {
        res.redirect('http://localhost:3001/login');
      }
    } catch (error) {
      console.error('Callback error:', error);
      res.redirect('http://localhost:3001/login');
    }
  }
);

// Add this route for direct token verification
app.post('/auth/google/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    console.log('Received token:', token);

    // Create a new OAuth2Client instance with your client ID
    const client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    });

    // Verify the token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log('Token payload:', payload);

    const user = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified
    };

    // Generate JWT token
    const bearerToken = jwt.sign(
      { user: user },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Authenticated user:', user);
    req.session.user = user;
    res.json({ 
      success: true, 
      user,
      token: bearerToken
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token',
      error: error.message 
    });
  }
});

// Add middleware to verify JWT
const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization'];
  
  if (typeof bearerHeader !== 'undefined') {
    const bearer = bearerHeader.split(' ');
    const bearerToken = bearer[1];
    
    jwt.verify(bearerToken, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid token' });
      }
      req.user = decoded.user;
      next();
    });
  } else {
    res.status(401).json({ message: 'Token is required' });
  }
};

// Update protected route to use JWT
app.get('/home', verifyToken, (req, res) => {
  res.json({ 
    message: 'Welcome to protected route',
    user: req.user
  });
});

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API' });
});

// Protected routes
app.use('/api/blasts', verifyToken, blastRoutes);

// Protected admin routes
app.use('/api/admin', verifyToken, adminRoutes);

// Public user routes (for signup)
app.use('/api/users', userRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 


//test