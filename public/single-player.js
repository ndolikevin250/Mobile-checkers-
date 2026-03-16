// Add this CheckersAI class definition at the top of the file, before any other code
class CheckersAI {
    constructor(depth = 4, difficulty = 'medium') {
        this.evaluationDepth = depth;
        this.difficulty = difficulty;
        this.learnedPatterns = new Map();

        // Difficulty-specific settings
        this.difficultySettings = {
            easy: {
                maxDepth: 2,
                randomFactor: 0.3, // 30% chance to make suboptimal move
                patternUsage: 0.5, // 50% chance to use learned patterns
                mistakeFrequency: 0.2 // 20% chance to miss obvious threats
            },
            medium: {
                maxDepth: 4,
                randomFactor: 0.1, // 10% chance to make suboptimal move
                patternUsage: 0.8, // 80% chance to use learned patterns
                mistakeFrequency: 0.05 // 5% chance to miss obvious threats
            },
            hard: {
                maxDepth: 6,
                randomFactor: 0.0, // No random suboptimal moves
                patternUsage: 1.0, // Always use learned patterns
                mistakeFrequency: 0.0 // Never miss obvious threats
            }
        };

        this.settings = this.difficultySettings[difficulty];
    }

    learnFromMove(boardState, move, outcome) {
        const boardHash = this.hashBoard(boardState);
        const pattern = {
            move: move,
            outcome: outcome,
            frequency: 1
        };

        if (this.learnedPatterns.has(boardHash)) {
            const existing = this.learnedPatterns.get(boardHash);
            existing.frequency++;
            if (outcome > existing.outcome) {
                existing.outcome = outcome;
                existing.move = move;
            }
        } else {
            this.learnedPatterns.set(boardHash, pattern);
        }
    }

    hashBoard(board) {
        return board.map(row => 
            row.map(cell => 
                cell ? `${cell.color}${cell.isKing ? 'K' : 'P'}` : '_'
            ).join('-')
        ).join('~');
    }

    analyzeMoveSuccess(beforeState, afterState, move) {
        const beforeScore = this.evaluatePosition(beforeState);
        const afterScore = this.evaluatePosition(afterState);
        const improvement = afterScore - beforeScore;

        return {
            success: improvement,
            isPositional: Math.abs(improvement) < 5
        };
    }

    getBestMove(board, depth = this.evaluationDepth, alpha = -Infinity, beta = Infinity, isMaximizing = true) {
        if (depth === 0) {
            return { score: this.evaluatePosition(board) };
        }

        const moves = this.getAllPossibleMoves(board, isMaximizing ? 'red' : 'blue');
        if (moves.length === 0) {
            return { score: isMaximizing ? -1000 : 1000 };
        }

        // Difficulty-specific behavior
        if (this.difficulty === 'easy') {
            return this.getEasyMove(board, moves, isMaximizing);
        } else if (this.difficulty === 'medium') {
            return this.getMediumMove(board, moves, depth, alpha, beta, isMaximizing);
        } else { // hard
            return this.getHardMove(board, moves, depth, alpha, beta, isMaximizing);
        }
    }

    getEasyMove(board, moves, isMaximizing) {
        // Easy AI: Random selection with some logic
        const bestMoves = moves.slice(0, 3); // Consider only top 3 moves

        // 30% chance to pick a random move instead of best
        if (Math.random() < this.settings.randomFactor) {
            return { move: moves[Math.floor(Math.random() * moves.length)], score: 0 };
        }

        // Otherwise pick the best move from limited options
        let bestMove = null;
        let bestScore = isMaximizing ? -Infinity : Infinity;

        for (const move of bestMoves) {
            const boardCopy = JSON.parse(JSON.stringify(board));
            this.simulateMove(boardCopy, move);
            const score = this.evaluatePosition(boardCopy);

            if (isMaximizing && score > bestScore) {
                bestScore = score;
                bestMove = move;
            } else if (!isMaximizing && score < bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        return { move: bestMove, score: bestScore };
    }

    getMediumMove(board, moves, depth, alpha, beta, isMaximizing) {
        // Medium AI: Use learned patterns and standard minimax
        let bestMove = null;
        let bestScore = isMaximizing ? -Infinity : Infinity;

        // Check learned patterns first
        if (Math.random() < this.settings.patternUsage) {
            const boardHash = this.hashBoard(board);
            if (this.learnedPatterns.has(boardHash)) {
                const pattern = this.learnedPatterns.get(boardHash);
                const patternMove = moves.find(m =>
                    m.from.row === pattern.move.from.row &&
                    m.from.col === pattern.move.from.col &&
                    m.to.row === pattern.move.to.row &&
                    m.to.col === pattern.move.to.col
                );
                if (patternMove) {
                    return { move: patternMove, score: pattern.outcome };
                }
            }
        }

        // Fallback to minimax with occasional mistakes
        for (const move of moves) {
            const boardCopy = JSON.parse(JSON.stringify(board));
            this.simulateMove(boardCopy, move);
            const evaluation = this.getBestMove(boardCopy, depth - 1, alpha, beta, !isMaximizing);
            const score = evaluation.score;

            // Occasional mistake
            if (Math.random() < this.settings.mistakeFrequency) {
                continue; // Skip this move, forcing suboptimal choice
            }

            if (isMaximizing && score > bestScore) {
                bestScore = score;
                bestMove = move;
                alpha = Math.max(alpha, score);
            } else if (!isMaximizing && score < bestScore) {
                bestScore = score;
                bestMove = move;
                beta = Math.min(beta, score);
            }

            if (beta <= alpha) break;
        }

        return { move: bestMove, score: bestScore };
    }

    getHardMove(board, moves, depth, alpha, beta, isMaximizing) {
        // Hard AI: Full minimax with learned patterns
        let bestMove = null;
        let bestScore = isMaximizing ? -Infinity : Infinity;

        // Always check learned patterns first
        const boardHash = this.hashBoard(board);
        if (this.learnedPatterns.has(boardHash)) {
            const pattern = this.learnedPatterns.get(boardHash);
            const patternMove = moves.find(m =>
                m.from.row === pattern.move.from.row &&
                m.from.col === pattern.move.from.col &&
                m.to.row === pattern.move.to.row &&
                m.to.col === pattern.move.to.col
            );
            if (patternMove) {
                return { move: patternMove, score: pattern.outcome };
            }
        }

        // Full minimax search
        for (const move of moves) {
            const boardCopy = JSON.parse(JSON.stringify(board));
            this.simulateMove(boardCopy, move);
            const evaluation = this.getBestMove(boardCopy, depth - 1, alpha, beta, !isMaximizing);
            const score = evaluation.score;

            if (isMaximizing && score > bestScore) {
                bestScore = score;
                bestMove = move;
                alpha = Math.max(alpha, score);
            } else if (!isMaximizing && score < bestScore) {
                bestScore = score;
                bestMove = move;
                beta = Math.min(beta, score);
            }

            if (beta <= alpha) break;
        }

        return { move: bestMove, score: bestScore };
    }

    getAllPossibleMoves(board, color) {
        const moves = [];
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (board[row][col]?.color === color) {
                    const validMoves = this.getValidMoves(board, row, col);
                    validMoves.forEach(move => {
                        moves.push({
                            from: { row, col },
                            to: move,
                            isJump: move.isJump
                        });
                    });
                }
            }
        }
        return moves;
    }

    getValidMoves(board, row, col) {
        const piece = board[row][col];
        if (!piece) return [];
        
        const jumps = this.getValidJumps(board, row, col);
        if (jumps.length > 0) return jumps;
        
        const moves = [];
        const directions = piece.isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : 
                          (piece.color === 'blue' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
        
        directions.forEach(([dRow, dCol]) => {
            const newRow = row + dRow;
            const newCol = col + dCol;
            
            if (this.isValidPosition(newRow, newCol) && !board[newRow][newCol]) {
                moves.push({ row: newRow, col: newCol, isJump: false });
            }
        });
        
        return moves;
    }

    getValidJumps(board, row, col) {
        const jumps = [];
        const piece = board[row][col];
        if (!piece) return jumps;
        
        const directions = piece.isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : 
                          (piece.color === 'blue' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
        
        directions.forEach(([dRow, dCol]) => {
            const jumpRow = row + dRow * 2;
            const jumpCol = col + dCol * 2;
            const midRow = row + dRow;
            const midCol = col + dCol;
            
            if (this.isValidPosition(jumpRow, jumpCol) && 
                board[midRow][midCol]?.color !== piece.color && 
                board[midRow][midCol] && 
                !board[jumpRow][jumpCol]) {
                jumps.push({ 
                    row: jumpRow, 
                    col: jumpCol, 
                    isJump: true,
                    captured: { row: midRow, col: midCol }
                });
            }
        });
        
        return jumps;
    }

    simulateMove(board, move) {
        const { from, to } = move;
        board[to.row][to.col] = board[from.row][from.col];
        board[from.row][from.col] = null;

        if (move.isJump) {
            const midRow = from.row + (to.row - from.row) / 2;
            const midCol = from.col + (to.col - from.col) / 2;
            board[midRow][midCol] = null;
        }

        if ((to.row === 0 && board[to.row][to.col].color === 'blue') ||
            (to.row === 7 && board[to.row][to.col].color === 'red')) {
            board[to.row][to.col].isKing = true;
        }
    }

    isValidPosition(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    evaluatePosition(board) {
        let score = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (piece) {
                    const value = piece.isKing ? 3 : 1;
                    score += piece.color === 'red' ? value : -value;
                }
            }
        }
        return score;
    }
}

// Game state variables
let gameBoard = Array(8).fill(null).map(() => Array(8).fill(null));
let selectedPiece = null;
let currentPlayer = 'blue';
let isJumpAvailable = false;
let isMultipleJump = false;
let lastJumpedPiece = null;
let totalPositionalMoves = 0;
let totalTacticalMoves = 0;
let highestScore = -Infinity;
let lowestScore = Infinity;
let gameHistory = [];
let totalGames = 0;
let wins = 0;
let losses = 0;

// Loading Manager
// AI Thinking Manager - handles AI status display
class LoadingManager {
    constructor() {
        this.aiThinking = document.getElementById('aiThinking');
    }

    showAIThinking(status = 'Analyzing board position...', depth = null, confidence = 'High') {
        const statusEl = document.getElementById('aiThinkingStatus');
        const depthEl = document.getElementById('aiThinkingDepth');
        const confidenceEl = document.getElementById('aiThinkingConfidence');

        if (statusEl) statusEl.textContent = status;
        if (depthEl) {
            const displayDepth = depth !== null ? depth : getCurrentAI().evaluationDepth;
            depthEl.textContent = `Depth: ${displayDepth}`;
        }
        if (confidenceEl) confidenceEl.textContent = `Confidence: ${confidence}`;

        this.aiThinking.classList.add('active');
    }

    hideAIThinking() {
        const statusEl = document.getElementById('aiThinkingStatus');
        const depthEl = document.getElementById('aiThinkingDepth');
        const confidenceEl = document.getElementById('aiThinkingConfidence');

        if (statusEl) statusEl.textContent = 'Ready';
        if (depthEl) {
            const currentAI = getCurrentAI();
            depthEl.textContent = `Depth: ${currentAI.evaluationDepth}`;
        }
        if (confidenceEl) confidenceEl.textContent = 'Confidence: Ready';

        this.aiThinking.classList.remove('active');
    }
}

// Initialize loading manager
const loadingManager = new LoadingManager();


// Initialize AI thinking indicator
function initializeAIThinkingIndicator() {
    const aiThinking = document.getElementById('aiThinking');
    if (aiThinking) {
        // Ensure it's always visible with ready state
        aiThinking.style.display = 'block';
        loadingManager.hideAIThinking(); // This sets it to "Ready" state
    }
}

// Sound System
// SoundManager is defined in sound-manager.js (shared with game-room)

// Initialize sound manager
const soundManager = new SoundManager();

// AI Difficulty Settings
let currentDifficulty = 'medium'; // 'easy', 'medium', 'hard'
let aiInstances = {
    easy: new CheckersAI(2, 'easy'),
    medium: new CheckersAI(4, 'medium'),
    hard: new CheckersAI(6, 'hard')
};

// Get current AI instance
function getCurrentAI() {
    return aiInstances[currentDifficulty];
}

// Matrix Rain Animation
// MatrixRain is defined in matrix-rain.js (shared with game-room)

// Global matrix rain instance
let matrixRain;

// Theme management functions
async function changeTheme(themeName) {
    const board = document.getElementById('board');
    const gameContainer = document.querySelector('.game-container');

    // Apply theme only if elements exist
    if (board) {
        board.className = 'board';
        if (themeName !== 'default') {
            board.classList.add(themeName);
        }
    }

    if (gameContainer) {
        gameContainer.className = 'game-container';
        if (themeName !== 'default') {
            gameContainer.classList.add(themeName);
        }
    }

    // Save theme preference to server for registered users, localStorage for guests
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');
    const username = localStorage.getItem('username');

    console.log('Saving theme:', themeName, 'for user:', username, 'type:', userType);

    if (token && userType === 'registered') {
        try {
            console.log('Saving to server for registered user');
            const response = await fetch('/api/preferences/colors', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    preferences: {
                        singlePlayerTheme: themeName
                    }
                })
            });
            console.log('Save response status:', response.status);
            // Don't save to localStorage for registered users
        } catch (error) {
            console.error('Failed to save single-player theme preference:', error);
        }
    } else if (userType === 'guest') {
        console.log('Saving to localStorage for guest user');
        // Only save to localStorage for guest users
        localStorage.setItem('singlePlayerTheme', themeName);
    }

    // Update document root for piece themes
    document.documentElement.className = themeName;
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
                console.log('Loading theme for user:', username, 'token exists:', !!token);
                const response = await fetch(`/api/preferences/colors/${username}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                console.log('Response status:', response.status);
                const data = await response.json();
                console.log('Response data:', data);
                if (data.preferences && data.preferences.singlePlayerTheme) {
                    savedTheme = data.preferences.singlePlayerTheme;
                    console.log('Loaded theme from server:', savedTheme);
                } else {
                    console.log('No singlePlayerTheme found in preferences:', data.preferences);
                }
                // For registered users, don't fall back to localStorage - use default if server fails
            } catch (error) {
                console.error('Failed to load single-player theme preference from server:', error);
                // Registered users get default theme if server fails (don't use localStorage)
                savedTheme = 'default';
            }
        } else {
            // For guest users, use localStorage
            savedTheme = localStorage.getItem('singlePlayerTheme') || 'default';
        }

        const themeSelect = document.getElementById('singlePlayerThemeSelect');
        if (themeSelect) {
            themeSelect.value = savedTheme;
            await changeTheme(savedTheme);
            console.log('Single-player theme loaded:', savedTheme); // Debug log
        } else {
            console.error('Single-player theme selector not found'); // Debug log
        }
    }, 100);
}

// Initialize board
function initializeBoard() {
    const board = document.querySelector('.board');
    board.innerHTML = '';
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell' + ((row + col) % 2 ? ' dark' : '');
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            if ((row + col) % 2 === 1) {
                if (row < 3) {
                    const piece = document.createElement('div');
                    piece.className = 'piece red';
                    cell.appendChild(piece);
                    gameBoard[row][col] = { color: 'red', isKing: false };
                } else if (row > 4) {
                    const piece = document.createElement('div');
                    piece.className = 'piece blue';
                    cell.appendChild(piece);
                    gameBoard[row][col] = { color: 'blue', isKing: false };
                }
            }
            
            board.appendChild(cell);
        }
    }
}

// Handle piece selection and movement
function handleCellClick(e) {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    if (currentPlayer !== 'blue') return;

    // Find piece inside the cell (works for both desktop clicks and mobile synthetic clicks)
    const piece = cell.querySelector('.piece');

    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    if (selectedPiece) {
        const validMoves = getValidMoves(selectedPiece.row, selectedPiece.col);
        const move = validMoves.find(m => m.row === row && m.col === col);

        if (move) {
            movePiece(selectedPiece.row, selectedPiece.col, row, col, move.isJump);

            if (move.isJump) {
                const additionalJumps = getValidJumps(row, col);
                if (additionalJumps.length > 0) {
                    isMultipleJump = true;
                    selectedPiece = { row, col, element: cell.querySelector('.piece') };
                    highlightValidMoves(additionalJumps);
                    return;
                }
            }

            endTurn();
        } else {
            // Play invalid move sound
            soundManager.playInvalid();
            clearHighlights();
            selectedPiece = null;
        }
        return;
    }

    if (piece && gameBoard[row][col]?.color === 'blue') {
        selectedPiece = { row, col, element: piece };
        piece.classList.add('selected');

        const validMoves = getValidMoves(row, col);
        highlightValidMoves(validMoves);
    }
}

function getValidMoves(row, col) {
    const piece = gameBoard[row][col];
    if (!piece) return [];
    
    const jumps = getValidJumps(row, col);
    isJumpAvailable = jumps.length > 0;
    
    if (isJumpAvailable && !isMultipleJump) {
        return jumps;
    }
    
    const moves = [];
    const directions = piece.isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : 
                      (piece.color === 'blue' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
    
    directions.forEach(([dRow, dCol]) => {
        const newRow = row + dRow;
        const newCol = col + dCol;
        
        if (isValidPosition(newRow, newCol) && !gameBoard[newRow][newCol]) {
            moves.push({ row: newRow, col: newCol, isJump: false });
        }
    });
    
    return isJumpAvailable ? [...jumps, ...moves] : moves;
}

function getValidJumps(row, col) {
    const jumps = [];
    const piece = gameBoard[row][col];
    if (!piece) return jumps;
    
    const directions = piece.isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : 
                      (piece.color === 'blue' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
    
    directions.forEach(([dRow, dCol]) => {
        const jumpRow = row + dRow * 2;
        const jumpCol = col + dCol * 2;
        const midRow = row + dRow;
        const midCol = col + dCol;
        
        if (isValidPosition(jumpRow, jumpCol) && 
            gameBoard[midRow][midCol]?.color !== piece.color && 
            gameBoard[midRow][midCol] && 
            !gameBoard[jumpRow][jumpCol]) {
            jumps.push({ 
                row: jumpRow, 
                col: jumpCol, 
                isJump: true,
                captured: { row: midRow, col: midCol }
            });
        }
    });
    
    return jumps;
}

function highlightValidMoves(moves) {
    clearHighlights();
    moves.forEach(move => {
        const cell = getCellElement(move.row, move.col);
        cell.classList.add('valid-move');
    });
}

function movePiece(fromRow, fromCol, toRow, toCol, isJump) {
    const fromCell = getCellElement(fromRow, fromCol);
    const toCell = getCellElement(toRow, toCol);
    const piece = fromCell.querySelector('.piece');

    gameBoard[toRow][toCol] = gameBoard[fromRow][fromCol];
    gameBoard[fromRow][fromCol] = null;

    if (isJump) {
        const midRow = fromRow + (toRow - fromRow) / 2;
        const midCol = fromCol + (toCol - fromCol) / 2;
        const capturedCell = getCellElement(midRow, midCol);

        if (capturedCell.querySelector('.piece')) {
            capturedCell.removeChild(capturedCell.querySelector('.piece'));
        }
        gameBoard[midRow][midCol] = null;
        lastJumpedPiece = { row: toRow, col: toCol };

        // Play capture sound
        soundManager.playCapture();
    } else {
        // Play regular move sound
        soundManager.playMove();
    }

    fromCell.removeChild(piece);
    toCell.appendChild(piece);

    if ((toRow === 0 && gameBoard[toRow][toCol].color === 'blue') ||
        (toRow === 7 && gameBoard[toRow][toCol].color === 'red')) {
        gameBoard[toRow][toCol].isKing = true;
        piece.classList.add('king');

        // Play king promotion sound
        soundManager.playKing();
    }

    // Schedule auto-save after move
    scheduleAutoSave();
}

function endTurn() {
    clearHighlights();
    selectedPiece = null;
    isMultipleJump = false;
    lastJumpedPiece = null;
    currentPlayer = 'red';
    
    if (checkGameEnd()) {
        return;
    }

    setTimeout(makeAIMove, 500);
}

// AI move handling with logging
const makeAIMove = (() => {
    let lastPatternCount = 0;
    let lastLoggedMove = null;

    return function(continueJumpFrom = null) {
        // Handle jump continuation vs new AI turn
        if (continueJumpFrom) {
            // This is a forced jump continuation - only consider jumps from the specified position
            const currentAI = getCurrentAI();
            loadingManager.showAIThinking('Continuing jump sequence...', currentAI.evaluationDepth, 'Mandatory');

            setTimeout(() => {
                const additionalJumps = getValidJumps(continueJumpFrom.row, continueJumpFrom.col);
                if (additionalJumps.length > 0) {
                    // Take the first available jump (could be improved to choose best)
                    const nextJump = additionalJumps[0];

                    movePiece(continueJumpFrom.row, continueJumpFrom.col, nextJump.row, nextJump.col, true);

                    // Check if more jumps are available
                    const moreJumps = getValidJumps(nextJump.row, nextJump.col);
                    if (moreJumps.length > 0) {
                        // Continue recursively
                        setTimeout(() => makeAIMove({row: nextJump.row, col: nextJump.col}), 300);
                    } else {
                        // Jump sequence complete, end AI turn
                        loadingManager.hideAIThinking();
                        currentPlayer = 'blue';
                    }
                } else {
                    // No more jumps available, end turn
                    loadingManager.hideAIThinking();
                    currentPlayer = 'blue';
                }
            }, 300);
            return;
        }

        // Normal AI turn - evaluate all possible moves
        const beforeState = JSON.parse(JSON.stringify(gameBoard));
        const currentAI = getCurrentAI();

        loadingManager.showAIThinking('Evaluating possible moves...', currentAI.evaluationDepth, 'Calculating');

        // Simulate thinking stages with realistic delays
        setTimeout(() => {
            loadingManager.showAIThinking('Analyzing board patterns...', currentAI.evaluationDepth, 'Processing');

            setTimeout(() => {
                loadingManager.showAIThinking('Calculating optimal move...', currentAI.evaluationDepth, 'Computing');

                setTimeout(() => {
                    const result = currentAI.getBestMove(gameBoard, currentAI.evaluationDepth, -Infinity, Infinity, true);

                    if (result.move) {
                        movePiece(
                            result.move.from.row,
                            result.move.from.col,
                            result.move.to.row,
                            result.move.to.col,
                            result.move.isJump
                        );

                        // Hide thinking indicator after move completes
                        loadingManager.hideAIThinking();

                        if (checkGameEnd()) {
                            return;
                        }

                        const afterState = JSON.parse(JSON.stringify(gameBoard));
                        const moveAnalysis = currentAI.analyzeMoveSuccess(beforeState, afterState, result.move);

                        // Only learn from medium and hard difficulties to maintain quality patterns
                        if (currentDifficulty !== 'easy') {
                            currentAI.learnFromMove(beforeState, result.move, moveAnalysis.success);
                        }

                        if (moveAnalysis.isPositional) {
                            totalPositionalMoves++;
                        } else {
                            totalTacticalMoves++;
                        }
                        highestScore = Math.max(highestScore, moveAnalysis.success);
                        lowestScore = Math.min(lowestScore, moveAnalysis.success);

                        const moveId = `${result.move.from.row},${result.move.from.col}-${result.move.to.row},${result.move.to.col}`;

                        if (moveId !== lastLoggedMove) {
                            console.clear();
                            console.log(`AI Learning Summary (${currentDifficulty.toUpperCase()}):
    Patterns: ${currentAI.learnedPatterns.size}
    Moves: ${totalPositionalMoves + totalTacticalMoves} (${totalPositionalMoves} positional, ${totalTacticalMoves} tactical)
    Score Range: ${lowestScore.toFixed(2)} to ${highestScore.toFixed(2)}
    Current Move: ${moveAnalysis.isPositional ? 'Positional' : 'Tactical'} (${moveAnalysis.success.toFixed(2)})`);

                            lastLoggedMove = moveId;
                            lastPatternCount = currentAI.learnedPatterns.size;
                        }

                        // Handle multiple jumps - AI MUST continue jumping if possible
                        if (result.move.isJump) {
                            const additionalJumps = getValidJumps(result.move.to.row, result.move.to.col);
                            console.log('AI jump made to:', result.move.to.row, result.move.to.col);
                            console.log('Additional jumps available:', additionalJumps.length);

                            if (additionalJumps.length > 0) {
                                console.log('AI continuing jump sequence...');

                                // Start jump continuation from the current position
                                setTimeout(() => makeAIMove({row: result.move.to.row, col: result.move.to.col}), 300);
                                return; // Don't end AI turn yet
                            }
                        }
                    }

                    currentPlayer = 'blue';
                }, 300); // Delay for computing phase
            }, 200); // Delay for processing phase
        }, 200); // Delay for initial analysis phase
    };
})();

// Helper functions
function isValidPosition(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function getCellElement(row, col) {
    return document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
}

function clearHighlights() {
    document.querySelectorAll('.selected, .valid-move').forEach(el => {
        el.classList.remove('selected', 'valid-move');
    });
}

function checkGameEnd() {
    let bluePieces = 0;
    let redPieces = 0;
    let blueHasMoves = false;
    let redHasMoves = false;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = gameBoard[row][col];
            if (piece) {
                if (piece.color === 'blue') {
                    bluePieces++;
                    if (!blueHasMoves) {
                        const moves = getValidMoves(row, col);
                        if (moves.length > 0) blueHasMoves = true;
                    }
                } else {
                    redPieces++;
                    if (!redHasMoves) {
                        const moves = getValidMoves(row, col);
                        if (moves.length > 0) redHasMoves = true;
                    }
                }
            }
        }
    }

    if (bluePieces === 0 || !blueHasMoves) {
        showEndGame('AI Wins!');
        return true;
    }
    if (redPieces === 0 || !redHasMoves) {
        showEndGame('You Win!');
        return true;
    }

    return false;
}

function showEndGame(message) {
    // Determine game result for statistics
    const isVictory = message === 'You Win!';
    const result = isVictory ? 'win' : 'loss';

    // Update user statistics
    updateUserStats(result);

    // Play victory or defeat sound
    if (isVictory) {
        soundManager.playVictory();
    } else {
        soundManager.playDefeat();
    }

    const modal = document.getElementById('endGameModal');
    const winnerText = document.getElementById('winner-text');
    const victoryEffects = document.getElementById('victoryEffects');
    const defeatEffects = document.getElementById('defeatEffects');
    const resultStats = document.getElementById('resultStats');

    // Set victory or defeat mode
    modal.classList.remove('victory-modal');
    modal.classList.remove('defeat-modal');
    modal.classList.add(isVictory ? 'victory-modal' : 'defeat-modal');

    winnerText.textContent = message;
    winnerText.className = `result-title ${isVictory ? 'victory' : 'defeat'}`;

    // Show appropriate effects
    victoryEffects.style.display = isVictory ? 'block' : 'none';
    defeatEffects.style.display = isVictory ? 'none' : 'block';

    // Generate effects
    if (isVictory) {
        generateFireworks();
    } else {
        generateLightning();
    }

    // Update and show statistics
    if (isVictory) {
        wins++;
    } else {
        losses++;
    }
    totalGames++;

    resultStats.innerHTML = `
        <div class="stat-item">Games Played: ${totalGames}</div>
        <div class="stat-item">Wins: ${wins}</div>
        <div class="stat-item">Losses: ${losses}</div>
        <div class="stat-item">Win Rate: ${totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0}%</div>
    `;

    modal.classList.remove('hidden');

    // Statistics are already updated above via updateUserStats()
    // Save immediately after game end
    saveGameState();
}

// Generate fireworks for victory
function generateFireworks() {
    const container = document.getElementById('fireworksContainer');
    container.innerHTML = '';

    // Create multiple fireworks at different positions
    const positions = [20, 35, 50, 65, 80]; // percentages across screen
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff'];

    positions.forEach((pos, index) => {
        setTimeout(() => {
            createFirework(pos, colors[index % colors.length]);
        }, index * 300); // Stagger fireworks
    });
}

function createFirework(position, color) {
    const container = document.getElementById('fireworksContainer');

    // Create firework rocket
    const firework = document.createElement('div');
    firework.className = 'firework';
    firework.style.left = position + '%';
    firework.style.background = `linear-gradient(to top, ${color}, #ffffff)`;

    // Create trail
    const trail = document.createElement('div');
    trail.className = 'firework-trail';
    trail.style.left = position + '%';
    trail.style.background = `linear-gradient(to bottom, ${color}80, transparent)`;

    // Create explosion
    const explosion = document.createElement('div');
    explosion.className = 'firework-explosion';
    explosion.style.left = position + '%';

    // Create explosion particles
    for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.className = 'explosion-particle';

        // Calculate particle direction
        const angle = (i / 8) * Math.PI * 2;
        const distance = 80 + Math.random() * 40;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;

        particle.style.setProperty('--tx', tx + 'px');
        particle.style.setProperty('--ty', ty + 'px');
        particle.style.animationDelay = (1.5 + Math.random() * 0.3) + 's';

        explosion.appendChild(particle);
    }

    container.appendChild(firework);
    container.appendChild(trail);
    container.appendChild(explosion);

    // Clean up after animation
    setTimeout(() => {
        if (container.contains(firework)) container.removeChild(firework);
        if (container.contains(trail)) container.removeChild(trail);
        if (container.contains(explosion)) container.removeChild(explosion);
    }, 4000);
}

// Generate lightning effects for defeat
function generateLightning() {
    const container = document.getElementById('lightningContainer');
    container.innerHTML = '';

    const lightningSymbols = ['⚡', '⚡', '⚡', '⚡', '⚡'];
    lightningSymbols.forEach((symbol, index) => {
        const bolt = document.createElement('div');
        bolt.className = 'lightning-bolt';
        bolt.textContent = symbol;
        bolt.style.left = (index * 20) + '%';
        bolt.style.animationDelay = (index * 0.1) + 's';
        container.appendChild(bolt);
    });
}

function restartGame() {
    gameBoard = Array(8).fill(null).map(() => Array(8).fill(null));
    selectedPiece = null;
    currentPlayer = 'blue';
    isJumpAvailable = false;
    isMultipleJump = false;
    lastJumpedPiece = null;

    // Hide and reset the enhanced modal
    const modal = document.getElementById('endGameModal');
    modal.classList.add('hidden');

    // Clear any remaining effects
    const confettiContainer = document.getElementById('confettiContainer');
    const lightningContainer = document.getElementById('lightningContainer');
    if (confettiContainer) confettiContainer.innerHTML = '';
    if (lightningContainer) lightningContainer.innerHTML = '';

    initializeBoard();
}

// State persistence
async function saveGameState() {
    const userId = localStorage.getItem('username');
    if (!userId) return;

    // Save patterns from all AI instances
    const allPatterns = {};
    for (const [difficulty, aiInstance] of Object.entries(aiInstances)) {
        allPatterns[difficulty] = Array.from(aiInstance.learnedPatterns.entries()).map(([key, value]) => ({
            key,
            value: {
                move: value.move,
                outcome: value.outcome,
                frequency: value.frequency
            }
        }));
    }

    const gameState = {
        board: gameBoard,
        currentPlayer: currentPlayer,
        moveHistory: gameHistory,
        aiPatterns: allPatterns,
        currentDifficulty: currentDifficulty,
        statistics: {
            totalGames: totalGames || 0,
            wins: wins || 0,
            losses: losses || 0,
            totalMoves: totalPositionalMoves + totalTacticalMoves,
            aiLearningProgress: aiInstances.medium.learnedPatterns.size + aiInstances.hard.learnedPatterns.size
        }
    };

    const userType = localStorage.getItem('userType');
    const token = localStorage.getItem('token');

    if (token && userType === 'registered') {
        try {
            await fetch('/api/single-player/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId, gameState })
            });
        } catch (error) {
            console.error('Error saving game state:', error);
        }
    } else {
        // Save guest game state via IP-based API
        try {
            await fetch('/api/guest/single-player/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameState })
            });
        } catch (error) {
            console.error('Error saving guest game state:', error);
        }
    }
}

async function loadGameState() {
    const userId = localStorage.getItem('username');
    if (!userId) return;

    const userType = localStorage.getItem('userType');
    const token = localStorage.getItem('token');

    let data = null;

    if (token && userType === 'registered') {
        try {
            const response = await fetch(`/api/single-player/load/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            data = await response.json();
        } catch (error) {
            console.error('Error loading game state:', error);
            return;
        }
    } else {
        // Load guest game state via IP-based API
        try {
            const response = await fetch('/api/guest/single-player/load');
            data = await response.json();
        } catch (error) {
            console.error('Error loading guest game state:', error);
            return;
        }
    }

    if (data && data.success && data.gameState) {
        // Load difficulty setting
        if (data.gameState.currentDifficulty) {
            currentDifficulty = data.gameState.currentDifficulty;
            localStorage.setItem('aiDifficulty', currentDifficulty);
        }

        // Load patterns for all AI instances (preserves AI learning)
        if (data.gameState.aiPatterns) {
            if (Array.isArray(data.gameState.aiPatterns)) {
                // Legacy format - load into medium AI
                aiInstances.medium.learnedPatterns = new Map(
                    data.gameState.aiPatterns.map(pattern => [
                        pattern.key,
                        pattern.value
                    ])
                );
            } else {
                // New format - load patterns for each difficulty
                for (const [difficulty, patterns] of Object.entries(data.gameState.aiPatterns)) {
                    if (aiInstances[difficulty]) {
                        aiInstances[difficulty].learnedPatterns = new Map(
                            patterns.map(pattern => [
                                pattern.key,
                                pattern.value
                            ])
                        );
                    }
                }
            }
        }

        // Load statistics
        if (data.gameState.statistics) {
            totalGames = data.gameState.statistics.totalGames;
            wins = data.gameState.statistics.wins;
            losses = data.gameState.statistics.losses;
            totalPositionalMoves = data.gameState.statistics.totalMoves;
        }

        // Always start with a fresh board — don't restore mid-game state
        return false;
    }
    return false;
}

function updateBoardDisplay() {
    const board = document.querySelector('.board');
    board.innerHTML = '';
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell' + ((row + col) % 2 ? ' dark' : '');
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            const piece = gameBoard[row][col];
            if (piece) {
                const pieceDiv = document.createElement('div');
                pieceDiv.className = `piece ${piece.color}${piece.isKing ? ' king' : ''}`;
                cell.appendChild(pieceDiv);
            }
            
            board.appendChild(cell);
        }
    }
}

// Auto-save functionality
let autoSaveTimeout;
function scheduleAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(saveGameState, 1000);
}

// Settings modal functions
function openSettings() {
    // Update radio buttons to reflect current difficulty
    document.getElementById(currentDifficulty + 'Mode').checked = true;
    document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
    const selectedDifficulty = document.querySelector('input[name="difficulty"]:checked').value;

    if (selectedDifficulty !== currentDifficulty) {
        currentDifficulty = selectedDifficulty;
        localStorage.setItem('aiDifficulty', currentDifficulty);

        // Show confirmation message
        alert(`AI difficulty changed to ${currentDifficulty.toUpperCase()}! The change will take effect in the next game.`);

        // Update AI instance with saved patterns from previous difficulty
        if (currentDifficulty !== 'easy') {
            const previousAI = aiInstances[currentDifficulty === 'medium' ? 'hard' : 'medium'];
            if (previousAI && previousAI.learnedPatterns.size > 0) {
                aiInstances[currentDifficulty].learnedPatterns = new Map(previousAI.learnedPatterns);
            }
        }
    }

    closeSettings();
}

// Load difficulty setting on page load
function loadDifficultySetting() {
    const saved = localStorage.getItem('aiDifficulty');
    if (saved && ['easy', 'medium', 'hard'].includes(saved)) {
        currentDifficulty = saved;
    }
}

// Sound toggle function
function toggleSound() {
    const soundBtn = document.getElementById('soundToggle');
    soundManager.enabled = !soundManager.enabled;

    if (soundManager.enabled) {
        soundBtn.textContent = '🔊 Sound';
        soundBtn.classList.remove('sound-off');
    } else {
        soundBtn.textContent = '🔇 Muted';
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
        if (soundManager.enabled) {
            soundBtn.textContent = '🔊 Sound';
            soundBtn.classList.remove('sound-off');
        } else {
            soundBtn.textContent = '🔇 Muted';
            soundBtn.classList.add('sound-off');
        }
    }
}

// Profile and Dashboard Functions
function initializeProfileIcon() {
    const profileIcon = document.getElementById('profileIcon');
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (token && userType === 'registered') {
        // Registered user - show full profile icon
        profileIcon.classList.remove('guest');
        profileIcon.title = 'User Dashboard (Registered)';
    } else {
        // Guest user - show dimmed profile icon
        profileIcon.classList.add('guest');
        profileIcon.title = 'User Dashboard (Guest)';
    }
}

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

        // Load dashboard statistics
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
            displayDashboardStats(data.stats);
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
            displayDashboardStats(getDefaultStats());
        }
    } catch (error) {
        console.error('Error loading user dashboard:', error);
        displayDashboardStats(getDefaultStats());
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
            displayDashboardStats(data.stats);
        } else {
            displayDashboardStats(getDefaultStats());
        }
    } catch (error) {
        console.error('Error loading guest dashboard:', error);
        displayDashboardStats(getDefaultStats());
    }
}

function displayDashboardStats(stats) {
    const statsDiv = document.getElementById('dashboardStats');

    statsDiv.innerHTML = `
        <div class="stat-card">
            <h4>Total Games</h4>
            <span class="stat-value">${stats.totalGames}</span>
            <span class="stat-label">Played</span>
        </div>
        <div class="stat-card">
            <h4>Wins</h4>
            <span class="stat-value">${stats.wins}</span>
            <span class="stat-label">Victories</span>
        </div>
        <div class="stat-card">
            <h4>Win Rate</h4>
            <span class="stat-value">${stats.winRate}%</span>
            <span class="stat-label">Success</span>
        </div>
        <div class="stat-card">
            <h4>Favorite</h4>
            <span class="stat-value">${stats.favoriteDifficulty || 'Medium'}</span>
            <span class="stat-label">Difficulty</span>
        </div>
    `;
}

function getDefaultStats() {
    return {
        totalGames: totalGames,
        wins: wins,
        losses: losses,
        winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
        favoriteDifficulty: currentDifficulty,
        totalPlayTime: 0
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
                const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', 'checkers-guest-data.json');
                linkElement.click();
            }
        } catch (error) {
            console.error('Error exporting guest data:', error);
        }
    }
}

async function clearUserData() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (!confirm('Are you sure you want to clear all your data? This action cannot be undone!')) {
        return;
    }

    if (token && userType === 'registered') {
        // Clear registered user data (would need backend API)
        alert('Data clearing feature coming soon for registered users!');
    } else {
        // Clear guest data from server
        try {
            await fetch('/api/guest/dashboard', { method: 'DELETE' });

            // Reset current session data
            totalGames = 0;
            wins = 0;
            losses = 0;

            // Reload dashboard
            loadGuestDashboardData();

            alert('Guest data cleared successfully!');
        } catch (error) {
            console.error('Error clearing guest data:', error);
        }
    }
}

// Update user statistics when games end
async function updateUserStats(result) {
    const userType = localStorage.getItem('userType');
    const token = localStorage.getItem('token');

    if (token && userType === 'registered') {
        // Update registered user stats via API
        try {
            const gameDuration = 0; // Would track actual game duration
            await fetch('/api/user/dashboard/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    result: result,
                    difficulty: currentDifficulty,
                    duration: gameDuration
                })
            });
        } catch (error) {
            console.error('Error updating user stats:', error);
        }
    } else {
        // Update guest statistics via IP-based API
        try {
            await fetch('/api/guest/dashboard/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    result: result,
                    difficulty: currentDifficulty,
                    duration: 0
                })
            });
        } catch (error) {
            console.error('Error updating guest stats:', error);
        }
    }
}

// Menu navigation function
async function goToMenu() {
    // Check if user is logged in (has a token)
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (token && userType === 'registered') {
        // Registered user: ask if they want to logout or just go back to menu
        const shouldLogout = confirm('Do you want to logout and return to the login page? Click Cancel to go back to game mode selection.');

        if (shouldLogout) {
            // Call logout endpoint to clear game states
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                console.error('Logout error:', error);
                // Continue with local cleanup even if server logout fails
            }

            // Clear local storage (including any admin tokens and preferences that might interfere)
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            localStorage.removeItem('userType');
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminUsername');
            localStorage.removeItem('adminRole');
            localStorage.removeItem('boardTheme');
            localStorage.removeItem('singlePlayerTheme');

            // Prevent navigation back to this page
            history.replaceState(null, null, 'index.html');
            window.location.href = 'index.html';
        } else {
            // Just go to game mode selection page
            window.location.href = 'game-mode.html';
        }
    } else {
        // Guest user: go to welcome page
        window.location.href = 'index.html';
    }
}

// Initialize game
// Check authentication when page loads
document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    // Allow both registered users and guests to access single-player
    const isValidUser = (userType === 'registered' && token) || userType === 'guest';

    if (!isValidUser) {
        // User navigated here without proper authentication
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
        return;
    }

    // User is authenticated, proceed with game initialization

    // Prevent browser back/forward navigation when logged out
    window.addEventListener('beforeunload', function() {
        // This helps prevent accidental navigation
    });

    // Handle visibility change to check if user came back via navigation
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            // Page became visible again - check if user is still authenticated
            const currentToken = localStorage.getItem('token');
            const currentUserType = localStorage.getItem('userType');

            const stillValidUser = (currentUserType === 'registered' && currentToken) || currentUserType === 'guest';

            if (!stillValidUser) {
                // User navigated back but is no longer authenticated
                history.replaceState(null, null, 'index.html');
                window.location.href = 'index.html';
            }
        }
    });

    // Initialize Matrix rain background animation
    matrixRain = new MatrixRain('matrix-canvas');

    // Load saved theme
    loadSavedTheme();

    // Continue with normal initialization
    initializeGame().catch(error => {
        console.error('Error initializing game:', error);
    });
});

async function initializeGame() {
    // Enable audio on first user interaction
    let audioEnabled = false;
    const enableAudio = () => {
        if (!audioEnabled) {
            soundManager.enableAudio();
            // Play game start sound after audio is enabled
            setTimeout(() => soundManager.playGameStart(), 300);
            audioEnabled = true;
        }
        document.removeEventListener('click', enableAudio, true);
        document.removeEventListener('touchstart', enableAudio, true);
        document.removeEventListener('touchend', enableAudio, true);
        document.removeEventListener('keydown', enableAudio, true);
    };
    // Use capture phase so it fires before preventDefault in mobile-touch.js
    document.addEventListener('click', enableAudio, true);
    document.addEventListener('touchstart', enableAudio, true);
    document.addEventListener('touchend', enableAudio, true);
    document.addEventListener('keydown', enableAudio, true);

    // Initialize AI thinking indicator
    initializeAIThinkingIndicator();

    // Initialize profile icon
    initializeProfileIcon();

    // Initialize game instantly (no loading animation for single player)
    loadDifficultySetting();
    loadSoundPreference();

    // Load existing game state
    const stateLoaded = await loadGameState();
    if (!stateLoaded) {
        initializeBoard();
    } else {
        updateBoardDisplay();
    }

    // Set up event listeners
    document.querySelector('.board').addEventListener('click', handleCellClick);

    // Add settings modal close on outside click
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') {
            closeSettings();
        }
    });
}

// Save state before unload
window.addEventListener('beforeunload', () => {
    saveGameState();
});