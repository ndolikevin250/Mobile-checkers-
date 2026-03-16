const mongoose = require('mongoose');

// Add this schema for single player games
const singlePlayerGameSchema = new mongoose.Schema({
    userId: String,
    gameState: {
        board: [[Object]],
        currentPlayer: String,
        moveHistory: Array,
        aiPatterns: mongoose.Schema.Types.Mixed, // Support both array and object formats
        currentDifficulty: String,
        statistics: {
            totalGames: Number,
            wins: Number,
            losses: Number,
            totalMoves: Number,
            aiLearningProgress: Number
        },
        lastUpdated: { type: Date, default: Date.now }
    }
});

const SinglePlayerGame = mongoose.model('SinglePlayerGame', singlePlayerGameSchema);

module.exports = SinglePlayerGame;