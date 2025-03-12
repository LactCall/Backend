// list_users_script.js
const admin = require('firebase-admin');
const serviceAccount = require('./src/config/lastcall.json'); // Update this path if needed

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function listAllUsers() {
  try {
    console.log('Starting to list users for specific account...');
    
    // Specific account ID to process
    const accountId = 'OzCNAdTti9xoqLm4bwNL';
    
    // Get the account document
    const accountDoc = await db.collection('accounts').doc(accountId).get();
    
    if (!accountDoc.exists) {
      console.log(`Account with ID ${accountId} not found.`);
      return;
    }
    
    const accountName = accountDoc.data().name || 'Unknown';
    console.log(`\nAccount: ${accountName} (${accountId})`);
    
    // Get all users for this account
    const usersSnapshot = await db.collection('accounts').doc(accountId).collection('users').get();
    
    console.log(`Found ${usersSnapshot.size} users in this account`);
    
    // Print information for each user
    console.log('Users:');
    usersSnapshot.docs.forEach((userDoc, index) => {
      const userData = userDoc.data();
      const firstName = userData.firstName || '';
      const lastName = userData.lastName || '';
      const email = userData.email || 'No email';
      const consent = userData.consent === true ? 'Yes' : 'No';
      
      console.log(`  ${index + 1}. ${firstName} ${lastName} (${email}) - Consent: ${consent}`);
    });
    
    console.log('\n--- Summary ---');
    console.log(`Total users: ${usersSnapshot.size}`);
    
    // Ask if user wants to add the subscribed field
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question('\nDo you want to add a "subscribed" field to all users? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\nAdding "subscribed" field to all users...');
        
        // Create a batch for efficient updates
        let batch = db.batch();
        let updatedCount = 0;
        let batchCount = 0;
        const BATCH_SIZE = 500; // Firestore limit
        
        // Process each user
        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data();
          const userRef = db.collection('accounts').doc(accountId).collection('users').doc(userDoc.id);
          
          // Set subscribed to the same value as consent
          const consentValue = userData.consent === true;
          
          // Log what we're doing
          console.log(`Updating user ${userData.firstName} ${userData.lastName}: consent=${consentValue}`);
          
          // Add to batch
          batch.update(userRef, { subscribed: consentValue });
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
        console.log(`Total users updated: ${updatedCount}`);
        console.log('Update completed successfully!');
      } else {
        console.log('No changes were made to the database.');
      }
      
      readline.close();
      admin.app().delete();
    });
    
  } catch (error) {
    console.error('Error listing users:', error);
    admin.app().delete();
  }
}

// Run the function
listAllUsers();