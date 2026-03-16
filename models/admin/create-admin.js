require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

async function main() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('❌ MONGODB_URI is not set in .env');
            process.exit(1);
        }

        await mongoose.connect(process.env.MONGODB_URI);

        console.log('✓ Connected to MongoDB');

        const username = 'admin';
        const plainPassword = 'Admin@123';

        // Hash password
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        // Upsert admin user
        const admin = await Admin.findOneAndUpdate(
            { username },
            {
                username,
                password: hashedPassword,
                role: 'admin',
                lastLogin: new Date(),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log('✅ Admin account is ready:');
        console.log(`   Username: ${username}`);
        console.log(`   Password: ${plainPassword}`);

        await mongoose.connection.close();
        console.log('✓ Database connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error creating admin:', err);
        process.exit(1);
    }
}

main();

