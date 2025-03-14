const admin = require('firebase-admin');
const serviceAccount = require('./src/config/lastcall.json');

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

async function restoreSubscriptions() {
  try {
    // Ask for account ID
    readline.question('Enter the account ID (default: OzCNAdTti9xoqLm4bwNL): ', async (input) => {
      // Use the provided account ID or default
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
      
      const userCount = usersSnapshot.size;
      console.log(`Found ${userCount} users.`);
      
      // Confirm before proceeding
      readline.question(`\nThis will set all ${userCount} users to subscribed=true. Continue? (yes/no): `, async (answer) => {
        if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
          console.log('Operation cancelled. No changes were made.');
          readline.close();
          admin.app().delete();
          return;
        }
        
        console.log('\nUpdating subscription status for all users...');
        
        // Create a batch for efficient updates
        let batch = db.batch();
        let updatedCount = 0;
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore limit
        
        // Process each user
        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data();
          const userRef = usersRef.doc(userDoc.id);
          
          // Only update if the user has consent
          if (userData.consent === true) {
            // Set subscribed to true
            batch.update(userRef, { subscribed: true });
            updatedCount++;
            batchCount++;
            
            // If we've reached batch size limit, commit and start a new batch
            if (batchCount >= BATCH_SIZE) {
              console.log(`Committing batch of ${batchCount} updates...`);
              await batch.commit();
              batch = db.batch();
              batchCount = 0;
            }
          } else {
            console.log(`Skipping user ${userData.firstName || ''} ${userData.lastName || ''} (no consent)`);
          }
        }
        
        // Commit any remaining updates
        if (batchCount > 0) {
          console.log(`Committing final batch of ${batchCount} updates...`);
          await batch.commit();
        }
        
        console.log('\n--- Update Summary ---');
        console.log(`Total users updated: ${updatedCount}`);
        console.log('Update completed successfully!');
        
        // Update metrics to reflect the changes
        console.log('\nUpdating metrics to reflect subscription changes...');
        try {
          // Get current count of subscribed users
          const subscribedUsersSnapshot = await usersRef.where('subscribed', '==', true).count().get();
          const subscribedCount = subscribedUsersSnapshot.data().count;
          
          const metricsRef = db.collection('accounts').doc(accountId).collection('metrics');
          
          // Update user_growth document to show the current count
          const today = new Date().toISOString().split('T')[0];
          const currentMonth = today.substring(0, 7);
          
          await metricsRef.doc('user_growth').set({
            total_users: subscribedCount,
            per_day: {
              [today]: subscribedCount
            },
            per_month: {
              [currentMonth]: subscribedCount
            },
            last_updated: new Date().toISOString()
          }, { merge: true });
          
          console.log(`Metrics updated successfully! Current subscribed users: ${subscribedCount}`);
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
restoreSubscriptions(); 