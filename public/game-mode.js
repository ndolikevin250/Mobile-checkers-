let hubWs = null;

// Check if user is logged in when page loads
document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    // Allow registered users OR guests
    const isRegistered = (token && userType === 'registered');
    const isGuest = (userType === 'guest');

    if (!isRegistered && !isGuest) {
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
        return;
    }

    // Populate user info
    const username = localStorage.getItem('username') || 'PLAYER';
    document.getElementById('userName').textContent = username.toUpperCase();

    if (isGuest) {
        // Guest mode: hide hub features, stats, and rank
        document.getElementById('userRank').textContent = 'GUEST';
        document.getElementById('hubSection').style.display = 'none';
        document.getElementById('hubTitle').style.display = 'none';
        document.getElementById('quickStats').style.display = 'none';
        document.getElementById('friendsHeaderBtn').style.display = 'none';

        // Hide LIVE badge on multiplayer (guests can't play multiplayer)
        const liveBadge = document.querySelector('.live-badge');
        if (liveBadge) liveBadge.style.display = 'none';
    } else {
        // Registered user: load dashboard stats + friend counts + connect presence
        loadDashboardStats();
        loadFriendCounts();
        connectPresence();
    }

    // Handle visibility change to check if user came back via navigation
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            const currentToken = localStorage.getItem('token');
            const currentUserType = localStorage.getItem('userType');
            const stillValid = (currentToken && currentUserType === 'registered') || currentUserType === 'guest';
            if (!stillValid) {
                history.replaceState(null, null, 'index.html');
                window.location.href = 'index.html';
            }
        }
    });
});

// WebSocket presence — so friends see this user as online
function connectPresence() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    hubWs = new WebSocket(`${protocol}//${window.location.host}`);

    hubWs.onopen = () => {
        hubWs.send(JSON.stringify({
            type: 'register_presence',
            username: localStorage.getItem('username'),
            userType: 'registered'
        }));
    };

    hubWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'friend_request') {
                // Update the friend notification dot and badge
                const notifDot = document.getElementById('friendNotif');
                if (notifDot) notifDot.classList.add('active');
                loadFriendCounts();
            }
        } catch (e) { /* ignore */ }
    };

    hubWs.onclose = () => {
        // Reconnect only if still on this page
        setTimeout(() => {
            if (document.visibilityState !== 'hidden') {
                connectPresence();
            }
        }, 5000);
    };
}

async function loadFriendCounts() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const res = await fetch('/api/friends/counts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Update friends badge in hub
        const badge = document.getElementById('friendsBadge');
        if (badge) {
            if (data.pendingCount > 0) {
                badge.textContent = data.pendingCount;
                badge.classList.add('active');
            } else {
                badge.classList.remove('active');
            }
        }

        // Update header notification dot
        const notifDot = document.getElementById('friendNotif');
        if (notifDot) {
            if (data.pendingCount > 0) {
                notifDot.classList.add('active');
            } else {
                notifDot.classList.remove('active');
            }
        }
    } catch (err) {
        console.error('Error loading friend counts:', err);
    }
}

async function loadDashboardStats() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const res = await fetch('/api/user/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            const stats = data.stats;

            if (stats) {
                const wins = stats.wins || 0;
                const losses = stats.losses || 0;
                const totalGames = stats.totalGames || 0;
                const winRate = stats.winRate || 0;

                document.getElementById('statWins').textContent = wins;
                document.getElementById('statLosses').textContent = losses;
                document.getElementById('statGames').textContent = totalGames;
                document.getElementById('statElo').textContent = winRate + '%';

                // Update rank based on win count
                const rankEl = document.getElementById('userRank');
                if (wins >= 100) rankEl.textContent = 'GRANDMASTER';
                else if (wins >= 50) rankEl.textContent = 'MASTER';
                else if (wins >= 25) rankEl.textContent = 'EXPERT';
                else if (wins >= 10) rankEl.textContent = 'VETERAN';
                else if (wins >= 3) rankEl.textContent = 'SOLDIER';
                else rankEl.textContent = 'ROOKIE';
            }
        }
    } catch (error) {
        console.error('Failed to load dashboard stats:', error);
    }
}

function selectGameMode(mode) {
    const userType = localStorage.getItem('userType');

    if (mode === 'single') {
        window.location.href = 'single-player.html';
    } else if (mode === 'multiplayer') {
        if (userType === 'guest') {
            alert('Guests cannot play multiplayer. Please register an account.');
            return;
        }
        window.location.href = 'lobby.html';
    } else if (mode === 'tournament') {
        if (userType === 'guest') {
            alert('Guests cannot join tournaments. Please register an account.');
            return;
        }
        window.location.href = 'tournament/index.html';
    }
}

function navigate(section) {
    if (section === 'friends') {
        window.location.href = 'friends.html';
    } else if (section === 'stats') {
        window.location.href = 'statistics.html';
    }
}

async function goBackToWelcome() {
    const userType = localStorage.getItem('userType');
    const adminToken = localStorage.getItem('adminToken');

    if (hubWs) hubWs.close();

    if (adminToken) {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userType');
        window.location.href = 'admin-dashboard.html';
    } else if (userType === 'guest') {
        localStorage.removeItem('username');
        localStorage.removeItem('userType');
        localStorage.removeItem('boardTheme');
        localStorage.removeItem('singlePlayerTheme');
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
    } else {
        const token = localStorage.getItem('token');
        if (token) {
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
            }
        }

        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('userType');
        history.replaceState(null, null, 'index.html');
        window.location.href = 'index.html';
    }
}

window.addEventListener('beforeunload', () => {
    if (hubWs) hubWs.close();
});
