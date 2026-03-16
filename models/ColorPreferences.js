const mongoose = require('mongoose');

// Add this schema for color preferences
const colorPreferencesSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    preferences: {
        playerPiece: String,
        aiPiece: String,
        darkSquare: String,
        lightSquare: String,
        primary: String,
        background: String,
        theme: String, // Board theme for multiplayer
        singlePlayerTheme: String // Theme for single-player mode
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

const ColorPreferences = mongoose.model('ColorPreferences', colorPreferencesSchema);

module.exports = ColorPreferences;