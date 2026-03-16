const mongoose = require('mongoose');

// Add this with your other mongoose models
const gameStateSchema = new mongoose.Schema({
    matchId: { type: String, required: true, unique: true },
    board: [[String]],
    currentPlayer: String,
    winner: String, // Store the winner when game ends
    playerColors: {
        player1: String,
        player2: String
    },
    isFlipped: Boolean,
    selectedPiece: {
        row: Number,
        col: Number
    },
    isJumpSequence: Boolean,
    validJumpDestinations: Array,
    chatHistory: [{
        username: String,
        message: String,
        timestamp: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false }
    }]
}, { timestamps: true });

const GameState = mongoose.model('GameState', gameStateSchema);

module.exports = GameState;