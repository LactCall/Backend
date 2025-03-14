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

async function auditMetrics() {
  try {
    // Ask for account ID
    readline.question('Enter the account ID (default: OzCNAdTti9xoqLm4bwNL): ', async (input) => {
      // Use the provided account ID or default
      const accountId = input.trim() || 'OzCNAdTti9xoqLm4bwNL';
      
      console.log(`\nAuditing metrics for account: ${accountId}...`);
      
      // Get all subscribed users
      const usersRef = db.collection('accounts').doc(accountId).collection('users');
      const usersSnapshot = await usersRef.where('subscribed', '==', true).get();
      
      if (usersSnapshot.empty) {
        console.log('No subscribed users found for this account.');
        readline.close();
        admin.app().delete();
        return;
      }
      
      const subscribedUserCount = usersSnapshot.size;
      console.log(`Found ${subscribedUserCount} subscribed users.`);
      
      // Get the metrics documents
      const metricsRef = db.collection('accounts').doc(accountId).collection('metrics');
      const userGrowthDoc = await metricsRef.doc('user_growth').get();
      const ageDistributionDoc = await metricsRef.doc('age_distribution').get();
      const genderDistributionDoc = await metricsRef.doc('gender_distribution').get();
      
      // Check user growth metrics
      if (userGrowthDoc.exists) {
        const userGrowthData = userGrowthDoc.data();
        console.log(`\nUser Growth Metrics:`);
        console.log(`- Total users in metrics: ${userGrowthData.total_users}`);
        console.log(`- Actual subscribed users: ${subscribedUserCount}`);
        
        if (userGrowthData.total_users !== subscribedUserCount) {
          console.log(`⚠️ Discrepancy detected in total user count!`);
        }
      } else {
        console.log(`\nNo user growth metrics found.`);
      }
      
      // Check age distribution metrics
      if (ageDistributionDoc.exists) {
        const ageDistributionData = ageDistributionDoc.data();
        const ageDistribution = ageDistributionData.age_distribution || {};
        
        console.log(`\nAge Distribution Metrics:`);
        let totalInAgeDistribution = 0;
        
        Object.entries(ageDistribution).forEach(([ageRange, count]) => {
          console.log(`- ${ageRange}: ${count}`);
          totalInAgeDistribution += count;
        });
        
        console.log(`\nTotal users in age distribution: ${totalInAgeDistribution}`);
        console.log(`Actual subscribed users: ${subscribedUserCount}`);
        
        if (totalInAgeDistribution !== subscribedUserCount) {
          console.log(`⚠️ Discrepancy detected in age distribution! (${totalInAgeDistribution} vs ${subscribedUserCount})`);
        }
      } else {
        console.log(`\nNo age distribution metrics found.`);
      }
      
      // Check gender distribution metrics
      if (genderDistributionDoc.exists) {
        const genderDistributionData = genderDistributionDoc.data();
        const genderDistribution = genderDistributionData.gender_distribution || {};
        
        console.log(`\nGender Distribution Metrics:`);
        let totalInGenderDistribution = 0;
        
        Object.entries(genderDistribution).forEach(([gender, count]) => {
          console.log(`- ${gender}: ${count}`);
          totalInGenderDistribution += count;
        });
        
        console.log(`\nTotal users in gender distribution: ${totalInGenderDistribution}`);
        console.log(`Actual subscribed users: ${subscribedUserCount}`);
        
        if (totalInGenderDistribution !== subscribedUserCount) {
          console.log(`⚠️ Discrepancy detected in gender distribution! (${totalInGenderDistribution} vs ${subscribedUserCount})`);
        }
      } else {
        console.log(`\nNo gender distribution metrics found.`);
      }
      
      // Ask if user wants to fix the discrepancies
      readline.question('\nDo you want to recalculate and fix all metrics? (yes/no): ', async (answer) => {
        if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
          console.log('Operation cancelled. No changes were made.');
          readline.close();
          admin.app().delete();
          return;
        }
        
        console.log('\nRecalculating metrics...');
        
        // Calculate age distribution
        const ageDistribution = {};
        const genderDistribution = {
          'Man': 0,
          'Woman': 0,
          'Non-binary': 0,
          'Other': 0,
          'Prefer not to say': 0
        };
        
        // Map for gender normalization
        const genderMap = {
          'male': 'Man',
          'man': 'Man',
          'm': 'Man',
          
          'female': 'Woman',
          'woman': 'Woman',
          'f': 'Woman',
          
          'nonbinary': 'Non-binary',
          'non-binary': 'Non-binary',
          'nonBinary': 'Non-binary',
          'nb': 'Non-binary',
          
          'other': 'Other',
          'o': 'Other',
          
          '': 'Prefer not to say',
          'prefer not to say': 'Prefer not to say',
          'not specified': 'Prefer not to say',
          'unspecified': 'Prefer not to say'
        };
        
        // Process each user
        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data();
          
          // Process age
          if (userData.birthdate) {
            try {
              const birthdate = new Date(userData.birthdate);
              const today = new Date();
              let age = today.getFullYear() - birthdate.getFullYear();
              
              // Adjust age if birthday hasn't occurred yet this year
              const birthdateThisYear = new Date(today.getFullYear(), birthdate.getMonth(), birthdate.getDate());
              if (today < birthdateThisYear) {
                age--;
              }
              
              // Store each age individually
              ageDistribution[age.toString()] = (ageDistribution[age.toString()] || 0) + 1;
            } catch (error) {
              console.error(`Error calculating age for user ${userDoc.id}:`, error);
            }
          } else {
            // No birthdate provided
            ageDistribution['Unknown'] = (ageDistribution['Unknown'] || 0) + 1;
          }
          
          // Process gender
          const rawGender = (userData.gender || '').toLowerCase();
          const normalizedGender = genderMap[rawGender] || 'Prefer not to say';
          genderDistribution[normalizedGender]++;
        }
        
        // Update metrics documents
        try {
          // Update user growth metrics
          const today = new Date().toISOString().split('T')[0];
          const currentMonth = today.substring(0, 7);
          
          await metricsRef.doc('user_growth').set({
            total_users: subscribedUserCount,
            per_day: {
              [today]: subscribedUserCount
            },
            per_month: {
              [currentMonth]: subscribedUserCount
            },
            last_updated: new Date().toISOString()
          }, { merge: true });
          
          // Update age distribution metrics
          await metricsRef.doc('age_distribution').set({
            age_distribution: ageDistribution,
            last_updated: new Date().toISOString()
          });
          
          // Update gender distribution metrics
          await metricsRef.doc('gender_distribution').set({
            gender_distribution: genderDistribution,
            last_updated: new Date().toISOString()
          });
          
          console.log('\nMetrics updated successfully!');
          console.log('\nNew Age Distribution:');
          console.log(ageDistribution);
          
          console.log('\nNew Gender Distribution:');
          console.log(genderDistribution);
          
          console.log(`\nTotal users in metrics: ${subscribedUserCount}`);
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
auditMetrics(); 