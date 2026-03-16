require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');
const Admin = require('../models/Admin');

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(async () => {
    console.log('Connected to MongoDB');

    // List all admins
    const admins = await Admin.find({}, 'username');
    
    if (admins.length === 0) {
        console.log('\n❌ No admin accounts found.');
        await mongoose.connection.close();
        rl.close();
        process.exit(0);
    }

    console.log('\n📋 Available admin accounts:');
    admins.forEach((admin, index) => {
        console.log(`   ${index + 1}. ${admin.username}`);
    });

    // Ask which admin to reset
    rl.question('\nEnter the username to reset password (or "cancel" to exit): ', async (username) => {
        if (username.toLowerCase() === 'cancel') {
            await mongoose.connection.close();
            rl.close();
            process.exit(0);
        }

        const admin = await Admin.findOne({ username });
        if (!admin) {
            console.log(`\n❌ Admin "${username}" not found.`);
            await mongoose.connection.close();
            rl.close();
            process.exit(1);
        }

        // Ask for new password
        rl.question('Enter new password: ', async (newPassword) => {
            if (!newPassword || newPassword.length < 3) {
                console.log('\n❌ Password must be at least 3 characters long.');
                await mongoose.connection.close();
                rl.close();
                process.exit(1);
            }

            // Hash the new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update admin password
            admin.password = hashedPassword;
            await admin.save();

            console.log(`\n✅ Password for admin "${username}" has been reset successfully!`);
            console.log(`   You can now login with username: ${username}`);
            console.log(`   and the new password you just set.`);

            // Close connection
            await mongoose.connection.close();
            rl.close();
            process.exit(0);
        });
    });
})
.catch(err => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});
