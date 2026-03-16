const mongoose = require('mongoose');

// AI Testing Schema for storing test results
const aiTestResultSchema = new mongoose.Schema({
    testType: String,
    difficulty: String,
    results: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now },
    testId: String
});

const AITestResult = mongoose.model('AITestResult', aiTestResultSchema);

module.exports = AITestResult;