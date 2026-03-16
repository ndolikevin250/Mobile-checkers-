let ws;
let matchData;
let game;
let playerColor;
let isHost;
let gameState = null;
let opponentLeft = false;
let unreadMessages = 0;
let isChatOpen = false;
let chatHistory = [];
let gameEnded = false;
let rematchRequested = false;
let rematchAccepted = false;
let opponentRematchRequested = false;
let wsReady = false; // Track WebSocket connection state

// Sound System - Same as single-player mode
// SoundManager is defined in sound-manager.js (shared with single-player)

// Initialize sound manager
const soundManager = new SoundManager();

// Matrix Rain Animation for Game Room
// MatrixRain is defined in matrix-rain.js (shared with single-player)

// Global matrix rain instance for game room
let gameRoomMatrixRain;

// Helper function to get turn indicator text
function getTurnIndicatorText(currentPlayer) {
    if (currentPlayer === playerColor) {
        return "Your turn";
    } else {
        return "Opponent's turn";
    }
}

const style = document.createElement('style');
style.textContent = `
    .king-symbol {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 1.2em;
        color: #4ecca3;
        text-shadow: 0 0 10px rgba(78, 204, 163, 0.5);
        opacity: 0;
        transition: opacity 0.3s ease;
        line-height: 1;
        pointer-events: none;
    }

    .king .king-symbol {
        opacity: 1;
    }
`;
document.head.appendChild(style);

const pulseAnimation = document.createElement('style');
pulseAnimation.textContent = `
    @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
    }
`;
document.head.appendChild(pulseAnimation);

function leaveRoom() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        safeSend({
            type: 'leave_game_room',
            matchId: matchData.matchId,
            username: localStorage.getItem('username')
        });
    }
    window.location.href = 'lobby.html';
}

// Check authentication and match data when page loads
document.addEventListener('DOMContentLoaded', async function() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');
    matchData = JSON.parse(localStorage.getItem('matchData'));

    // Check if user is authenticated and has valid match data
    const isValidUser = (userType === 'registered' && token) || userType === 'guest';
    const hasValidMatch = matchData && matchData.matchId;

    if (!isValidUser || !hasValidMatch) {
        // User navigated here without proper authentication or match data
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
        return;
    }

    // Initialize game room
    initializeGameRoom();
    initializeChatHistory();
    loadSavedTheme();

    // Check if game ended and restore modal (only if recent)
    const savedGameEnded = localStorage.getItem('gameEnded') === 'true';
    if (savedGameEnded) {
        const savedWinner = localStorage.getItem('lastGameWinner');
        const savedTime = parseInt(localStorage.getItem('gameEndTime') || '0');
        const now = Date.now();
        const timeDiff = now - savedTime;
        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Only restore if the game ended within the last 5 minutes
        if (savedWinner && timeDiff < fiveMinutes) {
            gameEnded = true; // Restore the gameEnded state
            await showEndGameModal(savedWinner);
        } else {
            // Clear old saved state
            localStorage.removeItem('lastGameWinner');
            localStorage.removeItem('gameEnded');
            localStorage.removeItem('gameEndTime');
        }
    }

    // Initialize Matrix rain background animation
    gameRoomMatrixRain = new MatrixRain('matrix-canvas');

    // Load sound preference
    loadSoundPreference();

    // Enable audio on user interaction (capture phase so it fires before mobile-touch.js preventDefault)
    document.addEventListener('click', () => soundManager.enableAudio(), { once: true, capture: true });
    document.addEventListener('touchstart', () => soundManager.enableAudio(), { once: true, capture: true });
    document.addEventListener('touchend', () => soundManager.enableAudio(), { once: true, capture: true });

    // Prevent browser back/forward navigation when logged out
    window.addEventListener('beforeunload', function() {
        // This helps prevent accidental navigation
    });

    // Handle visibility change to check if user came back via navigation
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            // Page became visible again - check if user is still authenticated and has match
            const currentToken = localStorage.getItem('token');
            const currentUserType = localStorage.getItem('userType');
            const currentMatchData = JSON.parse(localStorage.getItem('matchData'));

            const stillValidUser = (currentUserType === 'registered' && currentToken) || currentUserType === 'guest';
            const stillHasValidMatch = currentMatchData && currentMatchData.matchId;

            if (!stillValidUser || !stillHasValidMatch) {
                // User navigated back but is no longer authenticated or match is invalid
                history.replaceState(null, null, 'index.html');
                window.location.href = 'index.html';
            }
        }
    });
});

function initializeGameRoom() {
    matchData = JSON.parse(localStorage.getItem('matchData'));
    if (!matchData) {
        window.location.href = 'lobby.html';
        return;
    }

    document.getElementById('player1Info').textContent = matchData.player1;
    document.getElementById('player2Info').textContent = matchData.player2;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);
    wsReady = false; // Reset ready state

    const username = localStorage.getItem('username');
    isHost = matchData.player1 === username;

    ws.onopen = () => {
        wsReady = true; // Mark as ready
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'join_game_room',
                matchId: matchData.matchId,
                username: username,
                isHost: isHost
            }));
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsReady = false;
    };

    ws.onclose = () => {
        console.log('Disconnected from game room');
        wsReady = false;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleGameMessage(data);
    };
}

// Helper function to safely send WebSocket messages
function safeSend(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
    } else {
        console.warn('WebSocket not ready, message queued:', message);
        // Queue the message to send when connection is ready
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            ws.addEventListener('open', () => {
                ws.send(JSON.stringify(message));
            }, { once: true });
        }
        return false;
    }
}

async function handleGameMessage(data) {
    switch(data.type) {
        case 'game_start':
            playerColor = data.color;
            // Clear any saved game end state from previous games
            localStorage.removeItem('lastGameWinner');
            localStorage.removeItem('gameEnded');
            localStorage.removeItem('gameEndTime');
            gameEnded = false;

            if (data.gameState) {
                game = new CheckersGame(playerColor === 'blue');
                game.restoreState(data.gameState);
            } else {
                game = new CheckersGame(playerColor === 'blue');
                document.getElementById('turn').textContent = getTurnIndicatorText('red');
                updateTurnIndicatorColors();
            }
            // Play game start sound only if user has already interacted
            if (soundManager.userInteracted) {
                setTimeout(async () => await soundManager.playGameStart(), 300);
            }
            break;
            
        case 'move':
            if (game && data.username !== localStorage.getItem('username')) {
                game.handleOpponentMove(data.move);
            }
            break;
            
        case 'player_left':
            handlePlayerLeft(data.username);
            break;
            
        case 'chat':
            if (data.username !== localStorage.getItem('username')) {
                addChatMessage(data.username, data.message);
            }
            break;
            
        case 'rematch_request':
            if (data.username !== localStorage.getItem('username')) {
                handleRematchRequest();
            }
            break;
            
        case 'rematch_accepted':
            if (data.username !== localStorage.getItem('username')) {
                handleRematchAccepted();
            }
            break;
            
        case 'game_reset':
            resetGame();
            break;
            
        case 'end_session':
            if (data.username !== localStorage.getItem('username')) {
                handleEndSession();
            }
            break;
            
        case 'game_end':
            await showEndGameModal(data.winner);
            break;
    }
}

function handlePlayerLeft(username) {
    if (opponentLeft) return; // Prevent multiple notifications

    // Don't show "player left" during an active rematch flow
    if (rematchRequested || opponentRematchRequested) {
        console.log('Ignoring player_left during rematch flow - opponent will reconnect');
        return;
    }

    opponentLeft = true;
    const notification = document.createElement('div');
    notification.className = 'leave-notification cyber-border';
    notification.innerHTML = `
        <p>${username} has left the room</p>
        <button class="cyber-button" onclick="endGame()">
            <span class="cyber-button__glitch"></span>
            <span class="cyber-button__text">End Game</span>
        </button>
    `;

    document.querySelector('.game-room-container').appendChild(notification);
}

function endGame() {
    localStorage.removeItem(`chat_${matchData.matchId}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
        safeSend({
            type: 'leave_game_room',
            matchId: matchData.matchId,
            username: localStorage.getItem('username'),
            endGame: true
        });
    }
    window.location.href = 'lobby.html';
}

async function showEndGameModal(winner) {
    gameEnded = true;
    const modal = document.querySelector('.end-game-modal');
    const winnerText = document.getElementById('winnerText');

    // Robust Case-Insensitive Comparison
    // winner from DB might be "Red" or "Blue"
    // playerColor is "red" or "blue"
    const winnerNormalized = winner ? winner.toLowerCase() : '';
    const playerNormalized = playerColor ? playerColor.toLowerCase() : '';

    const userWon = winnerNormalized === playerNormalized;

    winnerText.textContent = userWon ? 'You Win!' : 'Opponent Wins!';

    // Update turn indicator to show game has ended
    document.getElementById('turn').textContent = 'Game Over';
    updateTurnIndicatorColors();

    // Play victory or defeat sound
    if (userWon) {
        await soundManager.playVictory();
    } else {
        await soundManager.playDefeat();
    }

    // Save winner info for modal restoration (only for refresh recovery)
    localStorage.setItem('lastGameWinner', winner);
    localStorage.setItem('gameEnded', 'true');
    localStorage.setItem('gameEndTime', Date.now().toString()); // Add timestamp

    modal.classList.remove('hidden');

    // Stats are now updated server-side to prevent duplication
}

class CheckersGame {
    constructor(isFlipped) {
        this.board = [];
        this.selectedPiece = null;
        this.currentPlayer = 'red';
        this.isMultipleJump = false;
        this.isJumpSequence = false;
        this.validJumpDestinations = [];
        this.isFlipped = isFlipped;
        this.initializeBoard();
        this.setupEventListeners();
    }

    initializeBoard() {
        const boardElement = document.getElementById('board');
        boardElement.style.transform = this.isFlipped ? 'rotate(180deg)' : 'none';

        for (let row = 0; row < 8; row++) {
            this.board[row] = [];
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'white' : 'black'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                square.style.transform = this.isFlipped ? 'rotate(180deg)' : 'none';
                
                if ((row + col) % 2 !== 0) {
                    if (row < 3) {
                        this.createPiece(square, 'blue');
                        this.board[row][col] = 'blue';
                    } else if (row > 4) {
                        this.createPiece(square, 'red');
                        this.board[row][col] = 'red';
                    } else {
                        this.board[row][col] = null;
                    }
                } else {
                    this.board[row][col] = null;
                }
                
                boardElement.appendChild(square);
            }
        }
    }

    createPiece(square, color) {
        const piece = document.createElement('div');
        piece.className = `piece ${color}-piece`;
        
        // Add single king symbol that stays upright
        const kingSymbol = document.createElement('div');
        kingSymbol.className = 'king-symbol';
        kingSymbol.innerHTML = '♔';
        piece.appendChild(kingSymbol);
        
        // Only rotate the piece, not the king symbol
        if (this.isFlipped) {
            piece.style.transform = 'rotate(180deg)';
            kingSymbol.style.transform = 'translate(-50%, -50%) rotate(-180deg)';
        }
        
        square.appendChild(piece);
    }

    handleOpponentMove(move) {
        const { fromRow, fromCol, toRow, toCol, isCapture, isMultipleJump } = move;
        
        const piece = this.board[fromRow][fromCol];
        if (!piece) return;

        // Update board state
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        const oldSquare = this.getSquareElement(fromRow, fromCol);
        const newSquare = this.getSquareElement(toRow, toCol);
        const pieceElement = oldSquare?.querySelector('.piece');

        if (oldSquare && newSquare && pieceElement) {
            // Handle king promotion
            const isKingRow = (piece.includes('red') && toRow === 0) || 
                             (piece.includes('blue') && toRow === 7);
            
            if (isKingRow && !piece.includes('king')) {
                this.board[toRow][toCol] += '-king';
                pieceElement.classList.add('king');
                
                // Update king symbol orientation
                const kingSymbol = pieceElement.querySelector('.king-symbol');
                if (kingSymbol) {
                    kingSymbol.style.transform = this.isFlipped ? 
                        'translate(-50%, -50%) rotate(-180deg)' : 
                        'translate(-50%, -50%)';
                }
            }

            oldSquare.removeChild(pieceElement);
            newSquare.appendChild(pieceElement);
        }

        // Handle capture
        if (isCapture) {
            const capturedRow = fromRow + (toRow - fromRow) / 2;
            const capturedCol = fromCol + (toCol - fromCol) / 2;
            this.board[capturedRow][capturedCol] = null;
            const capturedSquare = this.getSquareElement(capturedRow, capturedCol);
            if (capturedSquare) {
                capturedSquare.innerHTML = '';
            }
        }

        // Only update turn if it's not a multiple jump in progress
        if (!isMultipleJump) {
            this.currentPlayer = this.currentPlayer === 'red' ? 'blue' : 'red';
            // Force immediate turn update
            requestAnimationFrame(() => {
                document.getElementById('turn').textContent = getTurnIndicatorText(this.currentPlayer);
                updateTurnIndicatorColors();
            });
        }
    }

    setupEventListeners() {
        const boardElement = document.getElementById('board');
        boardElement.addEventListener('click', (e) => {
            const square = e.target.closest('.square');
            if (!square) return;

            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);

            this.handleSquareClick(row, col);
        });
    }

    async handleSquareClick(row, col) {
        if (this.currentPlayer !== playerColor) {
            return;
        }

        const piece = this.board[row][col];

        if (piece && piece.includes(playerColor)) {
            // Block re-selecting a different piece during jump sequence
            if (this.isJumpSequence) return;
            this.selectPiece(row, col);
            return;
        }

        if (this.selectedPiece) {
            const validMoves = this.getValidMoves(this.selectedPiece.row, this.selectedPiece.col);
            const move = validMoves.find(m => m.row === row && m.col === col);

            if (move) {
                this.makeMove(row, col, move.capture);
            } else {
                // Play invalid move sound
                await soundManager.playInvalid();
            }
        }
    }

    selectPiece(row, col) {
        // Mandatory capture: block selecting a piece that has no captures
        if (!this.isJumpSequence && this.hasAnyCapture()) {
            const moves = this.getValidMoves(row, col);
            if (!moves.some(m => m.capture)) return;
        }

        document.querySelectorAll('.selected').forEach(el => {
            el.classList.remove('selected');
        });

        const square = this.getSquareElement(row, col);
        if (square) {
            square.querySelector('.piece').classList.add('selected');
            this.selectedPiece = { row, col };
            this.showValidMoves(row, col);
        }
    }

    showValidMoves(row, col) {
        document.querySelectorAll('.valid-move').forEach(el => {
            el.classList.remove('valid-move');
        });

        const moves = this.getValidMoves(row, col);

        if (this.isJumpSequence) {
            this.validJumpDestinations = moves.filter(move => move.capture);
            this.validJumpDestinations.forEach(move => {
                const square = this.getSquareElement(move.row, move.col);
                if (square) {
                    square.classList.add('valid-move');
                }
            });
        } else {
            // Mandatory capture: only show captures when any capture is available
            const displayMoves = this.hasAnyCapture() ? moves.filter(m => m.capture) : moves;
            displayMoves.forEach(move => {
                const square = this.getSquareElement(move.row, move.col);
                if (square) {
                    square.classList.add('valid-move');
                }
            });
        }
    }

    getValidMoves(row, col) {
        const moves = [];
        const piece = this.board[row][col];

        if (piece.includes('king')) {
            // Kings can move in all directions
            this.checkMove(row, col, 1, -1, moves);  // down-left
            this.checkMove(row, col, 1, 1, moves);   // down-right
            this.checkMove(row, col, -1, -1, moves); // up-left
            this.checkMove(row, col, -1, 1, moves);  // up-right
            
            this.checkCapture(row, col, 1, -1, moves);  // down-left capture
            this.checkCapture(row, col, 1, 1, moves);   // down-right capture
            this.checkCapture(row, col, -1, -1, moves); // up-left capture
            this.checkCapture(row, col, -1, 1, moves);  // up-right capture
        } else {
            // Regular pieces only move in their respective directions
            const direction = piece.includes('red') ? -1 : 1;
            this.checkMove(row, col, direction, -1, moves);
            this.checkMove(row, col, direction, 1, moves);
            
            // Check captures in both diagonal directions
            this.checkCapture(row, col, direction, -1, moves);
            this.checkCapture(row, col, direction, 1, moves);
        }

        return moves;
    }

    checkMove(row, col, rowDir, colDir, moves) {
        const newRow = row + rowDir;
        const newCol = col + colDir;

        if (this.isValidPosition(newRow, newCol) && !this.board[newRow][newCol]) {
            moves.push({ row: newRow, col: newCol });
        }
    }

    checkCapture(row, col, rowDir, colDir, moves) {
        const jumpRow = row + rowDir * 2;
        const jumpCol = col + colDir * 2;
        const enemyRow = row + rowDir;
        const enemyCol = col + colDir;
        const piece = this.board[row][col];

        if (this.isValidPosition(jumpRow, jumpCol) && 
            !this.board[jumpRow][jumpCol] && 
            this.board[enemyRow][enemyCol] && 
            !this.board[enemyRow][enemyCol].includes(piece.split('-')[0])) {
            moves.push({ 
                row: jumpRow, 
                col: jumpCol, 
                capture: true,
                capturedRow: enemyRow,
                capturedCol: enemyCol
            });
        }
    }

    isValidPosition(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    // Check if any piece of the current player has a capture available
    hasAnyCapture() {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.includes(playerColor)) {
                    const moves = this.getValidMoves(row, col);
                    if (moves.some(m => m.capture)) return true;
                }
            }
        }
        return false;
    }

    getSquareElement(row, col) {
        return document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
    }

    restoreState(state) {
        this.board = state.board;
        this.currentPlayer = state.currentPlayer;
        this.selectedPiece = state.selectedPiece;
        this.isJumpSequence = state.isJumpSequence;
        this.validJumpDestinations = state.validJumpDestinations;
        
        const boardElement = document.getElementById('board');
        boardElement.innerHTML = '';
        boardElement.style.transform = this.isFlipped ? 'rotate(180deg)' : 'none';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'white' : 'black'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                square.style.transform = this.isFlipped ? 'rotate(180deg)' : 'none';
                
                const piece = this.board[row][col];
                if (piece) {
                    const pieceDiv = document.createElement('div');
                    pieceDiv.className = `piece ${piece.split('-')[0]}-piece`;
                    
                    // Create king symbol container
                    const kingSymbol = document.createElement('div');
                    kingSymbol.className = 'king-symbol';
                    kingSymbol.innerHTML = '♔';
                    
                    // Set initial transforms
                    if (this.isFlipped) {
                        pieceDiv.style.transform = 'rotate(180deg)';
                        // Counter-rotate king symbol to keep it upright
                        kingSymbol.style.transform = 'translate(-50%, -50%) rotate(-180deg)';
                    } else {
                        kingSymbol.style.transform = 'translate(-50%, -50%)';
                    }
                    
                    pieceDiv.appendChild(kingSymbol);
                    
                    if (piece.includes('king')) {
                        pieceDiv.classList.add('king');
                    }
                    
                    square.appendChild(pieceDiv);
                }
                
                boardElement.appendChild(square);
            }
        }

        // Force immediate turn indicator update
        requestAnimationFrame(() => {
            document.getElementById('turn').textContent = getTurnIndicatorText(this.currentPlayer);
            updateTurnIndicatorColors();
        });
    }

    async makeMove(newRow, newCol, isCapture) {
        if (this.currentPlayer !== playerColor || !this.selectedPiece) {
            return;
        }

        const oldRow = this.selectedPiece.row;
        const oldCol = this.selectedPiece.col;
        const piece = this.board[oldRow][oldCol];

        // Make the move
        this.board[newRow][newCol] = piece;
        this.board[oldRow][oldCol] = null;

        // Update UI
        const oldSquare = this.getSquareElement(oldRow, oldCol);
        const newSquare = this.getSquareElement(newRow, newCol);
        const pieceElement = oldSquare.querySelector('.piece');

        // Handle king promotion
        const isKingRow = (playerColor === 'red' && newRow === 0) || 
                          (playerColor === 'blue' && newRow === 7);
        
        if (isKingRow && !piece.includes('king')) {
            this.board[newRow][newCol] += '-king';
            pieceElement.classList.add('king');
            const kingSymbol = pieceElement.querySelector('.king-symbol');
            if (kingSymbol && this.isFlipped) {
                kingSymbol.style.transform = 'translate(-50%, -50%) rotate(-180deg)';
            }
            // Play king sound
            await soundManager.playKing();
        }

        oldSquare.removeChild(pieceElement);
        newSquare.appendChild(pieceElement);

        if (isCapture) {
            // Play capture sound
            await soundManager.playCapture();

            const capturedRow = oldRow + (newRow - oldRow) / 2;
            const capturedCol = oldCol + (newCol - oldCol) / 2;
            this.board[capturedRow][capturedCol] = null;
            const capturedSquare = this.getSquareElement(capturedRow, capturedCol);
            capturedSquare.innerHTML = '';

            // Check for additional captures
            const additionalMoves = [];
            if (this.board[newRow][newCol].includes('king')) {
                this.checkCapture(newRow, newCol, 1, 1, additionalMoves);
                this.checkCapture(newRow, newCol, 1, -1, additionalMoves);
                this.checkCapture(newRow, newCol, -1, 1, additionalMoves);
                this.checkCapture(newRow, newCol, -1, -1, additionalMoves);
            } else {
                const direction = playerColor === 'red' ? -1 : 1;
                this.checkCapture(newRow, newCol, direction, -1, additionalMoves);
                this.checkCapture(newRow, newCol, direction, 1, additionalMoves);
            }

            // Handle multiple jump sequence
            if (additionalMoves.length > 0) {
                this.isJumpSequence = true;
                this.selectedPiece = { row: newRow, col: newCol };
                this.showValidMoves(newRow, newCol);

                // Send intermediate state during multiple jumps
                safeSend({
                    type: 'move',
                    matchId: matchData.matchId,
                    username: localStorage.getItem('username'),
                    move: {
                        fromRow: oldRow,
                        fromCol: oldCol,
                        toRow: newRow,
                        toCol: newCol,
                        isCapture: true,
                        isMultipleJump: true
                    },
                    gameState: {
                        board: JSON.parse(JSON.stringify(this.board)),
                        currentPlayer: this.currentPlayer,
                        isJumpSequence: true
                    }
                });
                return;
            }
        } else {
            // Play move sound for regular moves
            await soundManager.playMove();
        }

        // End turn
        this.isJumpSequence = false;
        this.validJumpDestinations = [];
        this.currentPlayer = this.currentPlayer === 'red' ? 'blue' : 'red';
        
        // Force immediate turn update
        requestAnimationFrame(() => {
            document.getElementById('turn').textContent = getTurnIndicatorText(this.currentPlayer);
            updateTurnIndicatorColors();
        });

        // Clear selection
        document.querySelectorAll('.selected, .valid-move').forEach(el => {
            el.classList.remove('selected', 'valid-move');
        });
        this.selectedPiece = null;

        // Send final state with turn change
        safeSend({
            type: 'move',
            matchId: matchData.matchId,
            username: localStorage.getItem('username'),
            move: {
                fromRow: oldRow,
                fromCol: oldCol,
                toRow: newRow,
                toCol: newCol,
                isCapture: isCapture,
                isMultipleJump: false
            },
            gameState: {
                board: JSON.parse(JSON.stringify(this.board)),
                currentPlayer: this.currentPlayer,
                isJumpSequence: false
            }
        });

        // After sending the move to server, check if game has ended
        if (!this.isJumpSequence && this.checkGameEnd()) {
            return;
        }
    }

    checkGameEnd() {
        const currentPlayerPieces = this.board.flat().filter(piece => 
            piece && piece.includes(this.currentPlayer)
        );
        
        if (currentPlayerPieces.length === 0) {
            const winner = this.currentPlayer === 'red' ? 'Blue' : 'Red';
            // Send game end state to server
            safeSend({
                type: 'game_end',
                matchId: matchData.matchId,
                winner: winner
            });
            return true;
        }
        
        // Check if current player has any valid moves
        let hasValidMoves = false;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.includes(this.currentPlayer)) {
                    const moves = this.getValidMoves(row, col);
                    if (moves.length > 0) {
                        hasValidMoves = true;
                        break;
                    }
                }
            }
            if (hasValidMoves) break;
        }
        
        if (!hasValidMoves) {
            const winner = this.currentPlayer === 'red' ? 'Blue' : 'Red';
            // Send game end state to server
            safeSend({
                type: 'game_end',
                matchId: matchData.matchId,
                winner: winner
            });
            return true;
        }
        
        return false;
    }
}

function toggleChat() {
    const chatContainer = document.querySelector('.chat-container');
    const chatButton = document.querySelector('.chat-button');
    isChatOpen = !isChatOpen;
    
    chatContainer.classList.toggle('hidden');
    
    if (isChatOpen) {
        // Reset notification when opening chat
        unreadMessages = 0;
        updateChatNotification();
        // Scroll to bottom of chat
        const chatMessages = document.querySelector('.chat-messages');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function updateChatNotification() {
    const notification = document.querySelector('.chat-notification');
    if (unreadMessages > 0) {
        notification.textContent = unreadMessages;
        notification.classList.remove('hidden');
    } else {
        notification.classList.add('hidden');
    }
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendChatMessage();
    }
}

function sendChatMessage() {
    const input = document.querySelector('.chat-input input');
    const message = input.value.trim();

    if (message) {
        const username = localStorage.getItem('username');
        safeSend({
            type: 'chat',
            matchId: matchData.matchId,
            username: username,
            message: message
        });

        addChatMessage(username, message, true);
        input.value = '';
    }
}

function addChatMessage(username, message, isOwn = false) {
    const chatMessages = document.querySelector('.chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;

    // Create elements securely
    const userSpan = document.createElement('span');
    userSpan.className = 'username';
    userSpan.textContent = username + ': '; // Safe text insertion

    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.textContent = message; // Safe text insertion prevents XSS

    messageDiv.appendChild(userSpan);
    messageDiv.appendChild(msgSpan);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Update notification if chat is closed and message is from other user
    if (!isChatOpen && !isOwn) {
        unreadMessages++;
        updateChatNotification();
    }
}

function initializeChatHistory() {
    // Clear existing chat messages
    const chatMessages = document.querySelector('.chat-messages');
    chatMessages.innerHTML = '';
    chatHistory = [];
    
    // Load chat history from server
    fetch(`/api/chat-history/${matchData.matchId}`)
        .then(response => response.json())
        .then(data => {
            if (data.messages && data.messages.length > 0) {
                const username = localStorage.getItem('username');
                data.messages.forEach(msg => {
                    addChatMessage(msg.username, msg.message, msg.username === username);
                });
                
                // Update unread count for new messages
                if (!isChatOpen) {
                    const unreadCount = data.messages.filter(msg => 
                        !msg.isRead && msg.username !== username
                    ).length;
                    unreadMessages = unreadCount;
                    updateChatNotification();
                }
            }
        })
        .catch(error => {
            console.error('Error loading chat history:', error);
        });
}

function requestRematch() {
    if (!rematchRequested) {
        rematchRequested = true;
        document.getElementById('rematchStatus').textContent = 'Waiting for opponent...';
        document.getElementById('rematchStatus').classList.remove('hidden');

        // Disable rematch button immediately
        const rematchButton = document.querySelector('.modal-buttons button:first-child');
        rematchButton.disabled = true;
        rematchButton.style.opacity = '0.5';

        safeSend({
            type: 'rematch_request',
            matchId: matchData.matchId,
            username: localStorage.getItem('username')
        });
    }
}

function endSession() {
    safeSend({
        type: 'end_session',
        matchId: matchData.matchId,
        username: localStorage.getItem('username')
    });
    window.location.href = 'lobby.html';
}

function handleRematchRequest() {
    opponentRematchRequested = true;
    const modal = document.querySelector('.end-game-modal');
    const rematchButton = modal.querySelector('.modal-buttons button:first-child');

    document.getElementById('rematchStatus').classList.remove('hidden');

    if (!rematchRequested) {
        // Show non-blocking accept/decline UI instead of confirm() to avoid freezing WebSocket
        document.getElementById('rematchStatus').innerHTML = `
            <span>Opponent wants a rematch!</span>
            <div style="margin-top: 10px;">
                <button class="cyber-button" id="acceptRematchBtn" style="margin-right: 10px;">
                    <span class="cyber-button__text">Accept</span>
                </button>
                <button class="cyber-button" id="declineRematchBtn">
                    <span class="cyber-button__text">Decline</span>
                </button>
            </div>
        `;

        rematchButton.style.animation = 'pulse 1s infinite';

        document.getElementById('acceptRematchBtn').addEventListener('click', () => {
            rematchRequested = true;
            safeSend({
                type: 'rematch_accepted',
                matchId: matchData.matchId,
                username: localStorage.getItem('username')
            });

            rematchButton.disabled = true;
            rematchButton.style.opacity = '0.5';
            rematchButton.style.animation = '';
            document.getElementById('rematchStatus').textContent = 'Rematch accepted! Starting new game...';
        });

        document.getElementById('declineRematchBtn').addEventListener('click', () => {
            rematchButton.style.animation = '';
            document.getElementById('rematchStatus').textContent = 'Rematch declined.';
        });
    } else {
        // We already requested rematch and opponent also wants one - auto-accept
        document.getElementById('rematchStatus').textContent = 'Opponent also wants a rematch!';
        safeSend({
            type: 'rematch_accepted',
            matchId: matchData.matchId,
            username: localStorage.getItem('username')
        });

        rematchButton.disabled = true;
        rematchButton.style.opacity = '0.5';
    }
}

function handleRematchAccepted() {
    rematchAccepted = true;
    document.getElementById('rematchStatus').textContent = 'Rematch accepted!';
    
    // If both players have accepted, initiate game reset
    if (rematchRequested && rematchAccepted) {
        document.getElementById('rematchStatus').textContent = 'Starting new game...';
        setTimeout(() => {
            safeSend({
                type: 'game_reset',
                matchId: matchData.matchId,
                username: localStorage.getItem('username')
            });
        }, 1000);
    }
}

function resetGame() {
    // Reset all game state variables
    gameEnded = false;
    rematchRequested = false;
    rematchAccepted = false;
    opponentRematchRequested = false;
    opponentLeft = false;

    // Remove any "player left" notifications from previous game
    const leaveNotifications = document.querySelectorAll('.leave-notification');
    leaveNotifications.forEach(n => n.remove());

    // Clear saved game end state
    localStorage.removeItem('lastGameWinner');
    localStorage.removeItem('gameEnded'); // Clear gameEnded state
    localStorage.removeItem('gameEndTime');

    // Clear the board
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    
    // Initialize new game
    game = new CheckersGame(playerColor === 'blue');
    
    // Hide end game modal
    document.querySelector('.end-game-modal').classList.add('hidden');
    document.getElementById('rematchStatus').classList.add('hidden');
    
    // Reset turn indicator
    document.getElementById('turn').textContent = getTurnIndicatorText('red');
    updateTurnIndicatorColors();
    
    // Reset button states
    const rematchButton = document.querySelector('.modal-buttons button:first-child');
    rematchButton.disabled = false;
    rematchButton.style.opacity = '1';
    rematchButton.style.animation = '';
}

function handleEndSession() {
    alert('Opponent has ended the session.');
    window.location.href = 'lobby.html';
}

// Theme management functions
async function changeTheme(themeName) {
    const board = document.getElementById('board');
    const gameContainer = document.querySelector('.game-room-container');

    // Remove all theme classes first
    board.className = 'board';
    gameContainer.className = 'game-room-container cyber-border';

    // Apply new theme
    if (themeName !== 'default') {
        board.classList.add(themeName);
        gameContainer.classList.add(themeName);
    }

    // Save theme preference to server (only for registered users)
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (token && userType === 'registered') {
        try {
            await fetch('/api/preferences/colors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    preferences: {
                        theme: themeName
                    }
                })
            });
            // Don't save to localStorage for registered users
        } catch (error) {
            console.error('Failed to save theme preference:', error);
        }
    } else if (userType === 'guest') {
        // Only save to localStorage for guest users
        localStorage.setItem('boardTheme', themeName);
    }

    // Update document root for piece themes
    document.documentElement.className = themeName;

    // Update turn indicator colors for the new theme
    updateTurnIndicatorColors();
}

function updateTurnIndicatorColors() {
    const infoPanel = document.querySelector('.info-panel');
    if (!infoPanel) return;

    // Get current turn from the text content
    const turnText = document.getElementById('turn');
    if (!turnText) return;

    const text = turnText.textContent.toLowerCase();

    // Remove existing turn classes
    infoPanel.classList.remove('your-turn', 'opponent-turn');

    // Add appropriate class based on current turn
    if (text.includes('your')) {
        infoPanel.classList.add('your-turn');
    } else if (text.includes('opponent')) {
        infoPanel.classList.add('opponent-turn');
    }
}

async function loadSavedTheme() {
    // Use setTimeout to ensure DOM is fully loaded
    setTimeout(async () => {
        const token = localStorage.getItem('token');
        const userType = localStorage.getItem('userType');
        const username = localStorage.getItem('username');

        let savedTheme = 'default';

        // Try to load theme from server for registered users
        if (token && userType === 'registered' && username) {
            try {
                const response = await fetch(`/api/preferences/colors/${username}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const data = await response.json();
                if (data.preferences && data.preferences.theme) {
                    savedTheme = data.preferences.theme;
                }
                // For registered users, don't fall back to localStorage - use default if server fails
            } catch (error) {
                console.error('Failed to load theme preference from server:', error);
                // Registered users get default theme if server fails (don't use localStorage)
                savedTheme = 'default';
            }
        } else {
            // For guest users, use localStorage
            savedTheme = localStorage.getItem('boardTheme') || 'default';
        }

        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) {
            themeSelect.value = savedTheme;
            await changeTheme(savedTheme);
            console.log('Theme loaded:', savedTheme); // Debug log
        } else {
            console.error('Theme selector not found'); // Debug log
        }
    }, 100);
}

// Theme initialization merged into main DOMContentLoaded listener above

// User Dashboard Functions
function openUserDashboard() {
    const modal = document.getElementById('userDashboardModal');
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (token && userType === 'registered') {
        // Load registered user data
        loadUserDashboardData();
    } else {
        // Load guest user data
        loadGuestDashboardData();
    }

    modal.classList.remove('hidden');
}

function closeUserDashboard() {
    const modal = document.getElementById('userDashboardModal');
    modal.classList.add('hidden');
}

async function loadUserDashboardData() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');

    try {
        // Load user profile info
        const userInfoDiv = document.getElementById('userInfo');
        userInfoDiv.innerHTML = `
            <h3>👤 ${username}</h3>
            <p><strong>Account Type:</strong> Registered User</p>
            <p><strong>Data Persistence:</strong> Permanent</p>
            <p><strong>Last Login:</strong> ${new Date().toLocaleString()}</p>
        `;

        // Load dashboard statistics (both single-player and multiplayer)
        console.log('Loading dashboard with token:', token ? 'present' : 'missing');
        const response = await fetch('/api/user/dashboard', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Dashboard API response status:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('Dashboard data received:', data);

            // Process and separate single-player vs multiplayer stats
            const processedStats = processDashboardStats(data.stats);
            displayCombinedDashboardStats(processedStats);
        } else {
            const errorText = await response.text();
            console.error('Failed to load dashboard data. Status:', response.status, 'Response:', errorText);

            // Handle authentication errors - clear invalid token and fall back to guest mode
            if (response.status === 401 || response.status === 403) {
                console.log('Token invalid/expired, clearing token and switching to guest mode');
                localStorage.removeItem('token');
                localStorage.removeItem('userType');
                localStorage.setItem('userType', 'guest'); // Ensure userType is set to guest

                // Show message to user
                alert('Your session has expired. Please log in again to view your dashboard data.');

                // Reload dashboard as guest
                loadGuestDashboardData();
                return;
            }

            // For other errors, show default stats
            displayCombinedDashboardStats(getCombinedDefaultStats());
        }
    } catch (error) {
        console.error('Error loading user dashboard:', error);
        displayCombinedDashboardStats(getCombinedDefaultStats());
    }
}

async function loadGuestDashboardData() {
    const username = localStorage.getItem('username') || 'Guest Player';

    // Guest user info
    const userInfoDiv = document.getElementById('userInfo');
    userInfoDiv.innerHTML = `
        <h3>👤 ${username}</h3>
        <p><strong>Account Type:</strong> Guest User</p>
        <p><strong>Data Persistence:</strong> Per IP Address</p>
        <p><strong>Note:</strong> Your data is saved and linked to your IP address</p>
    `;

    // Load guest statistics from server (IP-based)
    try {
        const response = await fetch('/api/guest/dashboard');
        if (response.ok) {
            const data = await response.json();
            const stats = data.stats;

            // Separate single-player and multiplayer from gameHistory
            const singleGames = (stats.gameHistory || []).filter(g => g.opponent === 'AI');
            const multiGames = (stats.gameHistory || []).filter(g => g.opponent === 'Player');

            const combinedStats = {
                singlePlayer: {
                    totalGames: singleGames.length,
                    wins: singleGames.filter(g => g.result === 'win').length,
                    losses: singleGames.filter(g => g.result === 'loss').length,
                    winRate: singleGames.length > 0 ? Math.round((singleGames.filter(g => g.result === 'win').length / singleGames.length) * 100) : 0,
                    favoriteDifficulty: stats.favoriteDifficulty || 'Medium'
                },
                multiplayer: {
                    totalGames: multiGames.length,
                    wins: multiGames.filter(g => g.result === 'win').length,
                    losses: multiGames.filter(g => g.result === 'loss').length,
                    winRate: multiGames.length > 0 ? Math.round((multiGames.filter(g => g.result === 'win').length / multiGames.length) * 100) : 0
                }
            };

            displayCombinedDashboardStats(combinedStats);
        } else {
            displayCombinedDashboardStats(getDefaultCombinedStats());
        }
    } catch (error) {
        console.error('Error loading guest dashboard:', error);
        displayCombinedDashboardStats(getDefaultCombinedStats());
    }
}

function displayCombinedDashboardStats(stats) {
    const statsDiv = document.getElementById('dashboardStats');

    // Handle both old format (single stats object) and new format (with singlePlayer/multiplayer)
    let singleStats = stats.singlePlayer || stats;
    let multiStats = stats.multiplayer || { totalGames: 0, wins: 0, losses: 0, winRate: 0 };

    statsDiv.innerHTML = `
        <div class="stats-section">
            <h4 style="color: var(--primary-color); text-align: center; margin-bottom: 15px;">Single Player Mode</h4>
            <div class="stat-grid">
                <div class="stat-card">
                    <h4>Total Games</h4>
                    <span class="stat-value">${singleStats.totalGames}</span>
                    <span class="stat-label">Played</span>
                </div>
                <div class="stat-card">
                    <h4>Wins</h4>
                    <span class="stat-value">${singleStats.wins}</span>
                    <span class="stat-label">Victories</span>
                </div>
                <div class="stat-card">
                    <h4>Win Rate</h4>
                    <span class="stat-value">${singleStats.winRate}%</span>
                    <span class="stat-label">Success</span>
                </div>
                <div class="stat-card">
                    <h4>Favorite</h4>
                    <span class="stat-value">${singleStats.favoriteDifficulty || 'Medium'}</span>
                    <span class="stat-label">Difficulty</span>
                </div>
            </div>
        </div>

        <div class="stats-section">
            <h4 style="color: var(--primary-color); text-align: center; margin: 25px 0 15px 0;">Multiplayer Mode</h4>
            <div class="stat-grid">
                <div class="stat-card">
                    <h4>Total Games</h4>
                    <span class="stat-value">${multiStats.totalGames}</span>
                    <span class="stat-label">Played</span>
                </div>
                <div class="stat-card">
                    <h4>Wins</h4>
                    <span class="stat-value">${multiStats.wins}</span>
                    <span class="stat-label">Victories</span>
                </div>
                <div class="stat-card">
                    <h4>Win Rate</h4>
                    <span class="stat-value">${multiStats.winRate}%</span>
                    <span class="stat-label">Success</span>
                </div>
                <div class="stat-card">
                    <h4>Current</h4>
                    <span class="stat-value">${multiStats.totalGames > 0 ? 'Active' : 'New'}</span>
                    <span class="stat-label">Status</span>
                </div>
            </div>
        </div>
    `;
}

function getCombinedDefaultStats() {
    return {
        singlePlayer: {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: 0,
            favoriteDifficulty: 'Medium'
        },
        multiplayer: {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: 0
        }
    };
}

async function exportUserData() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (token && userType === 'registered') {
        // Export registered user data
        alert('Data export feature coming soon for registered users!');
    } else {
        // Export guest data from server
        try {
            const response = await fetch('/api/guest/dashboard');
            if (response.ok) {
                const data = await response.json();
                const guestData = {
                    username: localStorage.getItem('username') || 'Guest Player',
                    ...data.stats,
                    exportedAt: new Date().toISOString()
                };

                const dataStr = JSON.stringify(guestData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });

                const link = document.createElement('a');
                link.href = URL.createObjectURL(dataBlob);
                link.download = 'checkers-stats.json';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                alert('Guest data exported successfully!');
            }
        } catch (error) {
            console.error('Error exporting guest data:', error);
        }
    }
}

async function clearUserData() {
    if (confirm('Are you sure you want to clear all your game data? This action cannot be undone.')) {
        const token = localStorage.getItem('token');
        const userType = localStorage.getItem('userType');

        if (token && userType === 'registered') {
            alert('Registered user data clearing is not available in-game. Please contact support.');
        } else {
            // Clear guest data from server
            try {
                await fetch('/api/guest/dashboard', { method: 'DELETE' });
                alert('All guest data has been cleared!');
                closeUserDashboard();
            } catch (error) {
                console.error('Error clearing guest data:', error);
            }
        }
    }
}

// Process dashboard stats to separate single-player vs multiplayer
function processDashboardStats(stats) {
    // Initialize categorized stats
    const singlePlayer = {
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        favoriteDifficulty: stats.favoriteDifficulty || 'Medium'
    };

    const multiplayer = {
        totalGames: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0
    };

    // If gameHistory exists, categorize games
    if (stats.gameHistory && Array.isArray(stats.gameHistory)) {
        stats.gameHistory.forEach(game => {
            if (game.difficulty === 'multiplayer') {
                multiplayer.totalGames++;
                if (game.result === 'win') multiplayer.wins++;
                else if (game.result === 'loss') multiplayer.losses++;
                else if (game.result === 'draw') multiplayer.draws++;
            } else {
                // Assume it's single-player (Easy, Medium, Hard, etc.)
                singlePlayer.totalGames++;
                if (game.result === 'win') singlePlayer.wins++;
                else if (game.result === 'loss') singlePlayer.losses++;
                else if (game.result === 'draw') singlePlayer.draws++;
            }
        });
    } else {
        // Fallback: assume all games are single-player if no history
        singlePlayer.totalGames = stats.totalGames || 0;
        singlePlayer.wins = stats.wins || 0;
        singlePlayer.losses = stats.losses || 0;
        singlePlayer.draws = stats.draws || 0;
    }

    // Calculate win rates
    singlePlayer.winRate = singlePlayer.totalGames > 0 ?
        Math.round((singlePlayer.wins / singlePlayer.totalGames) * 100) : 0;

    multiplayer.winRate = multiplayer.totalGames > 0 ?
        Math.round((multiplayer.wins / multiplayer.totalGames) * 100) : 0;

    return { singlePlayer, multiplayer };
}

// Statistics are now handled server-side to prevent duplication

function toggleSound() {
    const soundBtn = document.getElementById('soundToggle');
    const soundText = soundBtn.querySelector('.cyber-button__text');
    soundManager.enabled = !soundManager.enabled;

    if (soundManager.enabled) {
        soundText.textContent = '🔊 Sound';
        soundBtn.classList.remove('sound-off');
    } else {
        soundText.textContent = '🔇 Muted';
        soundBtn.classList.add('sound-off');
    }

    localStorage.setItem('soundEnabled', soundManager.enabled);
}

// Load sound preference
function loadSoundPreference() {
    const soundEnabled = localStorage.getItem('soundEnabled');
    if (soundEnabled !== null) {
        soundManager.enabled = soundEnabled === 'true';
        const soundBtn = document.getElementById('soundToggle');
        const soundText = soundBtn.querySelector('.cyber-button__text');
        if (soundManager.enabled) {
            soundText.textContent = '🔊 Sound';
            soundBtn.classList.remove('sound-off');
        } else {
            soundText.textContent = '🔇 Muted';
            soundBtn.classList.add('sound-off');
        }
    }
}

window.addEventListener('beforeunload', () => {
    // Don't send leave_game_room on page refresh - let WebSocket close naturally
    // Page refresh is not the same as intentionally leaving the game
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(); // Clean WebSocket closure
    }
}); 