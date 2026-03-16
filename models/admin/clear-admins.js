require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(async () => {
    console.log('Connected to MongoDB');

    // Clear all admin documents
    const result = await Admin.deleteMany({});
    console.log(`Deleted ${result.deletedCount} admin documents`);

    // Count remaining documents
    const count = await Admin.countDocuments();
    console.log(`Remaining admin documents: ${count}`);

    // Close connection
    await mongoose.connection.close();
    console.log('Database connection closed');
})
.catch(err => {
    console.error('Error:', err);
    process.exit(1);
});