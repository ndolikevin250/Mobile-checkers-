let ws;
let token;
let myUsername;
let currentTab = 'friends';
let contextTarget = null;
let searchTimeout = null;

document.addEventListener('DOMContentLoaded', function() {
    token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (!token || userType !== 'registered') {
        window.location.href = 'game-mode.html';
        return;
    }

    myUsername = localStorage.getItem('username');
    connectWebSocket();
    loadFriends();
    loadPending();
    loadCounts();

    // Search input handler
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', function() {
        const q = this.value.trim();
        document.getElementById('searchClear').classList.toggle('hidden', q.length === 0);

        clearTimeout(searchTimeout);
        if (q.length < 2) {
            document.getElementById('searchResults').innerHTML =
                '<div class="empty-state small"><div class="empty-text">Type a username to search</div></div>';
            return;
        }

        searchTimeout = setTimeout(() => searchUsers(q), 300);
    });

    // Close context menu on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeContextMenu();
    });
});

// ═══════════════════════════════════════════════════════
// WEBSOCKET — Real-time updates
// ═══════════════════════════════════════════════════════

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'register_presence',
            username: myUsername,
            userType: 'registered'
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'friend_status':
                handleFriendStatusChange(data.username, data.status);
                break;
            case 'friend_request':
                showToast(`${escapeHtml(data.from)} sent you a friend request`);
                loadPending();
                loadCounts();
                break;
            case 'friend_accepted':
                showToast(`${escapeHtml(data.username)} accepted your friend request`);
                loadFriends();
                loadPending();
                loadCounts();
                break;
            case 'friend_removed':
                loadFriends();
                loadCounts();
                break;
        }
    };

    ws.onclose = () => {
        setTimeout(connectWebSocket, 3000);
    };
}

function handleFriendStatusChange(username, status) {
    // Update the friend's status dot in the list without full reload
    const items = document.querySelectorAll('.friend-item');
    for (const item of items) {
        if (item.dataset.username === username) {
            const dot = item.querySelector('.status-dot');
            const statusText = item.querySelector('.friend-status-text');
            if (dot) {
                dot.className = 'status-dot ' + status;
            }
            if (statusText) {
                statusText.textContent = status === 'online' ? 'Online' : 'Offline';
                statusText.className = 'friend-status-text ' + (status === 'online' ? 'online' : '');
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════

function switchTab(tab) {
    currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById('panel-' + tab).classList.add('active');

    // Focus search input when switching to search tab
    if (tab === 'search') {
        setTimeout(() => document.getElementById('searchInput').focus(), 100);
    }
}

// ═══════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════

async function loadFriends() {
    try {
        const res = await fetch('/api/friends/list', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('friendCount').textContent = data.count;
        renderFriendList(data.friends);
    } catch (err) {
        console.error('Error loading friends:', err);
    }
}

async function loadPending() {
    try {
        const res = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Update badge
        const badge = document.getElementById('requestBadge');
        if (data.incomingCount > 0) {
            badge.textContent = data.incomingCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        renderIncoming(data.incoming);
        renderOutgoing(data.outgoing);
    } catch (err) {
        console.error('Error loading pending:', err);
    }
}

async function loadCounts() {
    try {
        const res = await fetch('/api/friends/counts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('friendCount').textContent = data.friendCount;
    } catch (err) {
        console.error('Error loading counts:', err);
    }
}

// ═══════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════

function renderFriendList(friends) {
    const container = document.getElementById('friendList');

    if (!friends || friends.length === 0) {
        container.innerHTML = `
            <div class="empty-state" id="emptyFriends">
                <div class="empty-icon">♟</div>
                <div class="empty-text">No friends yet</div>
                <div class="empty-hint">Search for players to add as friends</div>
                <button class="empty-action" onclick="switchTab('search')">Find Players</button>
            </div>`;
        return;
    }

    const onlineFriends = friends.filter(f => f.online);
    const offlineFriends = friends.filter(f => !f.online);

    let html = '';

    if (onlineFriends.length > 0) {
        html += `<div class="online-header"><div class="dot"></div><span>Online — ${onlineFriends.length}</span></div>`;
        html += onlineFriends.map(f => friendItemHTML(f)).join('');
    }

    if (offlineFriends.length > 0) {
        html += `<div class="online-header" style="margin-top:${onlineFriends.length ? '12px' : '0'}"><div class="dot offline-dot"></div><span>Offline — ${offlineFriends.length}</span></div>`;
        html += offlineFriends.map(f => friendItemHTML(f)).join('');
    }

    container.innerHTML = html;
}

function friendItemHTML(friend) {
    const safe = escapeHtml(friend.username);
    const statusClass = friend.online ? 'online' : 'offline';
    const statusText = friend.online ? 'Online' : 'Offline';
    const initial = friend.username.charAt(0).toUpperCase();

    return `
        <div class="friend-item" data-username="${safe}" onclick="showFriendContext(event, '${safe}')">
            <div class="friend-avatar">
                ${initial}
                <div class="status-dot ${statusClass}"></div>
            </div>
            <div class="friend-info">
                <div class="friend-name">${safe}</div>
                <div class="friend-status-text ${statusClass}">${statusText}</div>
            </div>
            <button class="friend-options-btn" onclick="event.stopPropagation(); showFriendContext(event, '${safe}')">⋯</button>
        </div>`;
}

function renderIncoming(requests) {
    const container = document.getElementById('incomingList');

    if (!requests || requests.length === 0) {
        container.innerHTML = '<div class="empty-state small"><div class="empty-text">No incoming requests</div></div>';
        return;
    }

    container.innerHTML = requests.map(r => {
        const safe = escapeHtml(r.username);
        const time = timeAgo(r.sentAt);
        const initial = r.username.charAt(0).toUpperCase();
        return `
            <div class="request-item">
                <div class="friend-avatar">
                    ${initial}
                    <div class="status-dot ${r.online ? 'online' : 'offline'}"></div>
                </div>
                <div class="request-info">
                    <div class="request-name">${safe}</div>
                    <div class="request-time">${time}</div>
                </div>
                <div class="request-actions">
                    <button class="req-btn accept" onclick="acceptRequest('${safe}')">Accept</button>
                    <button class="req-btn decline" onclick="rejectRequest('${safe}')">Decline</button>
                </div>
            </div>`;
    }).join('');
}

function renderOutgoing(requests) {
    const container = document.getElementById('outgoingList');

    if (!requests || requests.length === 0) {
        container.innerHTML = '<div class="empty-state small"><div class="empty-text">No sent requests</div></div>';
        return;
    }

    container.innerHTML = requests.map(r => {
        const safe = escapeHtml(r.username);
        const time = timeAgo(r.sentAt);
        const initial = r.username.charAt(0).toUpperCase();
        return `
            <div class="request-item">
                <div class="friend-avatar">
                    ${initial}
                    <div class="status-dot ${r.online ? 'online' : 'offline'}"></div>
                </div>
                <div class="request-info">
                    <div class="request-name">${safe}</div>
                    <div class="request-time">Sent ${time}</div>
                </div>
                <div class="request-actions">
                    <button class="req-btn pending-tag">Pending</button>
                </div>
            </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════

async function searchUsers(query) {
    try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById('searchResults');

        if (!data.users || data.users.length === 0) {
            container.innerHTML = '<div class="empty-state small"><div class="empty-text">No players found</div></div>';
            return;
        }

        container.innerHTML = data.users.map(u => {
            const safe = escapeHtml(u.username);
            const initial = u.username.charAt(0).toUpperCase();

            let btnHtml;
            if (u.friendship) {
                if (u.friendship.status === 'accepted') {
                    btnHtml = '<button class="add-btn friends" disabled>Friends</button>';
                } else if (u.friendship.status === 'pending') {
                    if (u.friendship.isSender) {
                        btnHtml = '<button class="add-btn sent" disabled>Sent</button>';
                    } else {
                        btnHtml = `<button class="add-btn" onclick="event.stopPropagation(); acceptRequest('${safe}')">Accept</button>`;
                    }
                } else if (u.friendship.status === 'blocked') {
                    btnHtml = '<button class="add-btn" disabled>Blocked</button>';
                }
            } else {
                btnHtml = `<button class="add-btn" onclick="event.stopPropagation(); sendRequest('${safe}', this)">Add</button>`;
            }

            return `
                <div class="search-item">
                    <div class="friend-avatar">
                        ${initial}
                        <div class="status-dot ${u.online ? 'online' : 'offline'}"></div>
                    </div>
                    <div class="search-user-info">
                        <div class="search-username">${safe}</div>
                        ${u.online ? '<div class="search-online">Online now</div>' : ''}
                    </div>
                    ${btnHtml}
                </div>`;
        }).join('');
    } catch (err) {
        console.error('Search error:', err);
    }
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.add('hidden');
    document.getElementById('searchResults').innerHTML =
        '<div class="empty-state small"><div class="empty-text">Type a username to search</div></div>';
}

// ═══════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════

async function sendRequest(username, btn) {
    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }

        const res = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipient: username })
        });

        const data = await res.json();

        if (res.ok) {
            if (data.status === 'accepted') {
                showToast(`You and ${username} are now friends!`);
                if (btn) { btn.textContent = 'Friends'; btn.className = 'add-btn friends'; }
                loadFriends();
            } else {
                showToast(`Friend request sent to ${username}`);
                if (btn) { btn.textContent = 'Sent'; btn.className = 'add-btn sent'; }
            }
            loadPending();
            loadCounts();
        } else {
            showToast(data.message || 'Error sending request');
            if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
        }
    } catch (err) {
        console.error('Send request error:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Add'; }
    }
}

async function acceptRequest(username) {
    try {
        const res = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requester: username })
        });

        if (res.ok) {
            showToast(`You and ${username} are now friends!`);
            loadFriends();
            loadPending();
            loadCounts();
        } else {
            const data = await res.json();
            showToast(data.message || 'Error accepting request');
        }
    } catch (err) {
        console.error('Accept error:', err);
    }
}

async function rejectRequest(username) {
    try {
        const res = await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requester: username })
        });

        if (res.ok) {
            showToast('Request declined');
            loadPending();
            loadCounts();
        }
    } catch (err) {
        console.error('Reject error:', err);
    }
}

async function removeFriend() {
    if (!contextTarget) return;
    closeContextMenu();

    try {
        const res = await fetch('/api/friends/remove', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friend: contextTarget })
        });

        if (res.ok) {
            showToast(`${contextTarget} removed from friends`);
            loadFriends();
            loadCounts();
        }
    } catch (err) {
        console.error('Remove error:', err);
    }
}

async function blockUser() {
    if (!contextTarget) return;
    closeContextMenu();

    try {
        const res = await fetch('/api/friends/block', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: contextTarget })
        });

        if (res.ok) {
            showToast(`${contextTarget} has been blocked`);
            loadFriends();
            loadCounts();
        }
    } catch (err) {
        console.error('Block error:', err);
    }
}

function challengeFriend() {
    if (!contextTarget) return;
    closeContextMenu();
    // Store challenge target and redirect to lobby
    localStorage.setItem('challengeTarget', contextTarget);
    window.location.href = 'lobby.html';
}

function viewFriendStats() {
    closeContextMenu();
    showToast('Friend stats coming soon');
}

// ═══════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════

function showFriendContext(event, username) {
    event.preventDefault();
    event.stopPropagation();
    contextTarget = username;

    const menu = document.getElementById('contextMenu');
    const overlay = document.getElementById('contextOverlay');

    // Position menu near the click/tap
    const x = Math.min(event.clientX || event.touches?.[0]?.clientX || 200, window.innerWidth - 220);
    const y = Math.min(event.clientY || event.touches?.[0]?.clientY || 300, window.innerHeight - 200);

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
    overlay.classList.remove('hidden');
}

function closeContextMenu() {
    document.getElementById('contextMenu').classList.add('hidden');
    document.getElementById('contextOverlay').classList.add('hidden');
    contextTarget = null;
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function goBack() {
    window.location.href = 'game-mode.html';
}

// Clean up WebSocket on leave
window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
});
