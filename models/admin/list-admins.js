require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(async () => {
    console.log('Connected to MongoDB');

    // Find all admin documents
    const admins = await Admin.find({}, 'username createdAt lastLogin');
    
    if (admins.length === 0) {
        console.log('\n❌ No admin accounts found in the database.');
        console.log('You need to create an admin account using admin-register.html');
    } else {
        console.log(`\n✅ Found ${admins.length} admin account(s):\n`);
        admins.forEach((admin, index) => {
            console.log(`${index + 1}. Username: ${admin.username}`);
            console.log(`   Created: ${admin.createdAt}`);
            console.log(`   Last Login: ${admin.lastLogin || 'Never'}`);
            console.log('');
        });
        console.log('⚠️  Note: Passwords are hashed and cannot be retrieved.');
        console.log('   If you forgot your password, you can:');
        console.log('   1. Use admin-register.html to create a new admin (if you have the admin key)');
        console.log('   2. Or reset the password by deleting and recreating the admin account');
    }

    // Close connection
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
})
.catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
