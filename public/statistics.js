document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('token');
    const userType = localStorage.getItem('userType');

    if (!token || userType !== 'registered') {
        history.replaceState(null, null, 'game-mode.html');
        window.location.href = 'game-mode.html';
        return;
    }

    const username = localStorage.getItem('username') || 'PLAYER';
    document.getElementById('playerName').textContent = username.toUpperCase();

    loadStats();
});

async function loadStats() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const res = await fetch('/api/user/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;
        const data = await res.json();
        const stats = data.stats;
        if (!stats) return;

        const wins = stats.wins || 0;
        const losses = stats.losses || 0;
        const draws = stats.draws || 0;
        const totalGames = stats.totalGames || 0;
        const winRate = stats.winRate || 0;

        // Core stats
        document.getElementById('totalWins').textContent = wins;
        document.getElementById('totalLosses').textContent = losses;
        document.getElementById('totalDraws').textContent = draws;
        document.getElementById('totalGames').textContent = totalGames;

        // Win rate ring
        document.getElementById('winRateValue').textContent = winRate + '%';
        const circumference = 213.6; // 2 * PI * 34
        const offset = circumference - (circumference * winRate / 100);
        setTimeout(() => {
            document.getElementById('winRateRing').style.strokeDashoffset = offset;
        }, 200);

        // Stat bars (proportional to total)
        if (totalGames > 0) {
            setTimeout(() => {
                document.getElementById('winsBar').style.width = (wins / totalGames * 100) + '%';
                document.getElementById('lossesBar').style.width = (losses / totalGames * 100) + '%';
                document.getElementById('drawsBar').style.width = (draws / totalGames * 100) + '%';
                document.getElementById('gamesBar').style.width = '100%';
            }, 100);
        }

        // Rank
        const rankEl = document.getElementById('playerRank');
        if (wins >= 100) rankEl.textContent = 'GRANDMASTER';
        else if (wins >= 50) rankEl.textContent = 'MASTER';
        else if (wins >= 25) rankEl.textContent = 'EXPERT';
        else if (wins >= 10) rankEl.textContent = 'VETERAN';
        else if (wins >= 3) rankEl.textContent = 'SOLDIER';
        else rankEl.textContent = 'ROOKIE';

        // Detail cards
        const playTime = stats.totalPlayTime || 0;
        if (playTime >= 60) {
            document.getElementById('totalPlayTime').textContent = Math.floor(playTime / 60) + 'h ' + (playTime % 60) + 'm';
        } else {
            document.getElementById('totalPlayTime').textContent = playTime + 'm';
        }

        document.getElementById('favDifficulty').textContent = stats.favoriteDifficulty || 'Medium';

        if (stats.lastPlayed) {
            const d = new Date(stats.lastPlayed);
            const now = new Date();
            const diffMs = now - d;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) document.getElementById('lastPlayed').textContent = 'Today';
            else if (diffDays === 1) document.getElementById('lastPlayed').textContent = 'Yesterday';
            else if (diffDays < 7) document.getElementById('lastPlayed').textContent = diffDays + 'd ago';
            else document.getElementById('lastPlayed').textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        // Compute difficulty breakdown + win streak from game history
        const history = stats.gameHistory || [];

        const diffStats = { easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 } };
        let bestStreak = 0;
        let currentStreak = 0;

        history.forEach(game => {
            const diff = (game.difficulty || 'medium').toLowerCase();
            if (diffStats[diff]) {
                if (game.result === 'win') diffStats[diff].w++;
                else if (game.result === 'loss') diffStats[diff].l++;
            }

            if (game.result === 'win') {
                currentStreak++;
                if (currentStreak > bestStreak) bestStreak = currentStreak;
            } else {
                currentStreak = 0;
            }
        });

        document.getElementById('winStreak').textContent = bestStreak;

        // Difficulty bars and records
        const maxDiffGames = Math.max(
            diffStats.easy.w + diffStats.easy.l,
            diffStats.medium.w + diffStats.medium.l,
            diffStats.hard.w + diffStats.hard.l,
            1
        );

        ['easy', 'medium', 'hard'].forEach(diff => {
            const total = diffStats[diff].w + diffStats[diff].l;
            const winPct = total > 0 ? (diffStats[diff].w / total * 100) : 0;
            document.getElementById(diff + 'Record').textContent = diffStats[diff].w + '-' + diffStats[diff].l;
            setTimeout(() => {
                document.getElementById(diff + 'Bar').style.width = winPct + '%';
            }, 300);
        });

        // Recent games (last 10, newest first)
        const recentContainer = document.getElementById('recentGames');
        const recent = history.slice(-10).reverse();

        if (recent.length > 0) {
            recentContainer.innerHTML = recent.map(game => {
                const resultClass = game.result || 'draw';
                const resultLabel = resultClass === 'win' ? 'WIN' : resultClass === 'loss' ? 'LOSS' : 'DRAW';
                const opponent = escapeHtml(game.opponent || 'AI');
                const difficulty = game.difficulty || '';
                const duration = game.duration ? formatDuration(game.duration) : '';
                const meta = [difficulty, duration].filter(Boolean).join(' · ');
                const date = game.date ? formatDate(new Date(game.date)) : '';

                return `
                    <div class="game-entry ${resultClass}">
                        <div class="game-result-badge">${resultLabel}</div>
                        <div class="game-details">
                            <div class="game-opponent">vs ${opponent}</div>
                            <div class="game-meta">${meta}</div>
                        </div>
                        <div class="game-date">${date}</div>
                    </div>
                `;
            }).join('');
        }

    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

function formatDuration(seconds) {
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
}

function formatDate(d) {
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function goBack() {
    window.location.href = 'game-mode.html';
}
