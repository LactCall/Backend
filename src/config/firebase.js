const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = require('./lastcall.json');

const app = initializeApp({
    credential: cert(serviceAccount)
});

// Initialize Firestore
const db = getFirestore();

module.exports = {
    db
}; 

//test
