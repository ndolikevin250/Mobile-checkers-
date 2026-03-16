const mongoose = require('mongoose');

// Add this schema for all user preferences
const userPreferencesSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    colors: {
        playerPiece: String,
        aiPiece: String,
        darkSquare: String,
        lightSquare: String,
        primary: String,
        background: String
    },
    gameSettings: {
        enhancedKingMode: Boolean,
        difficulty: {
            type: String,
            enum: ['easy', 'medium', 'hard'],
            default: 'medium'
        }
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

const UserPreferences = mongoose.model('UserPreferences', userPreferencesSchema);

module.exports = UserPreferences;