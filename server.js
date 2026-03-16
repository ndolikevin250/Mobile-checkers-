require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const app = express();
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const User = require('./models/User');
const Admin = require('./models/Admin');
const GameState = require('./models/GameState');
const ColorPreferences = require('./models/ColorPreferences');
const UserPreferences = require('./models/UserPreferences');
const SinglePlayerGame = require('./models/SinglePlayerGame');
const AITestResult = require('./models/AITestResult');
const UserDashboard = require('./models/UserDashboard');
const Tournament = require('./models/Tournament');
const Friendship = require('./models/Friendship');
const mongoSanitize = require('express-mongo-sanitize');
const { xss } = require('express-xss-sanitizer');

// Helper function to escape HTML and prevent XSS
function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected players
const connectedPlayers = new Map();

// Global registry of ALL authenticated WebSocket connections (username -> Set<ws>)
// Used for friend online status and real-time notifications across all pages
const onlineUsers = new Map();

// Add these at the top with other variables
const waitingPlayers = new Map();
const activeMatches = new Map();
const matchRooms = new Map(); // Store active match connections
const disconnectionTimeouts = new Map(); // Track disconnection grace periods

// ════════════════════════════════════════════════════════════════════
// TOURNAMENT SYSTEM — State & Engine
// ════════════════════════════════════════════════════════════════════

// Tournament matchmaking queue: array of { username, avatar, elo, ws }
const tournamentQueue = [];

// Active tournaments in memory: tournamentId -> { players, connections, boards, turnTimers }
const activeTournaments = new Map();

// Map tournament player username -> ws for quick lookup
const tournamentPlayerSockets = new Map();

// Tournament disconnection grace timers
const tournamentDisconnectTimers = new Map();

// Players currently being assigned to a tournament (guards async race condition)
const playersBeingAssigned = new Set();

// Lock to prevent double match-start when both players ready simultaneously
const matchStartLocks = new Set();

// ── Server-side checkers engine (source of truth for tournament) ──
const T_BOARD_SIZE = 8;
const T_EMPTY = 0, T_P1 = 1, T_P2 = 2, T_P1K = 3, T_P2K = 4;

function tInitBoard() {
    const board = Array(T_BOARD_SIZE).fill(null).map(() => Array(T_BOARD_SIZE).fill(T_EMPTY));
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < T_BOARD_SIZE; c++)
            if ((r + c) % 2 === 1) board[r][c] = T_P2;
    for (let r = 5; r < 8; r++)
        for (let c = 0; c < T_BOARD_SIZE; c++)
            if ((r + c) % 2 === 1) board[r][c] = T_P1;
    return board;
}

function tCloneBoard(b) { return b.map(r => [...r]); }
function tIsP1(p) { return p === T_P1 || p === T_P1K; }
function tIsP2(p) { return p === T_P2 || p === T_P2K; }
function tIsKing(p) { return p === T_P1K || p === T_P2K; }

function tGetValidMoves(board, row, col) {
    const piece = board[row][col];
    if (piece === T_EMPTY) return [];
    const moves = [], jumps = [], dirs = [];
    if (tIsP1(piece) || tIsKing(piece)) dirs.push([-1, -1], [-1, 1]);
    if (tIsP2(piece) || tIsKing(piece)) dirs.push([1, -1], [1, 1]);
    for (const [dr, dc] of dirs) {
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            if (board[nr][nc] === T_EMPTY) {
                moves.push({ fromRow: row, fromCol: col, row: nr, col: nc, jump: false });
            } else {
                const enemy = tIsP1(piece) ? tIsP2(board[nr][nc]) : tIsP1(board[nr][nc]);
                if (enemy) {
                    const jr = nr + dr, jc = nc + dc;
                    if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && board[jr][jc] === T_EMPTY) {
                        jumps.push({ fromRow: row, fromCol: col, row: jr, col: jc, jump: true, capturedRow: nr, capturedCol: nc });
                    }
                }
            }
        }
    }
    return jumps.length > 0 ? jumps : moves;
}

function tGetAllMoves(board, isPlayer1) {
    const allJumps = [], allMoves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if ((isPlayer1 && tIsP1(p)) || (!isPlayer1 && tIsP2(p))) {
                const moves = tGetValidMoves(board, r, c);
                for (const m of moves) {
                    if (m.jump) allJumps.push(m);
                    else allMoves.push(m);
                }
            }
        }
    }
    return allJumps.length > 0 ? allJumps : allMoves;
}

function tApplyMove(board, move) {
    const b = tCloneBoard(board);
    const piece = b[move.fromRow][move.fromCol];
    b[move.fromRow][move.fromCol] = T_EMPTY;
    let newPiece = piece;
    if (tIsP1(piece) && move.row === 0) newPiece = T_P1K;
    if (tIsP2(piece) && move.row === 7) newPiece = T_P2K;
    b[move.row][move.col] = newPiece;
    if (move.jump && move.capturedRow !== undefined && move.capturedCol !== undefined) {
        b[move.capturedRow][move.capturedCol] = T_EMPTY;
    }
    return b;
}

function tValidateMove(board, move, isPlayer1) {
    const piece = board[move.fromRow][move.fromCol];
    if (isPlayer1 && !tIsP1(piece)) return false;
    if (!isPlayer1 && !tIsP2(piece)) return false;
    const legalMoves = tGetAllMoves(board, isPlayer1);
    return legalMoves.some(m =>
        m.fromRow === move.fromRow && m.fromCol === move.fromCol &&
        m.row === move.row && m.col === move.col
    );
}

function tCountPieces(board, isPlayer1) {
    let count = 0;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if ((isPlayer1 && tIsP1(board[r][c])) || (!isPlayer1 && tIsP2(board[r][c]))) count++;
    return count;
}

function tCheckGameOver(board) {
    const p1Pieces = tCountPieces(board, true);
    const p2Pieces = tCountPieces(board, false);
    if (p1Pieces === 0) return 'p2';
    if (p2Pieces === 0) return 'p1';
    const p1Moves = tGetAllMoves(board, true);
    const p2Moves = tGetAllMoves(board, false);
    if (p1Moves.length === 0) return 'p2';
    if (p2Moves.length === 0) return 'p1';
    return null;
}

function tGetJumpsForPiece(board, row, col) {
    return tGetValidMoves(board, row, col).filter(m => m.jump);
}

// ELO calculation
function calculateElo(winnerElo, loserElo) {
    const K = 32;
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));
    return {
        newWinnerElo: Math.round(winnerElo + K * (1 - expectedWinner)),
        newLoserElo: Math.round(loserElo + K * (0 - expectedLoser))
    };
}

// ════════════════════════════════════════════════════════════════════
// TOURNAMENT HELPERS
// ════════════════════════════════════════════════════════════════════

// Send message to a tournament player by username
function tSendToPlayer(username, message) {
    const ws = tournamentPlayerSockets.get(username);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Broadcast to all players in a tournament
function tBroadcastToTournament(tournamentId, message) {
    const tourney = activeTournaments.get(tournamentId);
    if (!tourney) return;
    for (const p of tourney.players) {
        tSendToPlayer(p.username, message);
    }
}

// Create a tournament from 4 queued players
async function createTournament(group) {
    // Sort by ELO for seeding (highest = seed 1)
    const sorted = [...group].sort((a, b) => b.elo - a.elo);
    const seeded = sorted.map((p, i) => ({ ...p, seed: i + 1 }));

    // Bracket: Seed 1 vs Seed 4 (semi1), Seed 2 vs Seed 3 (semi2)
    const semi1P1 = seeded.find(s => s.seed === 1);
    const semi1P2 = seeded.find(s => s.seed === 4);
    const semi2P1 = seeded.find(s => s.seed === 2);
    const semi2P2 = seeded.find(s => s.seed === 3);

    const initialBoard1 = tInitBoard();
    const initialBoard2 = tInitBoard();

    const tournament = new Tournament({
        status: 'in_progress',
        players: seeded.map(p => ({
            userId: p.userId || p.username,
            username: p.username,
            avatar: p.avatar,
            elo: p.elo,
            seed: p.seed
        })),
        matches: [
            {
                round: 'semi1',
                status: 'pending',
                player1: semi1P1.username,
                player2: semi1P2.username,
                boardState: initialBoard1,
                moveHistory: []
            },
            {
                round: 'semi2',
                status: 'pending',
                player1: semi2P1.username,
                player2: semi2P2.username,
                boardState: initialBoard2,
                moveHistory: []
            }
        ]
    });

    await tournament.save();

    // Store in memory for fast access
    activeTournaments.set(tournament._id.toString(), {
        dbId: tournament._id.toString(),
        players: seeded,
        boards: {
            semi1: initialBoard1,
            semi2: initialBoard2
        },
        readyPlayers: {
            semi1: new Set(),
            semi2: new Set(),
            final: new Set()
        },
        turnTimers: {},
        chainJump: {},  // { [round]: { row, col, player } } — tracks multi-jump state
        status: 'in_progress'
    });

    return {
        tournamentId: tournament._id.toString(),
        players: seeded,
        matches: {
            semi1: { round: 'semi1', player1: semi1P1.username, player2: semi1P2.username },
            semi2: { round: 'semi2', player1: semi2P1.username, player2: semi2P2.username },
            final: null
        }
    };
}

// Handle tournament progression after a match ends
async function handleTournamentMatchEnd(tournamentId, round, winnerUsername, loserUsername) {
    const tourney = activeTournaments.get(tournamentId);
    if (!tourney) return;

    try {
        const dbTourney = await Tournament.findById(tournamentId);
        if (!dbTourney) return;

        const match = dbTourney.matches.find(m => m.round === round);
        if (match) {
            match.status = 'completed';
            match.winner = winnerUsername;
            match.completedAt = new Date();
        }

        // Mark loser as eliminated
        const loserPlayer = dbTourney.players.find(p => p.username === loserUsername);
        if (loserPlayer) {
            loserPlayer.eliminated = true;
        }

        // Update ELO for both players
        const winnerPlayer = dbTourney.players.find(p => p.username === winnerUsername);
        if (winnerPlayer && loserPlayer) {
            const { newWinnerElo, newLoserElo } = calculateElo(winnerPlayer.elo, loserPlayer.elo);
            winnerPlayer.elo = newWinnerElo;
            loserPlayer.elo = newLoserElo;

            // Update in-memory too
            const memWinner = tourney.players.find(p => p.username === winnerUsername);
            const memLoser = tourney.players.find(p => p.username === loserUsername);
            if (memWinner) memWinner.elo = newWinnerElo;
            if (memLoser) memLoser.elo = newLoserElo;

            // Update dashboard stats
            await updateTournamentStats(winnerUsername, loserUsername, tournamentId, round);
        }

        await dbTourney.save();

        // Check tournament progression
        const semi1 = dbTourney.matches.find(m => m.round === 'semi1');
        const semi2 = dbTourney.matches.find(m => m.round === 'semi2');
        const finalMatch = dbTourney.matches.find(m => m.round === 'final');

        if (semi1.status === 'completed' && semi2.status === 'completed' && !finalMatch) {
            // Both semis done — create final
            const finalBoard = tInitBoard();
            dbTourney.matches.push({
                round: 'final',
                status: 'pending',
                player1: semi1.winner,
                player2: semi2.winner,
                boardState: finalBoard,
                moveHistory: []
            });
            await dbTourney.save();

            tourney.boards.final = finalBoard;
            tourney.readyPlayers.final = new Set();

            // Notify all 4 players
            tBroadcastToTournament(tournamentId, {
                type: 'tournament_final_ready',
                tournamentId,
                finalMatch: {
                    round: 'final',
                    player1: semi1.winner,
                    player2: semi2.winner
                },
                players: tourney.players.map(p => ({ username: p.username, avatar: p.avatar, elo: p.elo, seed: p.seed, eliminated: dbTourney.players.find(dp => dp.username === p.username)?.eliminated || false }))
            });

            console.log(`[Tournament] Final created: ${semi1.winner} vs ${semi2.winner}`);

        } else if (round === 'final') {
            // Tournament complete!
            dbTourney.status = 'completed';
            dbTourney.championUsername = winnerUsername;
            dbTourney.completedAt = new Date();

            const champPlayer = dbTourney.players.find(p => p.username === winnerUsername);
            if (champPlayer) champPlayer.placement = 1;
            const runnerUp = dbTourney.players.find(p => p.username === loserUsername);
            if (runnerUp) runnerUp.placement = 2;

            await dbTourney.save();

            tBroadcastToTournament(tournamentId, {
                type: 'tournament_champion',
                tournamentId,
                championUsername: winnerUsername,
                players: tourney.players.map(p => ({ username: p.username, avatar: p.avatar, elo: p.elo, seed: p.seed }))
            });

            console.log(`[Tournament] Champion: ${winnerUsername}`);

            // Clean up after a delay
            setTimeout(() => {
                for (const p of tourney.players) {
                    tournamentPlayerSockets.delete(p.username);
                }
                activeTournaments.delete(tournamentId);
            }, 60000);

        } else {
            // One semi done, waiting for the other — notify all players with updated state
            tBroadcastToTournament(tournamentId, {
                type: 'tournament_match_completed',
                tournamentId,
                round,
                winnerUsername,
                loserUsername,
                players: tourney.players.map(p => ({ username: p.username, avatar: p.avatar, elo: p.elo, seed: p.seed, eliminated: dbTourney.players.find(dp => dp.username === p.username)?.eliminated || false }))
            });
        }
    } catch (error) {
        console.error('[Tournament] Error handling match end:', error);
    }
}

// Update dashboard stats for tournament match
async function updateTournamentStats(winnerUsername, loserUsername, tournamentId, round) {
    try {
        for (const { username, result } of [
            { username: winnerUsername, result: 'win' },
            { username: loserUsername, result: 'loss' }
        ]) {
            let dashboard = await UserDashboard.findOne({ username });
            if (!dashboard) {
                const user = await User.findOne({ username });
                if (user) {
                    dashboard = await UserDashboard.findOne({ userId: user._id });
                    if (!dashboard) {
                        dashboard = new UserDashboard({ userId: user._id, username });
                    }
                }
            }
            if (dashboard) {
                const matchKey = `tournament_${tournamentId}_${round}`;
                const alreadyRecorded = dashboard.gameHistory.some(g => g.matchId === matchKey);
                if (!alreadyRecorded) {
                    dashboard.gameHistory.push({
                        opponent: result === 'win' ? loserUsername : winnerUsername,
                        result,
                        difficulty: 'tournament',
                        duration: 0,
                        date: new Date(),
                        matchId: matchKey
                    });
                    if (dashboard.gameHistory.length > 50) {
                        dashboard.gameHistory = dashboard.gameHistory.slice(-50);
                    }
                    if (result === 'win') { dashboard.wins = (dashboard.wins || 0) + 1; }
                    else { dashboard.losses = (dashboard.losses || 0) + 1; }
                    dashboard.totalGames = (dashboard.totalGames || 0) + 1;
                    dashboard.winRate = dashboard.totalGames > 0
                        ? Math.round((dashboard.wins / dashboard.totalGames) * 100)
                        : 0;
                    await dashboard.save();
                }
            }
        }
    } catch (error) {
        console.error('[Tournament] Error updating stats:', error);
    }
}

// Start turn timer for a tournament match
function startTurnTimer(tournamentId, round, currentTurnUsername, timeoutSeconds = 60) {
    const timerKey = `${tournamentId}_${round}`;
    // Clear existing timer
    if (activeTournaments.get(tournamentId)?.turnTimers[timerKey]) {
        clearTimeout(activeTournaments.get(tournamentId).turnTimers[timerKey]);
    }
    const tourney = activeTournaments.get(tournamentId);
    if (!tourney) return;

    tourney.turnTimers[timerKey] = setTimeout(async () => {
        // Time's up — current player forfeits
        console.log(`[Tournament] ${currentTurnUsername} timed out in ${round}`);
        const dbTourney = await Tournament.findById(tournamentId);
        if (!dbTourney) return;
        const match = dbTourney.matches.find(m => m.round === round);
        if (!match || match.status !== 'active') return;

        const winnerUsername = match.player1 === currentTurnUsername ? match.player2 : match.player1;

        // Notify both players
        tSendToPlayer(match.player1, { type: 'tournament_match_timeout', tournamentId, round, timedOutPlayer: currentTurnUsername, winnerUsername, reason: 'timeout' });
        tSendToPlayer(match.player2, { type: 'tournament_match_timeout', tournamentId, round, timedOutPlayer: currentTurnUsername, winnerUsername, reason: 'timeout' });

        await handleTournamentMatchEnd(tournamentId, round, winnerUsername, currentTurnUsername);
    }, timeoutSeconds * 1000);
}

// Clear turn timer
function clearTurnTimer(tournamentId, round) {
    const timerKey = `${tournamentId}_${round}`;
    const tourney = activeTournaments.get(tournamentId);
    if (tourney?.turnTimers[timerKey]) {
        clearTimeout(tourney.turnTimers[timerKey]);
        delete tourney.turnTimers[timerKey];
    }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New client connected');
    let currentMatchId = null; // Track current match for this connection
    let currentUsername = null; // Track which player owns this connection

    ws.on('message', async (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (error) {
            console.error('Invalid JSON received:', error.message);
            return; // Ignore invalid messages to prevent server crashes
        }

        switch(data.type) {
            // ── Global presence tracking (used on all pages) ──
            case 'register_presence':
                if (data.username && data.userType === 'registered') {
                    ws._presenceUsername = data.username;
                    if (!onlineUsers.has(data.username)) {
                        onlineUsers.set(data.username, new Set());
                    }
                    onlineUsers.get(data.username).add(ws);
                    // Notify this user's friends that they came online
                    broadcastFriendStatus(data.username, 'online');
                }
                break;

            case 'join_lobby':
                connectedPlayers.set(data.username, {
                    username: data.username,
                    userType: data.userType,
                    ws: ws
                });
                broadcastPlayerList();
                break;
                
            case 'find_match':
                handleMatchmaking(data, ws);
                break;
                
            case 'cancel_match':
                waitingPlayers.delete(data.username);
                break;
                
            case 'leave_lobby':
                connectedPlayers.delete(data.username);
                waitingPlayers.delete(data.username);
                broadcastPlayerList();
                break;
                
            case 'join_game_room':
                try {
                    currentMatchId = data.matchId;
                    currentUsername = data.username;

                    // Cancel pending timeouts (both disconnection cleanup and player_left notification)
                    const timeoutKey = `${data.matchId}_disconnection`;
                    if (disconnectionTimeouts.has(timeoutKey)) {
                        clearTimeout(disconnectionTimeouts.get(timeoutKey));
                        disconnectionTimeouts.delete(timeoutKey);
                    }
                    const notifyKey = `${data.matchId}_notify_${data.username}`;
                    if (disconnectionTimeouts.has(notifyKey)) {
                        clearTimeout(disconnectionTimeouts.get(notifyKey));
                        disconnectionTimeouts.delete(notifyKey);
                    }

                    if (!matchRooms.has(data.matchId)) {
                        matchRooms.set(data.matchId, new Set());
                    }
                    ws._username = data.username; // Tag WS for reconnection detection
                    matchRooms.get(data.matchId).add(ws);

                    // 1. Try to get match from memory
                    let match = activeMatches.get(data.matchId);
                    let gameState = await GameState.findOne({ matchId: data.matchId });

                    // 2. RECOVERY LOGIC: If memory is empty but DB has game, reconstruct it
                    if (!match && gameState) {
                        // Reconstruct minimal match info needed for colors
                        match = {
                            hostColor: gameState.playerColors.player1,
                            guestColor: gameState.playerColors.player2
                        };
                        // Note: We don't restore to activeMatches map to avoid zombie games,
                        // but we use the local 'match' variable to serve this specific request.
                    }

                    // 3. New Game Logic (Only if we have match info)
                    if (match) {
                        if (!gameState) {
                            // ... (Keep existing code for creating NEW gameState) ...
                            if (data.isHost) {
                                const initialBoard = Array(8).fill(null).map((_, row) => {
                                    return Array(8).fill(null).map((_, col) => {
                                        if ((row + col) % 2 !== 0) {
                                            if (row < 3) return 'blue';
                                            if (row > 4) return 'red';
                                        }
                                        return null;
                                    });
                                });

                                match.hostColor = Math.random() < 0.5 ? 'red' : 'blue';
                                match.guestColor = match.hostColor === 'red' ? 'blue' : 'red';

                                // Save to DB
                                gameState = new GameState({
                                    matchId: data.matchId,
                                    board: initialBoard,
                                    currentPlayer: 'red',
                                    playerColors: {
                                        player1: match.hostColor,
                                        player2: match.guestColor
                                    }
                                });
                                await gameState.save();

                                // Update active match in memory if it exists
                                if (activeMatches.has(data.matchId)) {
                                    activeMatches.get(data.matchId).hostColor = match.hostColor;
                                    activeMatches.get(data.matchId).guestColor = match.guestColor;
                                }
                            } else {
                                // Poll until host's gameState is saved, instead of a hardcoded fixed wait
                                const maxRetries = 5;
                                const retryDelay = 500;
                                for (let attempt = 0; attempt < maxRetries; attempt++) {
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    gameState = await GameState.findOne({ matchId: data.matchId });
                                    if (gameState) break;
                                }
                            }
                        }

                        // 4. Send State to Client
                        if (gameState) {
                            // Determine color based on isHost flag from client
                            // This ensures correct color even after refresh
                            const myColor = data.isHost ? match.hostColor : match.guestColor;

                            ws.send(JSON.stringify({
                                type: 'game_start',
                                color: myColor,
                                gameState: {
                                    board: gameState.board,
                                    currentPlayer: gameState.currentPlayer,
                                    winner: gameState.winner,
                                    playerColors: gameState.playerColors,
                                    isJumpSequence: false,
                                    validJumpDestinations: []
                                }
                            }));

                            // Handle Game Over State on Rejoin
                            if (gameState.currentPlayer === null && gameState.winner) {
                                ws.send(JSON.stringify({
                                    type: 'game_end',
                                    winner: gameState.winner
                                }));
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error handling game room join:', error);
                }
                break;

            case 'move':
                try {
                    const updatedGameState = await GameState.findOneAndUpdate(
                        { matchId: data.matchId },
                        {
                            $set: {
                                board: data.gameState.board,
                                currentPlayer: data.gameState.currentPlayer,
                                isJumpSequence: data.gameState.isJumpSequence,
                                validJumpDestinations: data.gameState.validJumpDestinations
                            }
                        },
                        { new: true }
                    );

                    if (updatedGameState && matchRooms.has(data.matchId)) {
                        // Broadcast only to players in this match
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'move',
                                    username: data.username,
                                    move: data.move,
                                    gameState: {
                                        board: updatedGameState.board,
                                        currentPlayer: updatedGameState.currentPlayer,
                                        isJumpSequence: updatedGameState.isJumpSequence,
                                        validJumpDestinations: updatedGameState.validJumpDestinations
                                    }
                                }));
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error handling move:', error);
                }
                break;

            case 'leave_game_room':
            case 'end_session':
                try {
                    if (matchRooms.has(data.matchId)) {
                        // Notify only players in this match
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: data.type === 'leave_game_room' ? 'player_left' : 'end_session',
                                    username: data.username
                                }));
                            }
                        });

                        // Remove the connection from the match room
                        matchRooms.get(data.matchId).delete(ws);
                        
                        // If room is empty, clean up
                        if (matchRooms.get(data.matchId).size === 0) {
                            matchRooms.delete(data.matchId);
                            if (data.endGame) {
                                await GameState.deleteOne({ matchId: data.matchId });
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error handling leave/end:', error);
                }
                break;

            case 'chat':
                try {
                    const updatedGameState = await GameState.findOneAndUpdate(
                        { matchId: data.matchId },
                        {
                            $push: {
                                chatHistory: {
                                    username: data.username,
                                    message: escapeHtml(data.message),
                                    timestamp: new Date(),
                                    isRead: false
                                }
                            }
                        },
                        { new: true }
                    );

                    if (updatedGameState && matchRooms.has(data.matchId)) {
                        // Broadcast only to players in this match
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'chat',
                                    username: data.username,
                                    message: escapeHtml(data.message),
                                    timestamp: new Date(),
                                    matchId: data.matchId
                                }));
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error handling chat:', error);
                }
                break;

        case 'game_end':
            try {
                // 1. Update DB (Keep this part)
                await GameState.findOneAndUpdate(
                    { matchId: data.matchId },
                    {
                        $set: {
                            currentPlayer: null,
                            winner: data.winner
                        }
                    }
                );

                // 2. Update user statistics server-side (only once per match)
                await updateMultiplayerStatsServerSide(data.matchId, data.winner, data.username);

                // 3. Broadcast FIRST (Fix)
                if (matchRooms.has(data.matchId)) {
                    matchRooms.get(data.matchId).forEach(client => {
                        // Check if client is open before sending
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'game_end',
                                winner: data.winner,
                                matchId: data.matchId
                            }));
                        }
                    });
                }

                // 4. DO NOT DELETE - Keep room open for chat and rematch requests
                // activeMatches.delete(data.matchId);  // <-- REMOVED
                // if (matchRooms.has(data.matchId)) {  // <-- REMOVED
                //    matchRooms.delete(data.matchId);  // <-- REMOVED
                // }

            } catch (error) {
                console.error('Error handling game end:', error);
            }
            break;

            case 'rematch_request':
                try {
                    if (matchRooms.has(data.matchId)) {
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'rematch_request',
                                    username: data.username
                                }));
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error handling rematch request:', error);
                }
                break;

            case 'rematch_accepted':
                try {
                    if (matchRooms.has(data.matchId)) {
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'rematch_accepted',
                                    username: data.username
                                }));
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error handling rematch acceptance:', error);
                }
                break;

            case 'game_reset':
                try {
                    // Reset game state in database
                    await GameState.findOneAndUpdate(
                        { matchId: data.matchId },
                        {
                            $set: {
                                board: Array(8).fill(null).map((_, row) => {
                                    return Array(8).fill(null).map((_, col) => {
                                        if ((row + col) % 2 !== 0) {
                                            if (row < 3) return 'blue';
                                            if (row > 4) return 'red';
                                        }
                                        return null;
                                    });
                                }),
                                currentPlayer: 'red',
                                isJumpSequence: false,
                                validJumpDestinations: [],
                                chatHistory: [] // Optionally clear chat history for new game
                            }
                        },
                        { new: true }
                    );

                    // Notify all players in the match
                    if (matchRooms.has(data.matchId)) {
                        matchRooms.get(data.matchId).forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'game_reset'
                                }));
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error handling game reset:', error);
                }
                break;

            // ════════════════════════════════════════════════════════════
            // TOURNAMENT SYSTEM — WebSocket Handlers
            // ════════════════════════════════════════════════════════════

            case 'tournament_join':
                try {
                    const tjUsername = escapeHtml(data.username);
                    const tjAvatar = data.avatar || '♟';
                    const tjElo = data.elo || 1000;
                    const tjUserId = data.userId || tjUsername;

                    if (!tjUsername) {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Username required' }));
                        break;
                    }

                    // Block guests
                    if (data.userType === 'guest') {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Guests cannot join tournaments. Please register an account.' }));
                        break;
                    }

                    // Guard: if this player is currently being assigned to a tournament, ignore duplicate join
                    if (playersBeingAssigned.has(tjUsername)) {
                        console.log(`[Tournament Queue] ${tjUsername} duplicate join ignored (tournament being created)`);
                        break;
                    }

                    // Guard: if this player is already in an active tournament, don't re-queue
                    let alreadyInTournament = false;
                    for (const [tId, tourney] of activeTournaments) {
                        if (tourney.players.some(p => p.username === tjUsername) && tourney.status === 'in_progress') {
                            alreadyInTournament = true;
                            break;
                        }
                    }
                    if (alreadyInTournament) {
                        console.log(`[Tournament Queue] ${tjUsername} already in active tournament, ignoring join`);
                        // Update their socket reference for the active tournament
                        ws._tournamentUsername = tjUsername;
                        tournamentPlayerSockets.set(tjUsername, ws);
                        break;
                    }

                    // Remove any existing queue entry for this player
                    const existingIdx = tournamentQueue.findIndex(q => q.username === tjUsername);
                    if (existingIdx >= 0) tournamentQueue.splice(existingIdx, 1);

                    // Track this player's socket
                    ws._tournamentUsername = tjUsername;
                    tournamentPlayerSockets.set(tjUsername, ws);

                    tournamentQueue.push({ username: tjUsername, avatar: tjAvatar, elo: tjElo, userId: tjUserId, ws });

                    console.log(`[Tournament Queue] ${tjUsername} joined. Queue size: ${tournamentQueue.length}`);

                    // Broadcast queue update to all queued players
                    for (const qp of tournamentQueue) {
                        if (qp.ws.readyState === WebSocket.OPEN) {
                            qp.ws.send(JSON.stringify({
                                type: 'tournament_queue_update',
                                queueSize: tournamentQueue.length,
                                players: tournamentQueue.map(q => ({ username: q.username, avatar: q.avatar }))
                            }));
                        }
                    }

                    // If we have 4 players, create tournament
                    if (tournamentQueue.length >= 4) {
                        const group = tournamentQueue.splice(0, 4);

                        // Mark all players as being assigned (prevents re-queue during async creation)
                        for (const gp of group) {
                            playersBeingAssigned.add(gp.username);
                        }

                        console.log(`[Tournament] Creating tournament for: ${group.map(g => g.username).join(', ')}`);

                        let tournamentData;
                        try {
                            tournamentData = await createTournament(group);
                            console.log(`[Tournament] Created ${tournamentData.tournamentId} successfully`);
                        } catch (createError) {
                            console.error('[Tournament] createTournament FAILED:', createError);
                            // RECOVERY: put all 4 players back in the queue
                            for (const gp of group) {
                                playersBeingAssigned.delete(gp.username);
                                // Only re-queue if their socket is still open
                                const latestWs = tournamentPlayerSockets.get(gp.username);
                                if (latestWs && latestWs.readyState === WebSocket.OPEN) {
                                    tournamentQueue.push(gp);
                                }
                            }
                            // Broadcast updated queue to all re-queued players
                            for (const qp of tournamentQueue) {
                                if (qp.ws.readyState === WebSocket.OPEN) {
                                    qp.ws.send(JSON.stringify({
                                        type: 'tournament_queue_update',
                                        queueSize: tournamentQueue.length,
                                        players: tournamentQueue.map(q => ({ username: q.username, avatar: q.avatar }))
                                    }));
                                }
                            }
                            break;
                        }

                        // Clear assignment locks
                        for (const gp of group) {
                            playersBeingAssigned.delete(gp.username);
                        }

                        // Notify all 4 players using LATEST socket reference
                        const createdMsg = {
                            type: 'tournament_created',
                            tournamentId: tournamentData.tournamentId,
                            players: tournamentData.players.map(p => ({
                                username: p.username,
                                avatar: p.avatar,
                                elo: p.elo,
                                seed: p.seed
                            })),
                            matches: tournamentData.matches
                        };

                        for (const gp of group) {
                            try {
                                const latestWs = tournamentPlayerSockets.get(gp.username);
                                const targetWs = (latestWs && latestWs.readyState === WebSocket.OPEN) ? latestWs : gp.ws;
                                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(JSON.stringify({ ...createdMsg, yourUsername: gp.username }));
                                    console.log(`[Tournament] Sent tournament_created to ${gp.username}`);
                                } else {
                                    console.warn(`[Tournament] Could not send tournament_created to ${gp.username} - socket not open`);
                                }
                            } catch (sendError) {
                                console.error(`[Tournament] Error sending tournament_created to ${gp.username}:`, sendError);
                            }
                        }

                        // Update remaining queue players
                        for (const qp of tournamentQueue) {
                            if (qp.ws.readyState === WebSocket.OPEN) {
                                qp.ws.send(JSON.stringify({
                                    type: 'tournament_queue_update',
                                    queueSize: tournamentQueue.length,
                                    players: tournamentQueue.map(q => ({ username: q.username, avatar: q.avatar }))
                                }));
                            }
                        }
                    }
                } catch (error) {
                    console.error('[Tournament] Error in tournament_join handler:', error);
                    playersBeingAssigned.clear();
                    try {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Failed to join tournament queue' }));
                    } catch (e) { /* socket may be dead */ }
                }
                break;

            case 'tournament_reconnect':
                try {
                    const trUsername = data.username;
                    if (!trUsername) break;

                    // Update socket reference so server can reach this player
                    ws._tournamentUsername = trUsername;
                    tournamentPlayerSockets.set(trUsername, ws);

                    // Cancel any pending disconnect forfeit timers for this player
                    for (const [tId, tourney] of activeTournaments) {
                        if (!tourney.players.some(p => p.username === trUsername)) continue;
                        const disconnectKey = `${tId}_${trUsername}`;
                        if (tournamentDisconnectTimers.has(disconnectKey)) {
                            clearTimeout(tournamentDisconnectTimers.get(disconnectKey));
                            tournamentDisconnectTimers.delete(disconnectKey);
                            console.log(`[Tournament] ${trUsername} reconnected, cancelled disconnect timer`);
                        }

                        // Resync game state — send current board if player is in an active match
                        const dbTourney = await Tournament.findById(tId);
                        if (!dbTourney || dbTourney.status === 'completed') continue;

                        for (const match of dbTourney.matches) {
                            if (match.status === 'active' && (match.player1 === trUsername || match.player2 === trUsername)) {
                                const board = tourney.boards[match.round] || match.boardState;
                                const p1Data = tourney.players.find(p => p.username === match.player1);
                                const p2Data = tourney.players.find(p => p.username === match.player2);

                                const reconnectChainJump = tourney.chainJump?.[match.round] || null;
                                ws.send(JSON.stringify({
                                    type: 'tournament_match_start',
                                    tournamentId: tId,
                                    round: match.round,
                                    board,
                                    currentTurn: match.currentTurn,
                                    player1: { username: match.player1, avatar: p1Data?.avatar || '♟', elo: p1Data?.elo || 1000 },
                                    player2: { username: match.player2, avatar: p2Data?.avatar || '♟', elo: p2Data?.elo || 1000 },
                                    chainJumpPiece: reconnectChainJump ? { row: reconnectChainJump.row, col: reconnectChainJump.col } : null
                                }));
                                console.log(`[Tournament] Resynced game state for ${trUsername} in ${match.round}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('[Tournament] Error handling reconnect:', error);
                }
                break;

            case 'tournament_leave':
                try {
                    const tlUsername = data.username || ws._tournamentUsername;

                    // 1. Remove from queue if still queuing
                    const idx = tournamentQueue.findIndex(q => q.username === tlUsername);
                    if (idx >= 0) {
                        tournamentQueue.splice(idx, 1);
                        console.log(`[Tournament Queue] ${tlUsername} left. Queue size: ${tournamentQueue.length}`);
                    }

                    // Broadcast updated queue
                    for (const qp of tournamentQueue) {
                        if (qp.ws.readyState === WebSocket.OPEN) {
                            qp.ws.send(JSON.stringify({
                                type: 'tournament_queue_update',
                                queueSize: tournamentQueue.length,
                                players: tournamentQueue.map(q => ({ username: q.username, avatar: q.avatar }))
                            }));
                        }
                    }

                    // 2. Forfeit any active match (intentional leave = immediate forfeit, no grace period)
                    for (const [tId, tourney] of activeTournaments) {
                        if (!tourney.players.some(p => p.username === tlUsername)) continue;

                        // Cancel any pending disconnect timer
                        const disconnectKey = `${tId}_${tlUsername}`;
                        if (tournamentDisconnectTimers.has(disconnectKey)) {
                            clearTimeout(tournamentDisconnectTimers.get(disconnectKey));
                            tournamentDisconnectTimers.delete(disconnectKey);
                        }

                        const dbTourney = await Tournament.findById(tId);
                        if (!dbTourney || dbTourney.status === 'completed') continue;

                        // Check active matches this player is in
                        for (const match of dbTourney.matches) {
                            if (match.status === 'active' && (match.player1 === tlUsername || match.player2 === tlUsername)) {
                                const winnerUsername = match.player1 === tlUsername ? match.player2 : match.player1;
                                clearTurnTimer(tId, match.round);

                                match.status = 'completed';
                                match.winner = winnerUsername;
                                match.completedAt = new Date();
                                match.currentTurn = null;
                                await dbTourney.save();

                                const forfeitMsg = {
                                    type: 'tournament_opponent_disconnected',
                                    tournamentId: tId,
                                    round: match.round,
                                    winnerUsername,
                                    disconnectedPlayer: tlUsername,
                                    reason: 'forfeit'
                                };

                                // Notify BOTH players (winner gets victory, forfeiter gets defeat + bracket transition)
                                tSendToPlayer(winnerUsername, forfeitMsg);
                                tSendToPlayer(tlUsername, forfeitMsg);

                                await handleTournamentMatchEnd(tId, match.round, winnerUsername, tlUsername);
                                console.log(`[Tournament] ${tlUsername} forfeited ${match.round} by leaving`);
                            }
                        }

                        // Check pending final match
                        const finalMatch = dbTourney.matches.find(m => m.round === 'final' && m.status === 'pending');
                        if (finalMatch && (finalMatch.player1 === tlUsername || finalMatch.player2 === tlUsername)) {
                            const winnerUsername = finalMatch.player1 === tlUsername ? finalMatch.player2 : finalMatch.player1;
                            finalMatch.status = 'completed';
                            finalMatch.winner = winnerUsername;
                            finalMatch.completedAt = new Date();
                            await dbTourney.save();

                            const forfeitMsg = {
                                type: 'tournament_opponent_disconnected',
                                tournamentId: tId,
                                round: 'final',
                                winnerUsername,
                                disconnectedPlayer: tlUsername,
                                reason: 'forfeit'
                            };

                            tSendToPlayer(winnerUsername, forfeitMsg);
                            tSendToPlayer(tlUsername, forfeitMsg);

                            await handleTournamentMatchEnd(tId, 'final', winnerUsername, tlUsername);
                        }
                    }

                    tournamentPlayerSockets.delete(tlUsername);
                } catch (error) {
                    console.error('[Tournament] Error leaving tournament:', error);
                }
                break;

            case 'tournament_match_ready':
                try {
                    const tmrTourneyId = data.tournamentId;
                    const tmrRound = data.round; // "semi1", "semi2", "final"
                    const tmrUsername = data.username;

                    const tourney = activeTournaments.get(tmrTourneyId);
                    if (!tourney) {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Tournament not found' }));
                        break;
                    }

                    // Update socket reference (may have reconnected)
                    ws._tournamentUsername = tmrUsername;
                    tournamentPlayerSockets.set(tmrUsername, ws);

                    // Mark as ready
                    tourney.readyPlayers[tmrRound].add(tmrUsername);

                    // Find the match
                    const dbTourney = await Tournament.findById(tmrTourneyId);
                    const match = dbTourney.matches.find(m => m.round === tmrRound);
                    if (!match) {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Match not found' }));
                        break;
                    }

                    console.log(`[Tournament] ${tmrUsername} ready for ${tmrRound}. Ready: ${tourney.readyPlayers[tmrRound].size}/2`);

                    // Check if both players ready
                    if (tourney.readyPlayers[tmrRound].has(match.player1) && tourney.readyPlayers[tmrRound].has(match.player2)) {
                        // Race-condition guard: prevent double match-start
                        const lockKey = `${tmrTourneyId}_${tmrRound}`;
                        if (matchStartLocks.has(lockKey)) break;
                        matchStartLocks.add(lockKey);

                        try {
                        // Start the match!
                        match.status = 'active';
                        match.startedAt = new Date();
                        match.currentTurn = match.player1; // P1 always goes first
                        const board = tourney.boards[tmrRound] || tInitBoard();
                        match.boardState = board;
                        tourney.boards[tmrRound] = board;
                        // Clear any chain-jump state for this round
                        delete tourney.chainJump[tmrRound];
                        await dbTourney.save();

                        const p1Data = tourney.players.find(p => p.username === match.player1);
                        const p2Data = tourney.players.find(p => p.username === match.player2);

                        const startMsg = {
                            type: 'tournament_match_start',
                            tournamentId: tmrTourneyId,
                            round: tmrRound,
                            board,
                            currentTurn: match.player1,
                            player1: { username: match.player1, avatar: p1Data?.avatar || '♟', elo: p1Data?.elo || 1000 },
                            player2: { username: match.player2, avatar: p2Data?.avatar || '♟', elo: p2Data?.elo || 1000 }
                        };

                        tSendToPlayer(match.player1, startMsg);
                        tSendToPlayer(match.player2, startMsg);

                        // Also notify spectating players (the other 2 in semis)
                        for (const p of tourney.players) {
                            if (p.username !== match.player1 && p.username !== match.player2) {
                                tSendToPlayer(p.username, {
                                    type: 'tournament_match_started_spectator',
                                    tournamentId: tmrTourneyId,
                                    round: tmrRound,
                                    player1: match.player1,
                                    player2: match.player2
                                });
                            }
                        }

                        // Start turn timer
                        startTurnTimer(tmrTourneyId, tmrRound, match.player1);

                        console.log(`[Tournament] Match ${tmrRound} started: ${match.player1} vs ${match.player2}`);
                        } finally {
                            matchStartLocks.delete(lockKey);
                        }
                    } else {
                        ws.send(JSON.stringify({
                            type: 'tournament_match_waiting',
                            tournamentId: tmrTourneyId,
                            round: tmrRound,
                            message: 'Waiting for opponent...'
                        }));
                    }
                } catch (error) {
                    console.error('[Tournament] Error readying for match:', error);
                }
                break;

            case 'tournament_move':
                try {
                    const tmTourneyId = data.tournamentId;
                    const tmRound = data.round;
                    const tmUsername = data.username;
                    const tmMove = data.move;

                    const tourney = activeTournaments.get(tmTourneyId);
                    if (!tourney) {
                        ws.send(JSON.stringify({ type: 'tournament_error', message: 'Tournament not found' }));
                        break;
                    }

                    const dbTourney = await Tournament.findById(tmTourneyId);
                    const match = dbTourney.matches.find(m => m.round === tmRound);
                    if (!match || match.status !== 'active') {
                        ws.send(JSON.stringify({ type: 'tournament_move_rejected', message: 'Match not active' }));
                        break;
                    }

                    // Is it this player's turn?
                    if (match.currentTurn !== tmUsername) {
                        ws.send(JSON.stringify({ type: 'tournament_move_rejected', message: 'Not your turn' }));
                        break;
                    }

                    // Get authoritative board
                    let board = tourney.boards[tmRound];
                    if (!board) {
                        board = match.boardState;
                        tourney.boards[tmRound] = board;
                    }

                    const isPlayer1 = tmUsername === match.player1;

                    // ── Chain-jump enforcement ──
                    const chainJump = tourney.chainJump?.[tmRound] || null;
                    if (chainJump) {
                        // Must move from the chain-jump piece and must be a jump
                        if (tmMove.fromRow !== chainJump.row || tmMove.fromCol !== chainJump.col) {
                            ws.send(JSON.stringify({ type: 'tournament_move_rejected', message: 'Must continue chain jump with the same piece' }));
                            break;
                        }
                        // Validate it's a legal jump for that piece
                        const pieceJumps = tGetJumpsForPiece(board, chainJump.row, chainJump.col);
                        const isLegalChainJump = pieceJumps.some(m =>
                            m.row === tmMove.row && m.col === tmMove.col
                        );
                        if (!isLegalChainJump) {
                            ws.send(JSON.stringify({ type: 'tournament_move_rejected', message: 'Invalid chain jump' }));
                            break;
                        }
                    } else {
                        // Normal validation (mandatory jumps enforced by tGetAllMoves)
                        if (!tValidateMove(board, tmMove, isPlayer1)) {
                            ws.send(JSON.stringify({ type: 'tournament_move_rejected', message: 'Invalid move' }));
                            break;
                        }
                    }

                    // Remember piece type BEFORE applying (for promotion detection)
                    const pieceBeforeMove = board[tmMove.fromRow][tmMove.fromCol];
                    const wasKingBefore = tIsKing(pieceBeforeMove);

                    // Apply the move
                    const newBoard = tApplyMove(board, tmMove);
                    tourney.boards[tmRound] = newBoard;

                    const history = match.moveHistory || [];
                    history.push(tmMove);

                    // Check game over
                    const gameResult = tCheckGameOver(newBoard);

                    if (gameResult) {
                        // ── GAME OVER ──
                        clearTurnTimer(tmTourneyId, tmRound);
                        delete tourney.chainJump[tmRound];

                        const winnerUsername = gameResult === 'p1' ? match.player1 : match.player2;
                        const loserUsername = gameResult === 'p1' ? match.player2 : match.player1;

                        match.status = 'completed';
                        match.boardState = newBoard;
                        match.moveHistory = history;
                        match.winner = winnerUsername;
                        match.completedAt = new Date();
                        match.currentTurn = null;
                        await dbTourney.save();

                        const gameOverMsg = {
                            type: 'tournament_game_over',
                            tournamentId: tmTourneyId,
                            round: tmRound,
                            board: newBoard,
                            lastMove: tmMove,
                            winnerUsername,
                            loserUsername,
                            reason: 'checkmate'
                        };
                        tSendToPlayer(match.player1, gameOverMsg);
                        tSendToPlayer(match.player2, gameOverMsg);

                        delete tourney.boards[tmRound];

                        // Handle bracket progression
                        await handleTournamentMatchEnd(tmTourneyId, tmRound, winnerUsername, loserUsername);

                    } else {
                        // ── GAME CONTINUES ──
                        // Determine if this was a jump and if chain-jump should continue
                        const moveWasJump = tmMove.jump || (tmMove.capturedRow !== undefined && tmMove.capturedCol !== undefined);
                        let chainJumpPiece = null;
                        let switchTurn = true;

                        if (moveWasJump) {
                            // Check if piece was promoted (non-king landed on promotion row)
                            const promoted = !wasKingBefore && tIsKing(newBoard[tmMove.row][tmMove.col]);

                            if (!promoted) {
                                // Check for additional jumps from the landing square
                                const moreJumps = tGetJumpsForPiece(newBoard, tmMove.row, tmMove.col);
                                if (moreJumps.length > 0) {
                                    // Chain jump continues — same player's turn
                                    switchTurn = false;
                                    chainJumpPiece = { row: tmMove.row, col: tmMove.col };
                                    tourney.chainJump[tmRound] = { row: tmMove.row, col: tmMove.col, player: tmUsername };
                                }
                            }
                        }

                        // If not continuing chain jump, clear it
                        if (switchTurn) {
                            delete tourney.chainJump[tmRound];
                        }

                        const nextTurn = switchTurn ? (isPlayer1 ? match.player2 : match.player1) : tmUsername;

                        match.boardState = newBoard;
                        match.moveHistory = history;
                        match.currentTurn = nextTurn;
                        await dbTourney.save();

                        // Reset turn timer (reset on each step, even during chain jump)
                        clearTurnTimer(tmTourneyId, tmRound);
                        startTurnTimer(tmTourneyId, tmRound, nextTurn);

                        const moveMsg = {
                            type: 'tournament_move_made',
                            tournamentId: tmTourneyId,
                            round: tmRound,
                            board: newBoard,
                            lastMove: tmMove,
                            currentTurn: nextTurn,
                            chainJumpPiece: chainJumpPiece  // null if turn switched, {row,col} if chain continues
                        };
                        tSendToPlayer(match.player1, moveMsg);
                        tSendToPlayer(match.player2, moveMsg);
                    }
                } catch (error) {
                    console.error('[Tournament] Error processing move:', error);
                    ws.send(JSON.stringify({ type: 'tournament_error', message: 'Server error processing move' }));
                }
                break;
        }
    });

    ws.on('close', async () => {
        // ── Tournament disconnect handling ──
        const tUsername = ws._tournamentUsername;
        if (tUsername) {
            // Only remove from queue if this closing ws is the SAME one in the queue
            // (prevents stale close handlers from removing a reconnected player's new entry)
            const qIdx = tournamentQueue.findIndex(q => q.username === tUsername && q.ws === ws);
            if (qIdx >= 0) {
                tournamentQueue.splice(qIdx, 1);
                console.log(`[Tournament Queue] ${tUsername} disconnected. Queue size: ${tournamentQueue.length}`);
                for (const qp of tournamentQueue) {
                    if (qp.ws.readyState === WebSocket.OPEN) {
                        qp.ws.send(JSON.stringify({
                            type: 'tournament_queue_update',
                            queueSize: tournamentQueue.length,
                            players: tournamentQueue.map(q => ({ username: q.username, avatar: q.avatar }))
                        }));
                    }
                }
            }

            // Check if player is in an active tournament match
            for (const [tId, tourney] of activeTournaments) {
                const isInTourney = tourney.players.some(p => p.username === tUsername);
                if (!isInTourney) continue;

                // Only start disconnect timer if this ws is still the latest socket for this player
                // (if they already reconnected with a newer socket, skip the timer)
                const latestSocket = tournamentPlayerSockets.get(tUsername);
                if (latestSocket && latestSocket !== ws && latestSocket.readyState === WebSocket.OPEN) {
                    console.log(`[Tournament] ${tUsername} already reconnected with new socket, skipping disconnect timer`);
                    continue;
                }

                // Start a 30-second grace period for reconnection
                const disconnectKey = `${tId}_${tUsername}`;
                if (tournamentDisconnectTimers.has(disconnectKey)) {
                    clearTimeout(tournamentDisconnectTimers.get(disconnectKey));
                }

                tournamentDisconnectTimers.set(disconnectKey, setTimeout(async () => {
                    tournamentDisconnectTimers.delete(disconnectKey);

                    // Check if player reconnected
                    const currentWs = tournamentPlayerSockets.get(tUsername);
                    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                        return; // Reconnected, do nothing
                    }

                    // Player did not reconnect — forfeit any active match
                    try {
                        const dbTourney = await Tournament.findById(tId);
                        if (!dbTourney || dbTourney.status === 'completed') return;

                        for (const match of dbTourney.matches) {
                            if (match.status === 'active' && (match.player1 === tUsername || match.player2 === tUsername)) {
                                const winnerUsername = match.player1 === tUsername ? match.player2 : match.player1;
                                clearTurnTimer(tId, match.round);

                                match.status = 'completed';
                                match.winner = winnerUsername;
                                match.completedAt = new Date();
                                match.currentTurn = null;
                                await dbTourney.save();

                                tSendToPlayer(winnerUsername, {
                                    type: 'tournament_opponent_disconnected',
                                    tournamentId: tId,
                                    round: match.round,
                                    winnerUsername,
                                    disconnectedPlayer: tUsername,
                                    reason: 'disconnect'
                                });

                                await handleTournamentMatchEnd(tId, match.round, winnerUsername, tUsername);
                                console.log(`[Tournament] ${tUsername} forfeited ${match.round} by disconnect`);
                            }
                        }

                        // If player was supposed to play in final but disconnected
                        const finalMatch = dbTourney.matches.find(m => m.round === 'final' && m.status === 'pending');
                        if (finalMatch && (finalMatch.player1 === tUsername || finalMatch.player2 === tUsername)) {
                            const winnerUsername = finalMatch.player1 === tUsername ? finalMatch.player2 : finalMatch.player1;
                            finalMatch.status = 'completed';
                            finalMatch.winner = winnerUsername;
                            finalMatch.completedAt = new Date();
                            await dbTourney.save();

                            tSendToPlayer(winnerUsername, {
                                type: 'tournament_opponent_disconnected',
                                tournamentId: tId,
                                round: 'final',
                                winnerUsername,
                                disconnectedPlayer: tUsername,
                                reason: 'disconnect'
                            });

                            await handleTournamentMatchEnd(tId, 'final', winnerUsername, tUsername);
                        }
                    } catch (err) {
                        console.error('[Tournament] Error handling disconnect forfeit:', err);
                    }
                }, 30000)); // 30 second grace period
            }
        }

        // Clean up the connection from its match room when disconnected
        if (currentMatchId && matchRooms.has(currentMatchId)) {
            matchRooms.get(currentMatchId).delete(ws);

            const remainingClients = matchRooms.get(currentMatchId);

            // Delay player_left notification to allow for brief reconnections (e.g. during rematch)
            const notifyKey = `${currentMatchId}_notify_${currentUsername}`;
            disconnectionTimeouts.set(notifyKey, setTimeout(() => {
                // Only notify if player hasn't reconnected (room still missing their connection)
                if (matchRooms.has(currentMatchId)) {
                    const currentClients = matchRooms.get(currentMatchId);
                    // Check if the player reconnected by counting clients
                    let reconnected = false;
                    for (const client of currentClients) {
                        if (client._username === currentUsername) {
                            reconnected = true;
                            break;
                        }
                    }
                    if (!reconnected && currentClients.size > 0) {
                        for (const client of currentClients) {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'player_left',
                                    username: currentUsername
                                }));
                            }
                        }
                    }
                }
                disconnectionTimeouts.delete(notifyKey);
            }, 3000)); // 3 second grace period before notifying

            // Give the disconnected player a grace period to reconnect before cleaning up
            const timeoutKey = `${currentMatchId}_disconnection`;
            disconnectionTimeouts.set(timeoutKey, setTimeout(async () => {
                if (matchRooms.has(currentMatchId)) {
                    activeMatches.delete(currentMatchId);
                    matchRooms.delete(currentMatchId);

                    try {
                        await GameState.findOneAndUpdate(
                            { matchId: currentMatchId },
                            { $set: { currentPlayer: null } }
                        );
                        console.log(`Match ${currentMatchId} ended after disconnection timeout (${currentUsername} left)`);
                    } catch (error) {
                        console.error(`Error ending match ${currentMatchId}:`, error);
                    }
                }
                disconnectionTimeouts.delete(timeoutKey);
            }, 10000)); // 10 second grace period for reconnection
        }
        // ── Presence cleanup ──
        const presenceUser = ws._presenceUsername;
        if (presenceUser && onlineUsers.has(presenceUser)) {
            onlineUsers.get(presenceUser).delete(ws);
            if (onlineUsers.get(presenceUser).size === 0) {
                onlineUsers.delete(presenceUser);
                // Notify friends this user went offline
                broadcastFriendStatus(presenceUser, 'offline');
            }
        }

        console.log(`Client disconnected: ${currentUsername || 'unknown'}`);
    });
});

// ── Friend online status broadcast ──
async function broadcastFriendStatus(username, status) {
    try {
        // Find all accepted friendships involving this user
        const friendships = await Friendship.find({
            status: 'accepted',
            $or: [{ requester: username }, { recipient: username }]
        });

        for (const f of friendships) {
            const friendName = f.requester === username ? f.recipient : f.requester;
            const friendSockets = onlineUsers.get(friendName);
            if (friendSockets) {
                const msg = JSON.stringify({
                    type: 'friend_status',
                    username: username,
                    status: status
                });
                for (const sock of friendSockets) {
                    if (sock.readyState === WebSocket.OPEN) {
                        sock.send(msg);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Friends] Error broadcasting status:', err);
    }
}

// ── Send real-time notification to a specific user ──
function notifyUser(username, payload) {
    const sockets = onlineUsers.get(username);
    if (!sockets) return;
    const msg = JSON.stringify(payload);
    for (const sock of sockets) {
        if (sock.readyState === WebSocket.OPEN) {
            sock.send(msg);
        }
    }
}

function broadcastPlayerList() {
    const players = Array.from(connectedPlayers.values());
    const message = JSON.stringify({
        type: 'player_list',
        players: players
    });
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Update the MongoDB connection setup
mongoose.set('strictQuery', false);

mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    family: 4,
    retryWrites: true,
    w: 'majority',
    dbName: 'checkers'
})
.then(() => {
    // Remove this log since we'll use the event handler instead
})
.catch(err => {
    console.error('MongoDB initial connection error:', err);
    reconnectWithBackoff();
});

// Exponential backoff reconnect — max 5 retries, caps at 30s
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function reconnectWithBackoff() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`❌ MongoDB: failed after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts. Giving up.`);
        return;
    }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.log(`⚠️  MongoDB reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);
    setTimeout(() => {
        mongoose.connect(process.env.MONGODB_URI).catch(() => {});
    }, delay);
}

// Connection event handlers
mongoose.connection.on('error', err => {
    console.error('❌ MongoDB connection error:', err);
    reconnectWithBackoff();
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️  MongoDB disconnected.');
    reconnectWithBackoff();
});

mongoose.connection.on('connected', () => {
    reconnectAttempts = 0; // Reset counter on successful connection
});

// Security headers with helmet
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: [],
        }
    }
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Serve static files with no-cache for CSS/JS so browsers always check for updates
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Rate limiter for authentication routes (100 requests per 15 minutes)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Registration endpoint
app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new user
        const user = new User({
            username,
            password: hashedPassword
        });
        
        await user.save();
        
        res.status(201).json({ message: 'Account created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Error during registration' });
    }
});

// Login endpoint
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        
        // Create JWT token
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ 
            message: 'Login successful',
            token,
            username: user.username
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Error during login' });
    }
});

// User authentication middleware - for regular user routes only
// This ensures admins cannot access user routes (they must use admin routes)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access denied - No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }

        // CRITICAL: Prevent admins from accessing user routes
        // Admins must use /api/admin/* routes, not /api/user/* routes
        // EXCEPTION: Allow admins to access their personal dashboard and preferences for game functionality
        if (decoded.role === 'admin' &&
            req.path !== '/api/user/dashboard' &&
            req.path !== '/api/user/dashboard/update' &&
            !req.path.startsWith('/api/preferences/') &&
            !req.path.startsWith('/api/friends/')) {
            console.log('Admin trying to access non-dashboard user route:', req.path);
            return res.status(403).json({
                message: 'Admin accounts must use admin routes. Use /api/admin/* endpoints instead.'
            });
        }

        req.user = decoded;
        next();
    });
};

// Add a protected route example
app.get('/api/game-status', authenticateToken, (req, res) => {
    res.json({
        status: 'active',
        user: req.user.username
    });
});

// Logout endpoint - clears game states and handles cleanup
app.post('/api/logout', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const username = req.user.username;

        // Find and delete any active game states where this user is a player
        const activeGames = await GameState.find({
            $or: [
                { 'playerColors.player1': username },
                { 'playerColors.player2': username }
            ]
        });

        let gamesCleared = 0;
        for (const game of activeGames) {
            if (game.currentPlayer !== null) {
                // Game is active - mark as completed instead of deleting
                await GameState.findByIdAndUpdate(game._id, { $set: { currentPlayer: null } });
                console.log(`Marked active game as completed for user ${username}: ${game.matchId}`);
            } else {
                // Game is already completed - safe to delete
                await GameState.findByIdAndDelete(game._id);
                console.log(`Deleted completed game for user ${username}: ${game.matchId}`);
            }
            gamesCleared++;
        }

        // Clear any active matches for this user
        const matchesToRemove = [];
        for (const [matchId, match] of activeMatches) {
            if (match.player1 === username || match.player2 === username) {
                matchesToRemove.push(matchId);
            }
        }

        // Remove matches from activeMatches map
        matchesToRemove.forEach(matchId => {
            activeMatches.delete(matchId);
            // Also clean up match rooms
            if (matchRooms.has(matchId)) {
                matchRooms.get(matchId).forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'end_session',
                            username: username,
                            matchId: matchId
                        }));
                    }
                });
                matchRooms.delete(matchId);
            }
        });

        // Clear waiting players if this user was waiting
        waitingPlayers.delete(username);

        res.json({
            message: 'Logged out successfully. Game states cleared.',
            gamesCleared: gamesCleared
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Error during logout' });
    }
});

// Add this new endpoint after your other routes
app.get('/api/chat-history/:matchId', async (req, res) => {
    try {
        const gameState = await GameState.findOne({ matchId: req.params.matchId });
        if (gameState && gameState.chatHistory) {
            // Mark messages as read
            await GameState.updateMany(
                { matchId: req.params.matchId, 'chatHistory.isRead': false },
                { $set: { 'chatHistory.$[].isRead': true } }
            );
            res.json({ messages: gameState.chatHistory });
        } else {
            res.json({ messages: [] });
        }
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ message: 'Error fetching chat history' });
    }
});

// Admin middleware - ensures only admins can access admin routes
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Admin access denied - No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid admin token' });
        }
        
        // CRITICAL: Verify the token has admin role - prevents regular users from accessing admin routes
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied - Admin privileges required' });
        }
        
        req.admin = decoded;
        next();
    });
};

// Admin login endpoint
app.post('/api/admin/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find admin
        const admin = await Admin.findOne({ username });
        if (!admin) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        // Create JWT token
        const token = jwt.sign(
            { adminId: admin._id, username: admin.username, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Admin login successful',
            token,
            username: admin.username,
            role: 'admin'
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: 'Error during admin login' });
    }
});

// Admin registration endpoint (for initial setup)
app.post('/api/admin/register', authLimiter, async (req, res) => {
    try {
        const { username, password, adminKey } = req.body;

        // Check admin key (you can set this in environment variables)
        if (adminKey !== process.env.ADMIN_REGISTRATION_KEY) {
            return res.status(403).json({ message: 'Invalid admin registration key' });
        }

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ username });
        if (existingAdmin) {
            return res.status(400).json({ message: 'Admin username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new admin
        const admin = new Admin({
            username,
            password: hashedPassword
        });

        await admin.save();

        res.status(201).json({ message: 'Admin account created successfully' });
    } catch (error) {
        console.error('Admin registration error:', error);
        res.status(500).json({ message: 'Error during admin registration' });
    }
});

// Admin dashboard data endpoint
app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalAdmins = await Admin.countDocuments();

        // Calculate total games played from user dashboards (more accurate)
        const userDashboards = await UserDashboard.find({}, 'gameHistory');
        let totalGamesPlayed = 0;
        userDashboards.forEach(dashboard => {
            if (dashboard.gameHistory && Array.isArray(dashboard.gameHistory)) {
                totalGamesPlayed += dashboard.gameHistory.length;
            }
        });

        // Keep GameState counts for system monitoring
        const totalGameStates = await GameState.countDocuments();
        const activeMatchCount = await GameState.countDocuments({ currentPlayer: { $ne: null } });

        const stats = {
            totalUsers,
            totalAdmins,
            totalGames: totalGamesPlayed, // Now shows actual games played
            activeMatches: activeMatchCount,
            systemInfo: {
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                nodeVersion: process.version,
                platform: process.platform,
                gameStatesInDb: totalGameStates // Additional system metric
            }
        };

        res.json({ stats });
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({ message: 'Error fetching dashboard data' });
    }
});

// Get all users (admin only)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await User.find({}, '-password');
        res.json({ users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Get all games (admin only)
app.get('/api/admin/games', authenticateAdmin, async (req, res) => {
    try {
        const games = await GameState.find();
        res.json({ games });
    } catch (error) {
        console.error('Get games error:', error);
        res.status(500).json({ message: 'Error fetching games' });
    }
});

// Delete user (admin only)
app.delete('/api/admin/users/:userId', authenticateAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.userId);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: 'Error deleting user' });
    }
});

// Delete game (admin only)
app.delete('/api/admin/games/:gameId', authenticateAdmin, async (req, res) => {
    try {
        await GameState.findByIdAndDelete(req.params.gameId);
        res.json({ message: 'Game deleted successfully' });
    } catch (error) {
        console.error('Delete game error:', error);
        res.status(500).json({ message: 'Error deleting game' });
    }
});

// Force cleanup active games that should be completed (admin only)
app.post('/api/admin/cleanup-active-games', authenticateAdmin, async (req, res) => {
    try {
        // Find games that have currentPlayer set but no active connections
        const allGames = await GameState.find({ currentPlayer: { $ne: null } });

        let cleanedCount = 0;
        for (const game of allGames) {
            // Check if this game has any active connections
            const hasActiveConnections = matchRooms.has(game.matchId) && matchRooms.get(game.matchId).size > 0;

            if (!hasActiveConnections) {
                // No active connections - mark as completed
                await GameState.findByIdAndUpdate(game._id, { $set: { currentPlayer: null } });
                console.log(`🧹 Force cleaned up orphaned active game: ${game.matchId}`);
                cleanedCount++;
            }
        }

        res.json({
            message: 'Active games cleanup completed',
            cleanedCount: cleanedCount
        });
    } catch (error) {
        console.error('Error cleaning up active games:', error);
        res.status(500).json({ message: 'Error cleaning up active games' });
    }
});

// Cleanup old games (admin only)
app.post('/api/admin/cleanup-games', authenticateAdmin, async (req, res) => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

        const result = await GameState.deleteMany({
            currentPlayer: null,
            createdAt: { $lt: sevenDaysAgo }
        });

        console.log(`🧹 Admin manually cleaned up ${result.deletedCount} old completed games`);
        res.json({
            message: 'Cleanup completed',
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error cleaning up games:', error);
        res.status(500).json({ message: 'Error cleaning up games' });
    }
});

// Cleanup duplicate game history entries in user dashboards (admin only)
app.post('/api/admin/cleanup-duplicate-stats', authenticateAdmin, async (req, res) => {
    try {
        const userDashboards = await UserDashboard.find({}, 'username gameHistory');
        let totalDuplicatesRemoved = 0;
        let dashboardsCleaned = 0;

        for (const dashboard of userDashboards) {
            if (!dashboard.gameHistory || !Array.isArray(dashboard.gameHistory)) {
                continue;
            }

            // Find and remove duplicates based on matchId
            const seenMatchIds = new Set();
            const uniqueGames = [];

            for (const game of dashboard.gameHistory) {
                if (game.matchId && !seenMatchIds.has(game.matchId)) {
                    seenMatchIds.add(game.matchId);
                    uniqueGames.push(game);
                } else if (!game.matchId) {
                    // Keep games without matchId (legacy entries)
                    uniqueGames.push(game);
                }
            }

            const duplicatesRemoved = dashboard.gameHistory.length - uniqueGames.length;
            if (duplicatesRemoved > 0) {
                dashboard.gameHistory = uniqueGames;
                await dashboard.save();
                totalDuplicatesRemoved += duplicatesRemoved;
                dashboardsCleaned++;
                console.log(`🧹 Cleaned ${duplicatesRemoved} duplicate entries from ${dashboard.username}'s dashboard`);
            }
        }

        res.json({
            message: 'Duplicate cleanup completed',
            dashboardsCleaned: dashboardsCleaned,
            totalDuplicatesRemoved: totalDuplicatesRemoved
        });
    } catch (error) {
        console.error('Error cleaning up duplicate stats:', error);
        res.status(500).json({ message: 'Error cleaning up duplicate stats' });
    }
});

// Cleanup abandoned games function
async function cleanupAbandonedGames() {
    try {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

        let totalCleaned = 0;

        // Clean up games with no moves that are older than 30 minutes
        const abandonedResult = await GameState.deleteMany({
            $or: [
                { moveHistory: { $exists: false } },
                { moveHistory: { $size: 0 } },
                { moveHistory: null }
            ],
            createdAt: { $lt: thirtyMinutesAgo }
        });

        if (abandonedResult.deletedCount > 0) {
            console.log(`🧹 Cleaned up ${abandonedResult.deletedCount} abandoned games (no moves)`);
            totalCleaned += abandonedResult.deletedCount;
        }

        // Clean up completed games that are older than 7 days
        const completedResult = await GameState.deleteMany({
            currentPlayer: null,
            createdAt: { $lt: sevenDaysAgo }
        });

        if (completedResult.deletedCount > 0) {
            console.log(`🧹 Cleaned up ${completedResult.deletedCount} old completed games (7+ days old)`);
            totalCleaned += completedResult.deletedCount;
        }

        if (totalCleaned > 0) {
            console.log(`🧹 Total games cleaned up: ${totalCleaned}`);
        }
    } catch (error) {
        console.error('Error cleaning up abandoned games:', error);
    }
}

// Periodic cleanup (every 30 minutes)
setInterval(cleanupAbandonedGames, 30 * 60 * 1000);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err.stack); // Log for developer

    // Send generic message to client to prevent information disclosure
    res.status(500).json({
        status: 'error',
        message: process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : err.message
    });
});

// Start server only after MongoDB connection is established
const PORT = process.env.PORT || 3000;

mongoose.connection.once('connected', () => {
    console.log('✓ MongoDB connected successfully');

    // Clean up abandoned games on server start
    cleanupAbandonedGames();

    // Start HTTP server only after database is ready
    server.listen(PORT, (err) => {
        if (err) {
            console.error('❌ Error starting server:', err);
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use. Please use a different port or stop the process using this port.`);
            }
            process.exit(1);
        } else {
            console.log(`✓ Server running on port ${PORT}`);
            console.log(`✓ WebSocket server ready`);
            console.log(`✓ Admin routes: /api/admin/* (protected)`);
            console.log(`✓ User routes: /api/user/*, /api/login, /api/register (separated)`);
        }
    });
    
    // Handle server errors
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use`);
            console.error('   Please stop the process using this port or set a different PORT in .env');
        } else {
            console.error('❌ Server error:', err);
        }
        process.exit(1);
    });
}); 

// Add this new function
function handleMatchmaking(data, ws) {
    // Block guests — they have no persistent identity and stats cannot be tracked
    if (data.userType === 'guest') {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Guests cannot join multiplayer matches. Please register an account to play.'
        }));
        return;
    }

    // If there are waiting players, match with the first one
    for (const [waitingUsername, waitingWs] of waitingPlayers) {
        if (waitingUsername !== data.username) {
            // Create match
            const matchId = `match_${Date.now()}`;
            const matchData = {
                matchId: matchId,
                player1: waitingUsername,
                player2: data.username
            };
            
            // Store match data
            activeMatches.set(matchId, matchData);
            
            // Notify both players
            waitingWs.send(JSON.stringify({
                type: 'match_found',
                matchData: matchData
            }));
            
            ws.send(JSON.stringify({
                type: 'match_found',
                matchData: matchData
            }));
            
            // Remove waiting player
            waitingPlayers.delete(waitingUsername);
            return;
        }
    }
    
    // If no match found, add to waiting players
    waitingPlayers.set(data.username, ws);
} 

// Add these endpoints for color preferences
app.post('/api/preferences/colors', authenticateToken, async (req, res) => {
    try {
        const { preferences } = req.body;
        const userId = req.user.userId;
        const username = req.user.username;

        const update = {
            username,
            preferences,
            lastUpdated: new Date()
        };

        const colorPrefs = await ColorPreferences.findOneAndUpdate(
            { userId },
            update,
            { upsert: true, new: true }
        );

        res.json({ success: true, preferences: colorPrefs });
    } catch (error) {
        console.error('Error saving color preferences:', error);
        res.status(500).json({ message: 'Error saving preferences' });
    }
});

app.get('/api/preferences/colors/:username', authenticateToken, async (req, res) => {
    try {
        // Only allow users to access their own preferences
        if (req.user.username !== req.params.username) {
            return res.status(403).json({ message: 'Access denied - Can only access own preferences' });
        }

        const userId = req.user.userId;
        const colorPrefs = await ColorPreferences.findOne({ userId });

        if (colorPrefs) {
            res.json({ preferences: colorPrefs.preferences });
        } else {
            res.json({ preferences: null });
        }
    } catch (error) {
        console.error('Error fetching color preferences:', error);
        res.status(500).json({ message: 'Error fetching preferences' });
    }
});

// Add new endpoint to save all preferences
app.post('/api/preferences/save-all', authenticateToken, async (req, res) => {
    try {
        const { colors, enhancedKingMode } = req.body;
        const userId = req.user.userId;
        const username = req.user.username;

        const update = {
            username,
            colors,
            gameSettings: {
                enhancedKingMode
            },
            lastUpdated: new Date()
        };

        const preferences = await UserPreferences.findOneAndUpdate(
            { userId },
            update,
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            preferences
        });
    } catch (error) {
        console.error('Error saving preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving preferences'
        });
    }
});

// Add endpoint to load all preferences
app.get('/api/preferences/load/:username', authenticateToken, async (req, res) => {
    try {
        // Only allow users to access their own preferences
        if (req.user.username !== req.params.username) {
            return res.status(403).json({ message: 'Access denied - Can only access own preferences' });
        }

        const userId = req.user.userId;
        const preferences = await UserPreferences.findOne({ userId });

        if (preferences) {
            res.json({
                success: true,
                preferences: {
                    colors: preferences.colors,
                    gameSettings: preferences.gameSettings
                }
            });
        } else {
            res.json({
                success: true,
                preferences: null
            });
        }
    } catch (error) {
        console.error('Error loading preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading preferences'
        });
    }
});

// Add endpoint to clear preferences
app.delete('/api/preferences/clear/:username', authenticateToken, async (req, res) => {
    try {
        // Only allow users to clear their own preferences
        if (req.user.username !== req.params.username) {
            return res.status(403).json({ message: 'Access denied - Can only clear own preferences' });
        }

        const userId = req.user.userId;
        await UserPreferences.findOneAndDelete({ userId });
        res.json({ success: true });
    } catch (error) {
        console.error('Error clearing preferences:', error);
        res.status(500).json({ success: false });
    }
});

// Add these API endpoints
app.post('/api/single-player/save', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { gameState } = req.body;
        await SinglePlayerGame.findOneAndUpdate(
            { userId },
            { gameState },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving game state:', error);
        res.status(500).json({ success: false });
    }
});

app.get('/api/single-player/load/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const username = req.user.username;
        // Allow match by either MongoDB _id or username
        if (req.params.userId !== userId && req.params.userId !== username) {
            return res.status(403).json({ message: 'Access denied' });
        }
        const game = await SinglePlayerGame.findOne({ userId });
        res.json({ success: true, gameState: game?.gameState || null });
    } catch (error) {
        console.error('Error loading game state:', error);
        res.status(500).json({ success: false });
    }
});

// ---- Guest endpoints (identified by IP address) ----

// Helper to get client IP
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
    return `guest_ip_${ip}`;
}

app.post('/api/guest/single-player/save', async (req, res) => {
    try {
        const guestId = getClientIp(req);
        const { gameState } = req.body;
        await SinglePlayerGame.findOneAndUpdate(
            { userId: guestId },
            { gameState },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving guest game state:', error);
        res.status(500).json({ success: false });
    }
});

app.get('/api/guest/single-player/load', async (req, res) => {
    try {
        const guestId = getClientIp(req);
        const game = await SinglePlayerGame.findOne({ userId: guestId });
        res.json({ success: true, gameState: game?.gameState || null });
    } catch (error) {
        console.error('Error loading guest game state:', error);
        res.status(500).json({ success: false });
    }
});

app.get('/api/guest/dashboard', async (req, res) => {
    try {
        const guestId = getClientIp(req);
        let dashboard = await UserDashboard.findOne({ userId: guestId });

        if (!dashboard) {
            dashboard = new UserDashboard({
                userId: guestId,
                username: 'Guest'
            });
            await dashboard.save();
        }

        const calculatedStats = calculateStatsFromHistory(dashboard.gameHistory);

        res.json({
            success: true,
            stats: {
                ...calculatedStats,
                favoriteDifficulty: dashboard.favoriteDifficulty,
                totalPlayTime: dashboard.totalPlayTime,
                achievements: dashboard.achievements,
                lastPlayed: dashboard.lastPlayed,
                gameHistory: dashboard.gameHistory
            }
        });
    } catch (error) {
        console.error('Error fetching guest dashboard:', error);
        res.status(500).json({ message: 'Error fetching guest dashboard' });
    }
});

app.post('/api/guest/dashboard/update', async (req, res) => {
    try {
        const guestId = getClientIp(req);
        const { result, difficulty, duration } = req.body;

        let dashboard = await UserDashboard.findOne({ userId: guestId });

        if (!dashboard) {
            dashboard = new UserDashboard({
                userId: guestId,
                username: 'Guest'
            });
        }

        dashboard.lastPlayed = new Date();

        if (duration) {
            dashboard.totalPlayTime += Math.round(duration / 60);
        }

        dashboard.gameHistory.push({
            opponent: difficulty === 'multiplayer' ? 'Player' : 'AI',
            result: result,
            difficulty: difficulty || 'Medium',
            duration: duration || 0,
            date: new Date()
        });

        if (dashboard.gameHistory.length > 50) {
            dashboard.gameHistory = dashboard.gameHistory.slice(-50);
        }

        await dashboard.save();
        res.json({ success: true, message: 'Guest dashboard updated' });
    } catch (error) {
        console.error('Error updating guest dashboard:', error);
        res.status(500).json({ message: 'Error updating guest dashboard' });
    }
});

app.delete('/api/guest/dashboard', async (req, res) => {
    try {
        const guestId = getClientIp(req);
        await UserDashboard.findOneAndDelete({ userId: guestId });
        await SinglePlayerGame.findOneAndDelete({ userId: guestId });
        res.json({ success: true, message: 'Guest data cleared' });
    } catch (error) {
        console.error('Error clearing guest data:', error);
        res.status(500).json({ message: 'Error clearing guest data' });
    }
});

// AI Testing Endpoints for Admin Dashboard
app.post('/api/admin/ai-performance-test', authenticateAdmin, async (req, res) => {
    try {
        // Simulate AI performance testing
        const testResults = await runAIPerformanceTest();
        res.json(testResults);
    } catch (error) {
        console.error('Error running AI performance test:', error);
        res.status(500).json({ message: 'Error running AI performance test' });
    }
});

app.get('/api/admin/ai-patterns', authenticateAdmin, async (req, res) => {
    try {
        const patternAnalysis = await analyzeAIPatternsFromDB();
        res.json(patternAnalysis);
    } catch (error) {
        console.error('Error analyzing AI patterns:', error);
        res.status(500).json({ message: 'Error analyzing AI patterns' });
    }
});

app.get('/api/admin/ai-difficulty-comparison', authenticateAdmin, async (req, res) => {
    try {
        const comparison = await compareAIDifficulties();
        res.json(comparison);
    } catch (error) {
        console.error('Error comparing AI difficulties:', error);
        res.status(500).json({ message: 'Error comparing AI difficulties' });
    }
});

app.get('/api/admin/real-game-results', authenticateAdmin, async (req, res) => {
    try {
        const results = await getRealGameResults();
        res.json(results);
    } catch (error) {
        console.error('Error getting real game results:', error);
        res.status(500).json({ message: 'Error getting real game results' });
    }
});

// Helper function to calculate stats from game history
function calculateStatsFromHistory(gameHistory) {
    const stats = {
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0
    };

    if (!gameHistory || !Array.isArray(gameHistory)) {
        return stats;
    }

    gameHistory.forEach(game => {
        stats.totalGames++;
        if (game.result === 'win') stats.wins++;
        else if (game.result === 'loss') stats.losses++;
        else if (game.result === 'draw') stats.draws++;
    });

    stats.winRate = stats.totalGames > 0 ?
        Math.round((stats.wins / stats.totalGames) * 100) : 0;

    return stats;
}

// User Dashboard API Endpoints
app.get('/api/user/dashboard', authenticateToken, async (req, res) => {
    try {
        // Handle both regular users and admins
        const userId = req.user.userId || req.user.adminId;

        let dashboard = await UserDashboard.findOne({ userId });

        // Create dashboard if it doesn't exist
        if (!dashboard) {
            dashboard = new UserDashboard({
                userId: userId,
                username: req.user.username
            });
            await dashboard.save();
        }

        // Calculate stats from gameHistory instead of stored values
        const calculatedStats = calculateStatsFromHistory(dashboard.gameHistory);

        res.json({
            success: true,
            stats: {
                ...calculatedStats,
                favoriteDifficulty: dashboard.favoriteDifficulty,
                totalPlayTime: dashboard.totalPlayTime,
                achievements: dashboard.achievements,
                lastPlayed: dashboard.lastPlayed,
                gameHistory: dashboard.gameHistory
            }
        });
    } catch (error) {
        console.error('Error fetching user dashboard:', error);
        res.status(500).json({ message: 'Error fetching dashboard data' });
    }
});

app.post('/api/user/dashboard/update', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.adminId;
        const { result, difficulty, duration } = req.body;

        let dashboard = await UserDashboard.findOne({ userId });

        if (!dashboard) {
            dashboard = new UserDashboard({
                userId: userId,
                username: req.user.username
            });
        }

        // DON'T update overall stats - calculate from gameHistory instead
        dashboard.lastPlayed = new Date();

        // Update favorite difficulty based on most played
        // (Keep this for backward compatibility)

        // Add play time
        if (duration) {
            dashboard.totalPlayTime += Math.round(duration / 60); // Convert to minutes
        }

        // Add to game history
        dashboard.gameHistory.push({
            opponent: difficulty === 'multiplayer' ? 'Player' : 'AI', // Distinguish opponents
            result: result,
            difficulty: difficulty || 'Medium',
            duration: duration || 0,
            date: new Date()
        });

        // Keep only last 50 games in history
        if (dashboard.gameHistory.length > 50) {
            dashboard.gameHistory = dashboard.gameHistory.slice(-50);
        }

        await dashboard.save();

        res.json({ success: true, message: 'Dashboard updated successfully' });
    } catch (error) {
        console.error('Error updating user dashboard:', error);
        res.status(500).json({ message: 'Error updating dashboard' });
    }
});

app.delete('/api/user/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.adminId;
        await UserDashboard.findOneAndDelete({ userId });

        res.json({ success: true, message: 'User dashboard cleared successfully' });
    } catch (error) {
        console.error('Error clearing user dashboard:', error);
        res.status(500).json({ message: 'Error clearing dashboard' });
    }
});

// ════════════════════════════════════════════════════════════════════
// FRIENDS SYSTEM — API Routes
// ════════════════════════════════════════════════════════════════════

// Search users (for adding friends)
app.get('/api/friends/search', authenticateToken, async (req, res) => {
    try {
        const query = req.query.q;
        const myUsername = req.user.username;
        if (!query || query.length < 2) {
            return res.json({ users: [] });
        }

        // Find users matching the query (case-insensitive), exclude self
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const users = await User.find({
            $and: [
                { username: { $regex: new RegExp('^' + escapedQuery, 'i') } },
                { username: { $ne: myUsername } }
            ]
        }).select('username').limit(15);

        // Also search with contains match if prefix match gives few results
        let results = [...users];
        if (results.length < 5) {
            const containsUsers = await User.find({
                $and: [
                    { username: { $regex: new RegExp(escapedQuery, 'i') } },
                    { username: { $ne: myUsername } }
                ]
            }).select('username').limit(15);
            // Merge, avoiding duplicates
            const seen = new Set(results.map(u => u.username));
            for (const u of containsUsers) {
                if (!seen.has(u.username) && u.username !== myUsername) {
                    results.push(u);
                    seen.add(u.username);
                }
            }
            results = results.slice(0, 15);
        }

        // Get friendship status for each result
        const usernames = results.map(u => u.username);
        const friendships = await Friendship.find({
            $or: [
                { requester: myUsername, recipient: { $in: usernames } },
                { recipient: myUsername, requester: { $in: usernames } }
            ]
        });

        const friendMap = {};
        for (const f of friendships) {
            const other = f.requester === myUsername ? f.recipient : f.requester;
            friendMap[other] = {
                status: f.status,
                isSender: f.requester === myUsername
            };
        }

        const usersWithStatus = results.map(u => ({
            username: u.username,
            friendship: friendMap[u.username] || null,
            online: onlineUsers.has(u.username)
        }));

        res.json({ users: usersWithStatus });
    } catch (error) {
        console.error('[Friends] Search error:', error);
        res.status(500).json({ message: 'Error searching users' });
    }
});

// Send friend request
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;
        const { recipient } = req.body;

        if (!recipient || recipient === myUsername) {
            return res.status(400).json({ message: 'Invalid recipient' });
        }

        // Verify recipient exists
        const recipientUser = await User.findOne({ username: recipient });
        if (!recipientUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check for existing friendship in either direction
        const existing = await Friendship.findOne({
            $or: [
                { requester: myUsername, recipient: recipient },
                { requester: recipient, recipient: myUsername }
            ]
        });

        if (existing) {
            if (existing.status === 'accepted') {
                return res.status(400).json({ message: 'Already friends' });
            }
            if (existing.status === 'blocked') {
                return res.status(400).json({ message: 'Cannot send request' });
            }
            if (existing.status === 'pending') {
                // If the other person already sent us a request, auto-accept
                if (existing.requester === recipient) {
                    existing.status = 'accepted';
                    existing.acceptedAt = new Date();
                    await existing.save();

                    // Notify both parties
                    notifyUser(recipient, {
                        type: 'friend_accepted',
                        username: myUsername
                    });
                    broadcastFriendStatus(myUsername, 'online');
                    broadcastFriendStatus(recipient, 'online');

                    return res.json({ success: true, status: 'accepted', message: 'Friend request accepted' });
                }
                return res.status(400).json({ message: 'Request already sent' });
            }
        }

        // Create new friendship
        const friendship = new Friendship({
            requester: myUsername,
            recipient: recipient
        });
        await friendship.save();

        // Real-time notification to recipient
        notifyUser(recipient, {
            type: 'friend_request',
            from: myUsername
        });

        res.json({ success: true, status: 'pending', message: 'Friend request sent' });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Request already exists' });
        }
        console.error('[Friends] Request error:', error);
        res.status(500).json({ message: 'Error sending friend request' });
    }
});

// Accept friend request
app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;
        const { requester } = req.body;

        const friendship = await Friendship.findOne({
            requester: requester,
            recipient: myUsername,
            status: 'pending'
        });

        if (!friendship) {
            return res.status(404).json({ message: 'No pending request from this user' });
        }

        friendship.status = 'accepted';
        friendship.acceptedAt = new Date();
        await friendship.save();

        // Notify requester that their request was accepted
        notifyUser(requester, {
            type: 'friend_accepted',
            username: myUsername
        });

        // Broadcast online status to both
        broadcastFriendStatus(myUsername, 'online');
        broadcastFriendStatus(requester, 'online');

        res.json({ success: true, message: 'Friend request accepted' });
    } catch (error) {
        console.error('[Friends] Accept error:', error);
        res.status(500).json({ message: 'Error accepting request' });
    }
});

// Reject / decline friend request
app.post('/api/friends/reject', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;
        const { requester } = req.body;

        const result = await Friendship.findOneAndDelete({
            requester: requester,
            recipient: myUsername,
            status: 'pending'
        });

        if (!result) {
            return res.status(404).json({ message: 'No pending request from this user' });
        }

        res.json({ success: true, message: 'Request declined' });
    } catch (error) {
        console.error('[Friends] Reject error:', error);
        res.status(500).json({ message: 'Error declining request' });
    }
});

// Remove friend (unfriend)
app.post('/api/friends/remove', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;
        const { friend } = req.body;

        const result = await Friendship.findOneAndDelete({
            status: 'accepted',
            $or: [
                { requester: myUsername, recipient: friend },
                { requester: friend, recipient: myUsername }
            ]
        });

        if (!result) {
            return res.status(404).json({ message: 'Friendship not found' });
        }

        // Notify the removed friend
        notifyUser(friend, {
            type: 'friend_removed',
            username: myUsername
        });

        res.json({ success: true, message: 'Friend removed' });
    } catch (error) {
        console.error('[Friends] Remove error:', error);
        res.status(500).json({ message: 'Error removing friend' });
    }
});

// Get friends list (accepted friends with online status)
app.get('/api/friends/list', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;

        const friendships = await Friendship.find({
            status: 'accepted',
            $or: [{ requester: myUsername }, { recipient: myUsername }]
        }).sort({ acceptedAt: -1 });

        const friends = friendships.map(f => {
            const friendName = f.requester === myUsername ? f.recipient : f.requester;
            return {
                username: friendName,
                online: onlineUsers.has(friendName),
                since: f.acceptedAt || f.createdAt
            };
        });

        // Sort: online friends first, then alphabetical
        friends.sort((a, b) => {
            if (a.online !== b.online) return b.online - a.online;
            return a.username.localeCompare(b.username);
        });

        res.json({ friends, count: friends.length });
    } catch (error) {
        console.error('[Friends] List error:', error);
        res.status(500).json({ message: 'Error fetching friends' });
    }
});

// Get pending friend requests (incoming)
app.get('/api/friends/pending', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;

        const incoming = await Friendship.find({
            recipient: myUsername,
            status: 'pending'
        }).sort({ createdAt: -1 });

        const outgoing = await Friendship.find({
            requester: myUsername,
            status: 'pending'
        }).sort({ createdAt: -1 });

        res.json({
            incoming: incoming.map(f => ({
                username: f.requester,
                online: onlineUsers.has(f.requester),
                sentAt: f.createdAt
            })),
            outgoing: outgoing.map(f => ({
                username: f.recipient,
                online: onlineUsers.has(f.recipient),
                sentAt: f.createdAt
            })),
            incomingCount: incoming.length
        });
    } catch (error) {
        console.error('[Friends] Pending error:', error);
        res.status(500).json({ message: 'Error fetching requests' });
    }
});

// Block a user
app.post('/api/friends/block', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;
        const { username: targetUser } = req.body;

        if (!targetUser || targetUser === myUsername) {
            return res.status(400).json({ message: 'Invalid user' });
        }

        // Remove any existing friendship
        await Friendship.findOneAndDelete({
            $or: [
                { requester: myUsername, recipient: targetUser },
                { requester: targetUser, recipient: myUsername }
            ]
        });

        // Create block record
        await Friendship.findOneAndUpdate(
            { requester: myUsername, recipient: targetUser },
            { requester: myUsername, recipient: targetUser, status: 'blocked' },
            { upsert: true }
        );

        res.json({ success: true, message: 'User blocked' });
    } catch (error) {
        console.error('[Friends] Block error:', error);
        res.status(500).json({ message: 'Error blocking user' });
    }
});

// Get friend count + pending count (for hub badge)
app.get('/api/friends/counts', authenticateToken, async (req, res) => {
    try {
        const myUsername = req.user.username;

        const friendCount = await Friendship.countDocuments({
            status: 'accepted',
            $or: [{ requester: myUsername }, { recipient: myUsername }]
        });

        const pendingCount = await Friendship.countDocuments({
            recipient: myUsername,
            status: 'pending'
        });

        res.json({ friendCount, pendingCount });
    } catch (error) {
        console.error('[Friends] Counts error:', error);
        res.status(500).json({ message: 'Error fetching counts' });
    }
});

// Server-side statistics update to prevent duplication
async function updateMultiplayerStatsServerSide(matchId, winner, reportingUsername) {
    try {
        // Find the game state to get player information
        const gameState = await GameState.findOne({ matchId });
        if (!gameState) {
            console.log(`Game state not found for match ${matchId}`);
            return;
        }

        // Get player usernames from activeMatches (playerColors stores colors, not usernames)
        const match = activeMatches.get(matchId);
        if (!match) {
            console.log(`Match ${matchId} not found in activeMatches — cannot record stats`);
            return;
        }

        const player1Color = gameState.playerColors.player1;
        const player2Color = gameState.playerColors.player2;

        // Update stats for both players
        const players = [
            { username: match.player1, color: player1Color },
            { username: match.player2, color: player2Color }
        ];
        for (const { username: playerUsername, color: playerColor } of players) {
            try {
                // Find or create user dashboard
                let dashboard = await UserDashboard.findOne({ username: playerUsername });
                if (!dashboard) {
                    // Try to find by userId if username lookup fails
                    let user = await User.findOne({ username: playerUsername });
                    if (!user) {
                        user = await Admin.findOne({ username: playerUsername });
                    }
                    if (user) {
                        dashboard = await UserDashboard.findOne({ userId: user._id });
                        if (!dashboard) {
                            dashboard = new UserDashboard({
                                userId: user._id,
                                username: playerUsername
                            });
                        }
                    } else {
                        console.log(`User not found: ${playerUsername}`);
                        continue;
                    }
                }

                // Check if this match has already been recorded for this user
                const matchAlreadyRecorded = dashboard.gameHistory.some(game =>
                    game.matchId === matchId
                );

                if (!matchAlreadyRecorded) {
                    // Determine result for this player by comparing their assigned color to the winner color
                    const result = (winner.toLowerCase() === playerColor.toLowerCase()) ? 'win' : 'loss';

                    // Add to game history
                    dashboard.gameHistory.push({
                        opponent: 'Player', // Distinguish from AI games
                        result: result,
                        difficulty: 'multiplayer',
                        duration: 0, // Could be calculated if needed
                        date: new Date(),
                        matchId: matchId // Add matchId to prevent duplicates
                    });

                    // Keep only last 50 games
                    if (dashboard.gameHistory.length > 50) {
                        dashboard.gameHistory = dashboard.gameHistory.slice(-50);
                    }

                    await dashboard.save();
                    console.log(`Updated stats for ${playerUsername}: ${result} in match ${matchId}`);
                } else {
                    console.log(`Match ${matchId} already recorded for ${playerUsername}`);
                }
            } catch (error) {
                console.error(`Error updating stats for ${playerUsername}:`, error);
            }
        }
    } catch (error) {
        console.error('Error in updateMultiplayerStatsServerSide:', error);
    }
}

// AI Testing Helper Functions
async function runAIPerformanceTest() {
    // Get all single player games to analyze AI performance
    const games = await SinglePlayerGame.find({});
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let totalTests = 0;

    const difficultyStats = {
        easy: { wins: 0, total: 0 },
        medium: { wins: 0, total: 0 },
        hard: { wins: 0, total: 0 }
    };

    for (const game of games) {
        if (game.gameState?.statistics) {
            const stats = game.gameState.statistics;
            const difficulty = game.gameState.currentDifficulty || 'medium';

            difficultyStats[difficulty].total += stats.totalGames;
            difficultyStats[difficulty].wins += stats.wins;

            wins += stats.wins;
            losses += stats.losses || 0;
            draws += stats.draws || 0;
            totalTests += stats.totalGames;
        }
    }

    // Calculate win rates
    Object.keys(difficultyStats).forEach(diff => {
        const stats = difficultyStats[diff];
        stats.winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : 0;
    });

    return {
        winRate: totalTests > 0 ? ((wins / totalTests) * 100).toFixed(1) : 0,
        drawRate: totalTests > 0 ? ((draws / totalTests) * 100).toFixed(1) : '0.0',
        totalTests: totalTests,
        difficultyBreakdown: difficultyStats
    };
}

async function analyzeAIPatternsFromDB() {
    const games = await SinglePlayerGame.find({});
    const allPatterns = new Map();

    for (const game of games) {
        if (game.gameState?.aiPatterns) {
            const patterns = game.gameState.aiPatterns;

            // Handle both old array format and new object format
            if (Array.isArray(patterns)) {
                patterns.forEach(pattern => {
                    const key = pattern.key;
                    const value = pattern.value;
                    if (allPatterns.has(key)) {
                        const existing = allPatterns.get(key);
                        existing.frequency += value.frequency;
                        if (value.outcome > existing.outcome) {
                            existing.outcome = value.outcome;
                            existing.move = value.move;
                        }
                    } else {
                        allPatterns.set(key, { ...value });
                    }
                });
            } else if (typeof patterns === 'object') {
                // New format with difficulties
                Object.values(patterns).forEach(difficultyPatterns => {
                    if (Array.isArray(difficultyPatterns)) {
                        difficultyPatterns.forEach(pattern => {
                            const key = pattern.key;
                            const value = pattern.value;
                            if (allPatterns.has(key)) {
                                const existing = allPatterns.get(key);
                                existing.frequency += value.frequency;
                                if (value.outcome > existing.outcome) {
                                    existing.outcome = value.outcome;
                                    existing.move = value.move;
                                }
                            } else {
                                allPatterns.set(key, { ...value });
                            }
                        });
                    }
                });
            }
        }
    }

    // Calculate statistics
    const patternsArray = Array.from(allPatterns.values());
    const totalPatterns = patternsArray.length;
    const averageFrequency = totalPatterns > 0 ?
        (patternsArray.reduce((sum, p) => sum + p.frequency, 0) / totalPatterns).toFixed(1) : 0;

    const mostSuccessful = patternsArray.reduce((best, current) =>
        current.outcome > best.outcome ? current : best, { outcome: -Infinity });

    // Get top 10 patterns
    const topPatterns = patternsArray
        .sort((a, b) => b.outcome - a.outcome)
        .slice(0, 10)
        .map(p => ({
            ...p,
            successRate: p.frequency > 0 ? ((p.outcome / 10) * 100).toFixed(1) : 0
        }));

    return {
        totalPatterns,
        averageFrequency,
        mostSuccessful: mostSuccessful.outcome !== -Infinity ? mostSuccessful : { outcome: 0 },
        effectiveness: totalPatterns > 0 ? ((patternsArray.filter(p => p.outcome > 0).length / totalPatterns) * 100).toFixed(1) : '0.0',
        topPatterns
    };
}

async function compareAIDifficulties() {
    const games = await SinglePlayerGame.find({});
    const difficultyData = {
        easy: { scores: [], patterns: 0 },
        medium: { scores: [], patterns: 0 },
        hard: { scores: [], patterns: 0 }
    };

    for (const game of games) {
        const difficulty = game.gameState?.currentDifficulty || 'medium';
        if (difficultyData[difficulty]) {
            if (game.gameState?.statistics) {
                const winRate = game.gameState.statistics.totalGames > 0 ?
                    (game.gameState.statistics.wins / game.gameState.statistics.totalGames) * 100 : 0;
                difficultyData[difficulty].scores.push(winRate);
            }

            // Count patterns
            if (game.gameState?.aiPatterns) {
                if (Array.isArray(game.gameState.aiPatterns)) {
                    difficultyData[difficulty].patterns += game.gameState.aiPatterns.length;
                } else if (typeof game.gameState.aiPatterns === 'object') {
                    Object.values(game.gameState.aiPatterns).forEach(patterns => {
                        if (Array.isArray(patterns)) {
                            difficultyData[difficulty].patterns += patterns.length;
                        }
                    });
                }
            }
        }
    }

    // Calculate averages
    const calculateAverage = (scores) => scores.length > 0 ?
        (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;

    const easyAvg = parseFloat(calculateAverage(difficultyData.easy.scores));
    const mediumAvg = parseFloat(calculateAverage(difficultyData.medium.scores));
    const hardAvg = parseFloat(calculateAverage(difficultyData.hard.scores));

    return {
        easyVsMedium: {
            difference: (mediumAvg - easyAvg).toFixed(1)
        },
        mediumVsHard: {
            difference: (hardAvg - mediumAvg).toFixed(1)
        },
        overallImprovement: easyAvg > 0 ? (((hardAvg - easyAvg) / easyAvg) * 100).toFixed(1) : 0,
        strategyEffectiveness: {
            easy: difficultyData.easy.scores.length > 0 ? (100 - easyAvg).toFixed(1) : '0.0',
            medium: difficultyData.medium.scores.length > 0 ? (100 - mediumAvg).toFixed(1) : '0.0',
            hard: difficultyData.hard.scores.length > 0 ? (100 - hardAvg).toFixed(1) : '0.0'
        }
    };
}

async function getRealGameResults() {
    const games = await SinglePlayerGame.find({});
    let totalGames = 0;
    let playerWins = 0;
    let aiWins = 0;
    let totalMoves = 0;
    let gameCount = 0;

    const difficultyStats = {
        easy: { wins: 0, total: 0 },
        medium: { wins: 0, total: 0 },
        hard: { wins: 0, total: 0 }
    };

    const patternStats = {
        easy: 0,
        medium: 0,
        hard: 0
    };

    for (const game of games) {
        if (game.gameState?.statistics) {
            const stats = game.gameState.statistics;
            const difficulty = game.gameState.currentDifficulty || 'medium';

            totalGames += stats.totalGames;
            playerWins += stats.wins;
            aiWins += stats.losses;
            totalMoves += stats.totalMoves;
            gameCount++;

            difficultyStats[difficulty].wins += stats.wins;
            difficultyStats[difficulty].total += stats.totalGames;
        }

        // Count patterns by difficulty
        if (game.gameState?.aiPatterns) {
            const difficulty = game.gameState.currentDifficulty || 'medium';
            if (Array.isArray(game.gameState.aiPatterns)) {
                patternStats[difficulty] += game.gameState.aiPatterns.length;
            } else if (typeof game.gameState.aiPatterns === 'object') {
                Object.entries(game.gameState.aiPatterns).forEach(([diff, patterns]) => {
                    if (Array.isArray(patterns)) {
                        patternStats[diff] += patterns.length;
                    }
                });
            }
        }
    }

    const averageGameLength = gameCount > 0 ? Math.round(totalMoves / gameCount) : 0;
    const playerWinRate = totalGames > 0 ? ((playerWins / totalGames) * 100).toFixed(1) : 0;
    const aiWinRate = totalGames > 0 ? ((aiWins / totalGames) * 100).toFixed(1) : 0;

    return {
        totalGames,
        playerWins,
        aiWins,
        playerWinRate,
        aiWinRate,
        averageGameLength,
        difficultyStats,
        stats: {
            easyPatterns: patternStats.easy,
            mediumPatterns: patternStats.medium,
            hardPatterns: patternStats.hard,
            totalRealGames: totalGames
        }
    };
}
 