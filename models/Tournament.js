const mongoose = require('mongoose');

const tournamentPlayerSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    avatar: { type: String, default: '♟' },
    elo: { type: Number, default: 1000 },
    seed: { type: Number, required: true }, // 1-4, determines bracket position
    eliminated: { type: Boolean, default: false },
    placement: { type: Number, default: null } // 1st, 2nd, 3rd, 4th
});

const tournamentMatchSchema = new mongoose.Schema({
    round: { type: String, required: true }, // "semi1", "semi2", "final"
    status: { type: String, default: 'pending' }, // pending, active, completed
    boardState: { type: [[Number]], default: null }, // 8x8 board as 2D number array
    currentTurn: { type: String, default: null }, // username of whose turn it is
    player1: { type: String, required: true }, // username
    player2: { type: String, required: true }, // username
    winner: { type: String, default: null }, // username of winner
    moveHistory: { type: Array, default: [] },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
});

const tournamentSchema = new mongoose.Schema({
    status: { type: String, default: 'waiting' }, // waiting, in_progress, completed
    players: [tournamentPlayerSchema],
    matches: [tournamentMatchSchema],
    championUsername: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
});

const Tournament = mongoose.model('Tournament', tournamentSchema);

module.exports = Tournament;
