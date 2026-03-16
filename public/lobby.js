let ws;
let username;
let userType;
let isSearchingMatch = false;
let matchCheckInterval = null;
let wsReady = false; // Track WebSocket connection state
let waveformAnimId = null;
let statusCycleInterval = null;

// Check authentication when page loads
document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    // Check if user is authenticated (registered users need token, guests don't)
    const isValidUser = (userType === 'registered' && token) || userType === 'guest';

    if (!isValidUser) {
        // User navigated here without proper authentication
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
        return;
    }

    // Initialize WebSocket connection
    initializeWebSocket();

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
});

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);
    wsReady = false; // Reset ready state

    ws.onopen = () => {
        wsReady = true; // Mark as ready
        // Get username and user type from localStorage
        username = localStorage.getItem('username');
        userType = localStorage.getItem('userType') || 'guest';

        // Join lobby with user type information
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'join_lobby',
                username: username,
                userType: userType
            }));
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch(data.type) {
            case 'player_list':
                updatePlayerList(data.players);
                break;
            case 'match_found':
                // Show match found state before redirect
                showMatchFound(data.matchData);
                break;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsReady = false;
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        wsReady = false;
        setTimeout(initializeWebSocket, 5000);
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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updatePlayerList(players) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = players
        .map(player => {
            const safeUsername = escapeHtml(player.username);
            const isGuest = player.userType === 'guest';
            return `
            <div class="player-item ${isGuest ? 'guest-player' : 'registered-player'}">
                ${safeUsername}${isGuest ? ' (Guest)' : ''}
            </div>
        `;
        })
        .join('');
}

async function leaveLobby() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        safeSend({
            type: 'leave_lobby',
            username: username,
            userType: userType
        });
    }

    // Check if user is logged in (has a token)
    const token = localStorage.getItem('token');
    if (token && userType === 'registered') {
        // Logged-in user: go to game mode selection page
        window.location.href = 'game-mode.html';
    } else {
        // Guest user or logged out user: go to welcome page
        if (token) {
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                localStorage.removeItem('userType');
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminUsername');
                localStorage.removeItem('adminRole');
                localStorage.removeItem('boardTheme');
                localStorage.removeItem('singlePlayerTheme');
            } catch (error) {
                console.error('Logout error:', error);
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                localStorage.removeItem('userType');
                localStorage.removeItem('boardTheme');
                localStorage.removeItem('singlePlayerTheme');
            }
        }

        // Prevent navigation back to this page
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
    }
}

function findMatch() {
    if (userType === 'guest') {
        alert('Guests cannot join multiplayer matches. Please register an account to play.');
        return;
    }

    if (!isSearchingMatch) {
        isSearchingMatch = true;
        showMatchmakingOverlay();

        // Send matchmaking request
        safeSend({
            type: 'find_match',
            username: username,
            userType: userType
        });

    } else {
        isSearchingMatch = false;
        hideMatchmakingOverlay();

        // Cancel matchmaking request
        safeSend({
            type: 'cancel_match',
            username: username
        });
    }
}

// ═══════════════════════════════════════════════════════
// MATCHMAKING OVERLAY SYSTEM
// ═══════════════════════════════════════════════════════

function showMatchmakingOverlay() {
    const overlay = document.getElementById('matchmakingOverlay');
    overlay.classList.remove('hidden');

    // Set your name
    const yourName = document.getElementById('yourName');
    yourName.textContent = escapeHtml(username || 'YOU');

    // Reset opponent slot
    const opponentFrame = document.querySelector('.slot-opponent .slot-frame');
    opponentFrame.classList.add('scanning');
    opponentFrame.classList.remove('found');
    document.getElementById('opponentAvatar').textContent = '?';
    document.getElementById('opponentName').textContent = 'SCANNING...';
    document.getElementById('opponentStatus').textContent = 'SEARCHING';
    document.getElementById('opponentStatus').className = 'slot-status searching';
    document.getElementById('opponentBlip').classList.add('hidden');
    document.getElementById('opponentBlip').classList.remove('found');

    // Start animations
    startWaveform();
    startStatusCycle();
}

function hideMatchmakingOverlay() {
    const overlay = document.getElementById('matchmakingOverlay');
    overlay.classList.add('hidden');
    stopWaveform();
    stopStatusCycle();
}

function showMatchFound(matchData) {
    // Show opponent found on scanner
    const blip = document.getElementById('opponentBlip');
    blip.classList.remove('hidden');
    blip.classList.add('found');

    // Position blip on the scanner (random angle, 60px from center)
    const angle = Math.random() * Math.PI * 2;
    const dist = 60;
    blip.style.top = `calc(50% + ${Math.sin(angle) * dist}px)`;
    blip.style.left = `calc(50% + ${Math.cos(angle) * dist}px)`;
    blip.style.transform = 'translate(-50%, -50%)';

    // Update status text
    const statusText = document.getElementById('matchStatusText');
    statusText.textContent = 'OPPONENT LOCKED';
    statusText.style.color = '#00ff88';

    // Update opponent slot
    const opponentFrame = document.querySelector('.slot-opponent .slot-frame');
    opponentFrame.classList.remove('scanning');
    opponentFrame.classList.add('found');

    // Remove scan line
    const scanLine = opponentFrame.querySelector('.slot-scan-line');
    if (scanLine) scanLine.style.display = 'none';

    // Get opponent name from match data
    const opponent = matchData.player1 === username ? matchData.player2 : matchData.player1;
    document.getElementById('opponentAvatar').textContent = '♟';
    document.getElementById('opponentName').textContent = escapeHtml(opponent || 'OPPONENT');
    document.getElementById('opponentStatus').textContent = 'MATCHED';
    document.getElementById('opponentStatus').className = 'slot-status matched';

    // Stop the status bar animation
    const bar = document.getElementById('matchStatusBar');
    bar.style.animation = 'none';
    bar.style.width = '100%';
    bar.style.background = 'linear-gradient(90deg, #00ff88, #0ff)';

    // Redirect after dramatic pause
    setTimeout(() => {
        localStorage.setItem('matchData', JSON.stringify(matchData));
        window.location.href = 'game-room.html';
    }, 1800);
}

// ── Waveform Visualizer ──
function startWaveform() {
    const canvas = document.getElementById('waveformCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    let phase = 0;

    function draw() {
        ctx.clearRect(0, 0, W, H);

        // Draw grid lines
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let y = 0; y < H; y += 15) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        // Draw main waveform
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';

        for (let x = 0; x < W; x++) {
            const t = x / W;
            const y = H / 2
                + Math.sin(t * 8 + phase) * 12
                + Math.sin(t * 15 + phase * 1.3) * 6
                + Math.sin(t * 25 + phase * 0.7) * 3
                + (Math.random() - 0.5) * 2;

            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw secondary waveform (pink)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 0, 128, 0.3)';
        ctx.lineWidth = 1;

        for (let x = 0; x < W; x++) {
            const t = x / W;
            const y = H / 2
                + Math.sin(t * 6 + phase * 0.8) * 8
                + Math.cos(t * 12 + phase * 1.5) * 4;

            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw center line
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        phase += 0.06;
        waveformAnimId = requestAnimationFrame(draw);
    }

    draw();
}

function stopWaveform() {
    if (waveformAnimId) {
        cancelAnimationFrame(waveformAnimId);
        waveformAnimId = null;
    }
}

// ── Status Text Cycle ──
const statusMessages = [
    'Scanning player network...',
    'Probing player matrix...',
    'Analyzing skill vectors...',
    'Querying battle servers...',
    'Matching combat signatures...',
    'Decrypting opponent data...',
    'Synchronizing game nodes...',
    'Calibrating matchmaker...',
    'Searching active players...',
    'Establishing secure link...'
];

let statusIndex = 0;

function startStatusCycle() {
    statusIndex = 0;
    updateStatusText();
    statusCycleInterval = setInterval(() => {
        statusIndex = (statusIndex + 1) % statusMessages.length;
        updateStatusText();
    }, 2500);
}

function stopStatusCycle() {
    if (statusCycleInterval) {
        clearInterval(statusCycleInterval);
        statusCycleInterval = null;
    }
}

function updateStatusText() {
    const el = document.getElementById('matchStatusText');
    if (!el) return;

    // Glitch-out effect
    el.style.opacity = '0';
    el.style.transform = 'translateY(5px)';
    setTimeout(() => {
        el.textContent = statusMessages[statusIndex];
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    }, 150);
}

// Clean up when leaving
window.addEventListener('beforeunload', () => {
    stopWaveform();
    stopStatusCycle();
    if (ws && ws.readyState === WebSocket.OPEN) {
        safeSend({
            type: 'leave_lobby',
            username: username,
            userType: userType
        });
    }
});
