const admin = require('firebase-admin');
const serviceAccount = require('./src/config/lastcall.json'); // Same path as list_users.js

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Create readline interface for user input
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

async function updateSubscriptions() {
  try {
    // Ask for account ID
    readline.question('Enter the account ID (default: OzCNAdTti9xoqLm4bwNL): ', async (input) => {
      // Use the provided account ID or default to the one from list_users.js
      const accountId = input.trim() || 'OzCNAdTti9xoqLm4bwNL';
      
      console.log(`\nFetching users for account: ${accountId}...`);
      
      // Get all users
      const usersRef = db.collection('accounts').doc(accountId).collection('users');
      const usersSnapshot = await usersRef.get();
      
      if (usersSnapshot.empty) {
        console.log('No users found for this account.');
        readline.close();
        admin.app().delete();
        return;
      }
      
      const userDocs = usersSnapshot.docs;
      console.log(`Found ${userDocs.length} users.`);
      
      // Confirm before proceeding
      readline.question(`\nThis will set all but 1 user to subscribed=false. Continue? (yes/no): `, async (answer) => {
        if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
          console.log('Operation cancelled. No changes were made.');
          readline.close();
          admin.app().delete();
          return;
        }
        
        // Randomly select one user to keep subscribed
        const randomIndex = Math.floor(Math.random() * userDocs.length);
        const luckyUserDoc = userDocs[randomIndex];
        const luckyUser = luckyUserDoc.data();
        
        console.log(`\nKeeping user subscribed: ${luckyUser.firstName || ''} ${luckyUser.lastName || ''} (${luckyUserDoc.id})`);
        console.log('\nUpdating subscription status for all other users...');
        
        // Create a batch for efficient updates
        let batch = db.batch();
        let updatedCount = 0;
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore limit
        
        // Process each user
        for (const userDoc of userDocs) {
          // Skip the lucky user
          if (userDoc.id === luckyUserDoc.id) {
            continue;
          }
          
          const userData = userDoc.data();
          const userRef = usersRef.doc(userDoc.id);
          
          // Set subscribed to false
          batch.update(userRef, { subscribed: false });
          updatedCount++;
          batchCount++;
          
          // If we've reached batch size limit, commit and start a new batch
          if (batchCount >= BATCH_SIZE) {
            console.log(`Committing batch of ${batchCount} updates...`);
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        
        // Commit any remaining updates
        if (batchCount > 0) {
          console.log(`Committing final batch of ${batchCount} updates...`);
          await batch.commit();
        }
        
        console.log('\n--- Update Summary ---');
        console.log(`Total users unsubscribed: ${updatedCount}`);
        console.log(`Users remaining subscribed: 1`);
        console.log('Update completed successfully!');
        
        // Update metrics to reflect the changes
        console.log('\nUpdating metrics to reflect subscription changes...');
        try {
          const metricsRef = db.collection('accounts').doc(accountId).collection('metrics');
          
          // Update user_growth document to show only 1 user
          await metricsRef.doc('user_growth').set({
            total_users: 1,
            per_day: {
              [new Date().toISOString().split('T')[0]]: 1
            },
            per_month: {
              [new Date().toISOString().substring(0, 7)]: 1
            },
            last_updated: new Date().toISOString()
          }, { merge: true });
          
          console.log('Metrics updated successfully!');
        } catch (error) {
          console.error('Error updating metrics:', error);
        }
        
        readline.close();
        admin.app().delete();
      });
    });
  } catch (error) {
    console.error('Error:', error);
    readline.close();
    admin.app().delete();
  }
}

// Run the script
updateSubscriptions(); 