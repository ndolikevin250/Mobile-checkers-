const mongoose = require('mongoose');

// User Dashboard Schema for persistent user data
const userDashboardSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    totalGames: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    favoriteDifficulty: { type: String, default: 'Medium' },
    totalPlayTime: { type: Number, default: 0 }, // in minutes
    achievements: [{ type: String }],
    lastPlayed: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    preferences: {
        soundEnabled: { type: Boolean, default: true },
        difficulty: { type: String, default: 'Medium' },
        theme: { type: String, default: 'cyberpunk' }
    },
    gameHistory: [{
        opponent: String,
        result: String, // 'win', 'loss', 'draw'
        difficulty: String,
        duration: Number, // in seconds
        date: { type: Date, default: Date.now },
        matchId: String
    }]
});

const UserDashboard = mongoose.model('UserDashboard', userDashboardSchema);

module.exports = UserDashboard;