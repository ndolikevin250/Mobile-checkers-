const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── CONSTANTS & HELPERS ────────────────────────────────────────────
const BOARD_SIZE = 8;
const EMPTY = 0, P1 = 1, P2 = 2, P1K = 3, P2K = 4;

const AVATARS = ["♔","♕","♖","♗","♘","♙","⚔","🏆","👑","💎","🔥","⚡","🎯","🛡","🗡","💀"];

function initBoard() {
  const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(EMPTY));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if ((r + c) % 2 === 1) board[r][c] = P2;
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if ((r + c) % 2 === 1) board[r][c] = P1;
  return board;
}

function cloneBoard(b) { return b.map(r => [...r]); }

function isP1(p) { return p === P1 || p === P1K; }
function isP2(p) { return p === P2 || p === P2K; }
function isKing(p) { return p === P1K || p === P2K; }

function getValidMoves(board, row, col) {
  const piece = board[row][col];
  if (piece === EMPTY) return [];
  const moves = [];
  const jumps = [];
  const dirs = [];
  if (isP1(piece) || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (isP2(piece) || isKing(piece)) dirs.push([1, -1], [1, 1]);

  for (const [dr, dc] of dirs) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      if (board[nr][nc] === EMPTY) {
        moves.push({ row: nr, col: nc, jump: false });
      } else {
        const enemy = isP1(piece) ? isP2(board[nr][nc]) : isP1(board[nr][nc]);
        if (enemy) {
          const jr = nr + dr, jc = nc + dc;
          if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && board[jr][jc] === EMPTY) {
            jumps.push({ row: jr, col: jc, jump: true, capturedRow: nr, capturedCol: nc });
          }
        }
      }
    }
  }
  return jumps.length > 0 ? jumps : moves;
}

function getAllMoves(board, isPlayer1) {
  const allJumps = [];
  const allMoves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if ((isPlayer1 && isP1(p)) || (!isPlayer1 && isP2(p))) {
        const moves = getValidMoves(board, r, c);
        for (const m of moves) {
          const entry = { fromRow: r, fromCol: c, ...m };
          if (m.jump) allJumps.push(entry);
          else allMoves.push(entry);
        }
      }
    }
  }
  return allJumps.length > 0 ? allJumps : allMoves;
}

function countPieces(board, isPlayer1) {
  let count = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((isPlayer1 && isP1(board[r][c])) || (!isPlayer1 && isP2(board[r][c]))) count++;
  return count;
}

// Get WebSocket URL (same host as page, or localhost for dev)
function getWsUrl() {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}`;
}

// ─── STYLES ─────────────────────────────────────────────────────────
const S = {
  // Colors
  bg: "#0a0a0f",
  bg2: "#12121a",
  bg3: "#1a1a28",
  gold: "#d4a53c",
  goldLight: "#f0d078",
  goldDark: "#a07820",
  emerald: "#1a6b4a",
  emeraldDark: "#0d3a28",
  emeraldLight: "#28a06a",
  red: "#c0392b",
  redLight: "#e74c3c",
  white: "#f0ece4",
  gray: "#6a6a7a",
  grayLight: "#9a9aaa",
};

const keyframes = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap');

@keyframes pulse-gold {
  0%, 100% { box-shadow: 0 0 20px rgba(212,165,60,0.3), 0 0 60px rgba(212,165,60,0.1); }
  50% { box-shadow: 0 0 40px rgba(212,165,60,0.6), 0 0 100px rgba(212,165,60,0.2); }
}

@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes spin-reverse {
  from { transform: rotate(360deg); }
  to { transform: rotate(0deg); }
}

@keyframes float-up {
  0% { opacity: 0; transform: translateY(30px) scale(0.9); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes slide-in-left {
  0% { opacity: 0; transform: translateX(-60px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes slide-in-right {
  0% { opacity: 0; transform: translateX(60px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes radar-sweep {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes ripple {
  0% { transform: scale(1); opacity: 0.4; }
  100% { transform: scale(3); opacity: 0; }
}

@keyframes shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}

@keyframes crown-bounce {
  0%, 100% { transform: translateY(0) rotate(-5deg); }
  50% { transform: translateY(-15px) rotate(5deg); }
}

@keyframes confetti-fall {
  0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; }
  100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
}

@keyframes glow-border {
  0%, 100% { border-color: rgba(212,165,60,0.3); }
  50% { border-color: rgba(212,165,60,0.8); }
}

@keyframes board-appear {
  0% { opacity: 0; transform: perspective(800px) rotateX(15deg) scale(0.8); }
  100% { opacity: 1; transform: perspective(800px) rotateX(0) scale(1); }
}

@keyframes piece-place {
  0% { transform: scale(0) rotate(180deg); }
  60% { transform: scale(1.2) rotate(-10deg); }
  100% { transform: scale(1) rotate(0); }
}

@keyframes vs-flash {
  0% { transform: scale(0.5); opacity: 0; text-shadow: 0 0 0px #d4a53c; }
  50% { transform: scale(1.3); opacity: 1; text-shadow: 0 0 40px #d4a53c; }
  100% { transform: scale(1); opacity: 1; text-shadow: 0 0 15px #d4a53c; }
}

@keyframes match-line {
  0% { stroke-dashoffset: 200; }
  100% { stroke-dashoffset: 0; }
}

@keyframes bg-pan {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
`;

// ─── SUB-COMPONENTS ─────────────────────────────────────────────────

function ParticleField() {
  const particles = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 8,
      size: 2 + Math.random() * 3,
      opacity: 0.1 + Math.random() * 0.3,
    })), []);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: `${p.left}%`,
          bottom: "-10px",
          width: p.size,
          height: p.size,
          borderRadius: "50%",
          background: S.gold,
          opacity: p.opacity,
          animation: `confetti-fall ${p.duration}s linear ${p.delay}s infinite reverse`,
        }} />
      ))}
    </div>
  );
}

function PlayerCard({ player, size = "md", highlight = false, winner = false, eliminated = false, delay = 0, isYou = false }) {
  const sizes = {
    sm: { w: 100, avatar: 28, nameSize: 11, eloSize: 9 },
    md: { w: 140, avatar: 44, nameSize: 13, eloSize: 10 },
    lg: { w: 180, avatar: 60, nameSize: 16, eloSize: 12 },
  };
  const s = sizes[size];

  return (
    <div style={{
      width: s.w,
      padding: size === "sm" ? "8px" : "12px 14px",
      background: eliminated ? "rgba(60,30,30,0.4)" : winner ? "linear-gradient(135deg, rgba(212,165,60,0.15), rgba(40,160,106,0.1))" : "rgba(26,26,40,0.8)",
      border: `1.5px solid ${winner ? S.gold : highlight ? "rgba(212,165,60,0.5)" : eliminated ? "rgba(192,57,43,0.3)" : isYou ? "rgba(40,160,106,0.5)" : "rgba(100,100,130,0.2)"}`,
      borderRadius: 12,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      animation: `float-up 0.6s ease ${delay}s both`,
      transition: "all 0.3s ease",
      opacity: eliminated ? 0.5 : 1,
      position: "relative",
      overflow: "hidden",
      backdropFilter: "blur(10px)",
    }}>
      {winner && (
        <div style={{
          position: "absolute", top: -2, left: "50%", transform: "translateX(-50%)",
          fontSize: 18, animation: "crown-bounce 2s ease infinite",
        }}>👑</div>
      )}
      <div style={{
        width: s.avatar, height: s.avatar, borderRadius: "50%",
        background: `linear-gradient(135deg, ${S.emeraldDark}, ${S.bg3})`,
        border: `2px solid ${winner ? S.gold : highlight ? S.goldDark : isYou ? S.emeraldLight : "rgba(100,100,130,0.3)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: s.avatar * 0.5,
        marginTop: winner ? 10 : 0,
        boxShadow: highlight ? `0 0 15px rgba(212,165,60,0.3)` : "none",
      }}>
        {player.avatar}
      </div>
      <div style={{
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 600,
        fontSize: s.nameSize,
        color: winner ? S.goldLight : eliminated ? S.gray : S.white,
        textAlign: "center",
        letterSpacing: "0.5px",
      }}>
        {player.name}{isYou ? " (You)" : ""}
      </div>
      <div style={{
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: s.eloSize,
        color: S.gray,
        background: "rgba(255,255,255,0.05)",
        padding: "1px 8px",
        borderRadius: 6,
      }}>
        ELO {player.elo}
      </div>
    </div>
  );
}

function MatchupVS({ delay = 0 }) {
  return (
    <div style={{
      fontFamily: "'Cinzel', serif",
      fontSize: 22,
      fontWeight: 900,
      color: S.gold,
      textShadow: `0 0 20px rgba(212,165,60,0.5)`,
      animation: `vs-flash 0.8s ease ${delay}s both`,
      padding: "0 12px",
    }}>
      VS
    </div>
  );
}

// ─── SCREENS ────────────────────────────────────────────────────────

function LobbyScreen({ onJoin, username, onUsernameChange, avatar, onAvatarChange, error }) {
  const [hovered, setHovered] = useState(false);
  const [showAvatars, setShowAvatars] = useState(false);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100%", gap: 30, padding: 40, position: "relative",
    }}>
      <ParticleField />
      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: 14, fontWeight: 400,
          color: S.gold, letterSpacing: 8, textTransform: "uppercase",
          marginBottom: 12, opacity: 0.7,
          animation: "float-up 0.8s ease both",
        }}>
          ⚔ Competitive Arena ⚔
        </div>
        <h1 style={{
          fontFamily: "'Cinzel', serif", fontSize: "clamp(32px, 6vw, 56px)", fontWeight: 900,
          color: S.white, margin: 0, lineHeight: 1.1,
          textShadow: `0 2px 20px rgba(0,0,0,0.5)`,
          animation: "float-up 0.8s ease 0.1s both",
        }}>
          CHECKERS
          <br />
          <span style={{
            background: `linear-gradient(90deg, ${S.gold}, ${S.goldLight}, ${S.gold})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundSize: "200% auto",
            animation: "shimmer 3s linear infinite",
          }}>TOURNAMENT</span>
        </h1>
        <p style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 16, color: S.grayLight,
          marginTop: 16, fontWeight: 300, letterSpacing: 1,
          animation: "float-up 0.8s ease 0.2s both",
        }}>
          4 Players · Semi-Finals & Finals · One Champion
        </p>
      </div>

      {/* Username & Avatar Entry */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        zIndex: 1, animation: "float-up 0.8s ease 0.3s both",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setShowAvatars(!showAvatars)}
            style={{
              width: 48, height: 48, borderRadius: "50%",
              background: `linear-gradient(135deg, ${S.emeraldDark}, ${S.bg3})`,
              border: `2px solid ${S.gold}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, cursor: "pointer",
              transition: "transform 0.2s",
            }}
            title="Choose avatar"
          >
            {avatar}
          </button>
          <input
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="Enter your name..."
            maxLength={16}
            style={{
              fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 500,
              color: S.white, background: "rgba(26,26,40,0.8)",
              border: `1.5px solid rgba(212,165,60,0.3)`,
              padding: "10px 16px", borderRadius: 8,
              outline: "none", width: 200,
              letterSpacing: 1,
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && username.trim()) onJoin(); }}
          />
        </div>
        {showAvatars && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center",
            maxWidth: 260, padding: 10, borderRadius: 10,
            background: "rgba(26,26,40,0.9)", border: `1px solid rgba(212,165,60,0.2)`,
          }}>
            {AVATARS.map(a => (
              <button key={a} onClick={() => { onAvatarChange(a); setShowAvatars(false); }}
                style={{
                  width: 36, height: 36, borderRadius: "50%", fontSize: 18,
                  background: avatar === a ? S.emeraldDark : "transparent",
                  border: avatar === a ? `2px solid ${S.gold}` : "1px solid rgba(100,100,130,0.2)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {a}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 13, color: S.redLight,
            padding: "4px 12px", borderRadius: 6,
            background: "rgba(192,57,43,0.15)", border: "1px solid rgba(192,57,43,0.3)",
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Decorative board */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3,
        opacity: 0.15, position: "absolute", zIndex: 0,
        width: 200, height: 200,
        animation: "spin-slow 60s linear infinite",
      }}>
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} style={{
            width: "100%", aspectRatio: "1",
            background: (Math.floor(i / 4) + i % 4) % 2 === 0 ? "transparent" : S.emeraldDark,
            borderRadius: 4,
          }} />
        ))}
      </div>

      <button
        onClick={() => { if (username.trim()) onJoin(); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={!username.trim()}
        style={{
          position: "relative", zIndex: 1,
          fontFamily: "'Cinzel', serif", fontSize: 18, fontWeight: 700,
          color: !username.trim() ? S.gray : hovered ? S.bg : S.gold,
          background: !username.trim() ? "transparent" : hovered
            ? `linear-gradient(135deg, ${S.gold}, ${S.goldLight})`
            : "transparent",
          border: `2px solid ${!username.trim() ? S.gray : S.gold}`,
          padding: "16px 48px",
          borderRadius: 8,
          cursor: username.trim() ? "pointer" : "not-allowed",
          letterSpacing: 3,
          textTransform: "uppercase",
          transition: "all 0.3s ease",
          animation: username.trim() ? "pulse-gold 2s ease infinite, float-up 0.8s ease 0.4s both" : "float-up 0.8s ease 0.4s both",
          boxShadow: hovered && username.trim() ? `0 8px 40px rgba(212,165,60,0.4)` : "none",
          opacity: !username.trim() ? 0.5 : 1,
        }}
      >
        ⚔ Join the Tournament
      </button>

      <div style={{
        display: "flex", gap: 40, marginTop: 10, zIndex: 1,
        animation: "float-up 0.8s ease 0.6s both",
      }}>
        {[["🏆", "Bracket Style"], ["⏱", "Live Matches"], ["👑", "Earn Glory"]].map(([icon, text], i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
            <div style={{
              fontFamily: "'Rajdhani', sans-serif", fontSize: 11, color: S.gray,
              letterSpacing: 1, textTransform: "uppercase",
            }}>{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchmakingScreen({ foundPlayers, totalNeeded = 4, onCancel }) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 500);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100%", gap: 36, padding: 40, position: "relative",
    }}>
      <ParticleField />

      <div style={{
        fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 400,
        color: S.gold, letterSpacing: 6, textTransform: "uppercase", zIndex: 1,
        animation: "float-up 0.6s ease both",
      }}>
        Matchmaking
      </div>

      {/* Radar */}
      <div style={{
        width: 180, height: 180, borderRadius: "50%",
        border: `2px solid rgba(212,165,60,0.2)`,
        position: "relative", zIndex: 1,
        background: `radial-gradient(circle, rgba(26,107,74,0.1) 0%, transparent 70%)`,
        animation: "float-up 0.6s ease 0.1s both",
      }}>
        {/* Rings */}
        {[60, 120].map((size, i) => (
          <div key={i} style={{
            position: "absolute",
            top: "50%", left: "50%",
            width: size, height: size,
            borderRadius: "50%",
            border: `1px solid rgba(212,165,60,0.1)`,
            transform: "translate(-50%,-50%)",
          }} />
        ))}

        {/* Sweep */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          width: 90, height: 2,
          background: `linear-gradient(90deg, ${S.gold}, transparent)`,
          transformOrigin: "0 50%",
          animation: "radar-sweep 2s linear infinite",
          opacity: 0.6,
        }} />

        {/* Center dot */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 10, height: 10, borderRadius: "50%",
          background: S.emeraldLight,
          boxShadow: `0 0 15px ${S.emeraldLight}`,
        }} />

        {/* Ripple */}
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: 30, height: 30, borderRadius: "50%",
            border: `1px solid ${S.gold}`,
            animation: `ripple 2s ease ${i * 0.6}s infinite`,
          }} />
        ))}

        {/* Found players on radar */}
        {foundPlayers.map((p, i) => {
          const angle = (i / totalNeeded) * Math.PI * 2 - Math.PI / 2;
          const dist = 55;
          return (
            <div key={p.name || p.username} style={{
              position: "absolute",
              top: `calc(50% + ${Math.sin(angle) * dist}px)`,
              left: `calc(50% + ${Math.cos(angle) * dist}px)`,
              transform: "translate(-50%,-50%)",
              width: 32, height: 32, borderRadius: "50%",
              background: `linear-gradient(135deg, ${S.emeraldDark}, ${S.bg3})`,
              border: `2px solid ${S.gold}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
              animation: `float-up 0.5s ease ${i * 0.1}s both`,
              boxShadow: `0 0 12px rgba(212,165,60,0.4)`,
            }}>
              {p.avatar}
            </div>
          );
        })}
      </div>

      <div style={{
        fontFamily: "'Rajdhani', sans-serif", fontSize: 18, fontWeight: 500,
        color: S.white, zIndex: 1,
        animation: "float-up 0.6s ease 0.2s both",
      }}>
        Searching for opponents{dots}
      </div>

      <div style={{
        display: "flex", gap: 8, zIndex: 1,
        animation: "float-up 0.6s ease 0.3s both",
      }}>
        {Array.from({ length: totalNeeded }, (_, i) => (
          <div key={i} style={{
            width: 40, height: 40, borderRadius: 10,
            background: i < foundPlayers.length
              ? `linear-gradient(135deg, ${S.emeraldDark}, ${S.emerald})`
              : "rgba(255,255,255,0.05)",
            border: `1.5px solid ${i < foundPlayers.length ? S.emeraldLight : "rgba(255,255,255,0.1)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
            transition: "all 0.3s ease",
            boxShadow: i < foundPlayers.length ? `0 0 10px rgba(40,160,106,0.3)` : "none",
          }}>
            {i < foundPlayers.length ? foundPlayers[i].avatar : "?"}
          </div>
        ))}
      </div>

      <div style={{
        fontFamily: "'Rajdhani', sans-serif", fontSize: 13, color: S.gray,
        zIndex: 1,
      }}>
        {foundPlayers.length} / {totalNeeded} players found
      </div>

      <button onClick={onCancel} style={{
        fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 500,
        color: S.gray, background: "transparent",
        border: `1px solid rgba(100,100,130,0.3)`,
        padding: "8px 20px", borderRadius: 6,
        cursor: "pointer", zIndex: 1,
        transition: "all 0.2s",
      }}>
        Cancel
      </button>
    </div>
  );
}

function BracketScreen({ players, matchResults, currentMatch, onAutoReady, myUsername, matchInfo, onSpectate, onLeaveTournament }) {
  // matchResults: { semi1: winnerUsername|null, semi2: winnerUsername|null, final: winnerUsername|null }
  // matchInfo: { semi1: {player1, player2}, semi2: {player1, player2}, final: {player1, player2}|null }

  const [readySent, setReadySent] = useState(false);

  const getPlayerByUsername = (uname) => players.find(p => p.username === uname) || { name: uname, username: uname, avatar: "?", elo: 0 };

  // Determine what round this player is in right now
  const myCurrentRound = useMemo(() => {
    // Check final first
    if (matchInfo.final && !matchResults.final) {
      const f = matchInfo.final;
      if (f.player1 === myUsername || f.player2 === myUsername) return "final";
    }
    // Check semis
    if (matchInfo.semi1 && !matchResults.semi1) {
      const s = matchInfo.semi1;
      if (s.player1 === myUsername || s.player2 === myUsername) return "semi1";
    }
    if (matchInfo.semi2 && !matchResults.semi2) {
      const s = matchInfo.semi2;
      if (s.player1 === myUsername || s.player2 === myUsername) return "semi2";
    }
    return null;
  }, [matchInfo, matchResults, myUsername]);

  // Am I eliminated?
  const amEliminated = useMemo(() => {
    // Check if I lost in any completed match
    for (const round of ["semi1", "semi2", "final"]) {
      const m = matchInfo[round];
      const winner = matchResults[round];
      if (m && winner) {
        if ((m.player1 === myUsername || m.player2 === myUsername) && winner !== myUsername) {
          return true;
        }
      }
    }
    return false;
  }, [matchInfo, matchResults, myUsername]);

  // Am I a winner waiting for final?
  const amWaitingForFinal = useMemo(() => {
    if (amEliminated) return false;
    // I won my semi, but final hasn't started yet
    for (const round of ["semi1", "semi2"]) {
      if (matchResults[round] === myUsername && !matchInfo.final) return true;
      if (matchResults[round] === myUsername && matchInfo.final && !matchResults.final) {
        const f = matchInfo.final;
        if (f.player1 === myUsername || f.player2 === myUsername) return false; // myCurrentRound handles this
      }
    }
    return false;
  }, [matchResults, matchInfo, myUsername, amEliminated]);

  // Manual ready — player clicks "Play Match" to enter
  const handlePlayMatch = useCallback(() => {
    if (!myCurrentRound || readySent || amEliminated) return;
    setReadySent(true);
    onAutoReady(myCurrentRound);
  }, [myCurrentRound, readySent, amEliminated, onAutoReady]);

  // Reset readySent when round changes (e.g., moving from semi to final)
  useEffect(() => {
    setReadySent(false);
  }, [myCurrentRound]);

  const getMatchStatus = (round) => {
    if (matchResults[round]) return "complete";
    if (matchInfo[round]) return "active";
    return "upcoming";
  };

  const renderMatchCard = (round, label, delayBase) => {
    const m = matchInfo[round];
    if (!m) return null;
    const status = getMatchStatus(round);
    const winner = matchResults[round];
    const p1 = getPlayerByUsername(m.player1);
    const p2 = getPlayerByUsername(m.player2);
    const isMyMatch = m.player1 === myUsername || m.player2 === myUsername;
    const isLive = status === "active" && !winner;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        animation: `float-up 0.6s ease ${delayBase}s both`,
      }}>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 11,
          color: isLive ? S.goldLight : status === "complete" ? S.emeraldLight : S.gray,
          letterSpacing: 2, textTransform: "uppercase", fontWeight: 600,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {isLive && <span style={{
            width: 6, height: 6, borderRadius: "50%", background: S.goldLight,
            animation: "pulse-gold 1.5s ease infinite", display: "inline-block",
          }} />}
          {label}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: 12, borderRadius: 14,
          background: isLive && isMyMatch ? "rgba(212,165,60,0.08)" : "rgba(26,26,40,0.5)",
          border: `1.5px solid ${isLive && isMyMatch ? "rgba(212,165,60,0.3)" : status === "complete" ? "rgba(40,160,106,0.2)" : "rgba(100,100,130,0.15)"}`,
          animation: isLive && isMyMatch ? "glow-border 2s ease infinite" : "none",
          transition: "all 0.5s ease",
        }}>
          <PlayerCard
            player={{ name: p1.username, avatar: p1.avatar, elo: p1.elo }}
            size="sm"
            highlight={isLive && isMyMatch}
            winner={winner === m.player1}
            eliminated={winner !== null && winner !== m.player1}
            isYou={m.player1 === myUsername}
          />
          <MatchupVS delay={delayBase + 0.2} />
          <PlayerCard
            player={{ name: p2.username, avatar: p2.avatar, elo: p2.elo }}
            size="sm"
            highlight={isLive && isMyMatch}
            winner={winner === m.player2}
            eliminated={winner !== null && winner !== m.player2}
            isYou={m.player2 === myUsername}
          />
        </div>
        {/* Status line under each match */}
        {isLive && isMyMatch && !readySent && (
          <button onClick={handlePlayMatch} style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 700,
            color: "#fff", background: `linear-gradient(135deg, ${S.gold}, ${S.goldDark})`,
            border: "none", borderRadius: 8, padding: "8px 24px",
            cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
            animation: "pulse-gold 2s ease infinite",
            boxShadow: `0 0 15px rgba(212,165,60,0.3)`,
            transition: "transform 0.2s ease, box-shadow 0.2s ease",
          }}
          onMouseEnter={e => { e.target.style.transform = "scale(1.05)"; e.target.style.boxShadow = `0 0 25px rgba(212,165,60,0.5)`; }}
          onMouseLeave={e => { e.target.style.transform = "scale(1)"; e.target.style.boxShadow = `0 0 15px rgba(212,165,60,0.3)`; }}
          >
            ⚔ Play Match
          </button>
        )}
        {isLive && isMyMatch && readySent && (
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 12, color: S.goldLight,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: S.goldLight,
              animation: "pulse-gold 1s ease infinite",
            }} />
            Waiting for opponent...
          </div>
        )}
        {isLive && !isMyMatch && (
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 12, color: S.grayLight,
            fontStyle: "italic",
          }}>
            Match in progress...
          </div>
        )}
        {status === "complete" && (
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 12, color: S.emeraldLight,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            ✓ {winner} wins
          </div>
        )}
      </div>
    );
  };

  const semi1Done = matchResults.semi1 !== null;
  const semi2Done = matchResults.semi2 !== null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: "100%", padding: "30px 20px", gap: 20, position: "relative",
    }}>
      <ParticleField />

      {/* Header */}
      <div style={{ zIndex: 1, textAlign: "center", animation: "float-up 0.5s ease both" }}>
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: 12, color: S.gold,
          letterSpacing: 6, textTransform: "uppercase", marginBottom: 4,
        }}>Tournament</div>
        <h2 style={{
          fontFamily: "'Cinzel', serif", fontSize: 28, fontWeight: 900,
          color: S.white, margin: 0,
        }}>BRACKET</h2>
      </div>

      {/* My status banner */}
      <div style={{
        zIndex: 1, padding: "8px 20px", borderRadius: 8,
        background: amEliminated
          ? "rgba(192,57,43,0.12)"
          : amWaitingForFinal
            ? "rgba(212,165,60,0.1)"
            : myCurrentRound
              ? "rgba(40,160,106,0.1)"
              : "rgba(100,100,130,0.1)",
        border: `1px solid ${amEliminated ? "rgba(192,57,43,0.3)" : amWaitingForFinal ? "rgba(212,165,60,0.3)" : myCurrentRound ? "rgba(40,160,106,0.3)" : "rgba(100,100,130,0.2)"}`,
        fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 500,
        color: amEliminated ? S.redLight : amWaitingForFinal ? S.goldLight : myCurrentRound ? S.emeraldLight : S.grayLight,
        animation: "float-up 0.5s ease 0.1s both",
        textAlign: "center",
      }}>
        {amEliminated && "You have been eliminated"}
        {amWaitingForFinal && "You won! Waiting for the other semi-final..."}
        {myCurrentRound === "semi1" && !readySent && "Your semi-final is ready — click Play Match!"}
        {myCurrentRound === "semi2" && !readySent && "Your semi-final is ready — click Play Match!"}
        {myCurrentRound === "final" && !readySent && "Grand Final is ready — click Play Match!"}
        {myCurrentRound && readySent && "Entering game room..."}
        {!amEliminated && !amWaitingForFinal && !myCurrentRound && semi1Done && semi2Done && !matchInfo.final && "Preparing final match..."}
      </div>

      {/* Semi-Finals */}
      <div style={{ zIndex: 1, textAlign: "center" }}>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 12, color: S.gold,
          letterSpacing: 4, textTransform: "uppercase", marginBottom: 12, fontWeight: 600,
          animation: "float-up 0.5s ease 0.1s both",
        }}>— Semi-Finals —</div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          {renderMatchCard("semi1", "Match 1", 0.2)}
          {renderMatchCard("semi2", "Match 2", 0.4)}
        </div>
      </div>

      {/* Connector line */}
      <div style={{
        width: 2, height: 30,
        background: `linear-gradient(to bottom, ${S.gold}, transparent)`,
        opacity: (semi1Done && semi2Done) ? 1 : 0.2,
        transition: "opacity 0.5s",
        zIndex: 1,
      }} />

      {/* Finals */}
      <div style={{ zIndex: 1, textAlign: "center" }}>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 12, color: S.gold,
          letterSpacing: 4, textTransform: "uppercase", marginBottom: 12, fontWeight: 600,
          animation: "float-up 0.5s ease 0.5s both",
        }}>— Grand Final —</div>
        {matchInfo.final ? (
          renderMatchCard("final", "Final", 0.6)
        ) : (
          <div style={{
            padding: "24px 40px", borderRadius: 14,
            border: "1.5px dashed rgba(100,100,130,0.2)",
            fontFamily: "'Rajdhani', sans-serif", fontSize: 14, color: S.gray,
            animation: "float-up 0.5s ease 0.6s both",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            {semi1Done && semi2Done ? (
              <>
                <span style={{ fontSize: 20 }}>⏳</span>
                Setting up final match...
              </>
            ) : (
              <>
                <span style={{ fontSize: 20 }}>⚔</span>
                Awaiting semi-final results...
              </>
            )}
          </div>
        )}
      </div>

      {/* Eliminated player actions */}
      {amEliminated && (
        <div style={{
          zIndex: 1, display: "flex", gap: 12, marginTop: 8,
          animation: "float-up 0.6s ease 0.3s both",
        }}>
          <button onClick={onLeaveTournament} style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 600,
            color: S.grayLight, background: "rgba(100,100,130,0.15)",
            border: "1px solid rgba(100,100,130,0.3)",
            padding: "10px 24px", borderRadius: 8,
            cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
            transition: "all 0.2s",
          }}>
            Find New Tournament
          </button>
        </div>
      )}
    </div>
  );
}

function GameScreen({ myUsername, opponentUsername, myAvatar, opponentAvatar, myElo, opponentElo,
                       board, isMyTurn, lastMove, gameOver, onCellClick, matchLabel, amPlayer1, onForfeit, chainJumpPiece }) {
  const [selected, setSelected] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  const [boardReady, setBoardReady] = useState(false);

  useEffect(() => {
    setTimeout(() => setBoardReady(true), 300);
  }, []);

  // Reset selection when turn changes or board updates — but NOT during chain jump
  useEffect(() => {
    if (!chainJumpPiece) {
      setSelected(null);
      setValidMoves([]);
    }
  }, [board, isMyTurn, chainJumpPiece]);

  // Auto-select chain-jump piece and show only its jump moves
  useEffect(() => {
    if (chainJumpPiece && isMyTurn && !gameOver) {
      setSelected({ row: chainJumpPiece.row, col: chainJumpPiece.col });
      const jumps = getValidMoves(board, chainJumpPiece.row, chainJumpPiece.col).filter(m => m.jump);
      setValidMoves(jumps);
    }
  }, [chainJumpPiece, board, isMyTurn, gameOver]);

  // Which pieces can I move? If I'm player1, I move P1 pieces. If player2, P2 pieces.
  const isMyPiece = amPlayer1 ? isP1 : isP2;

  const handleCellClick = useCallback((r, c) => {
    if (!isMyTurn || gameOver) return;

    // During chain jump, only allow clicking on the chain-jump piece's valid targets
    if (chainJumpPiece) {
      const move = validMoves.find(m => m.row === r && m.col === c);
      if (move) {
        const fullMove = { fromRow: chainJumpPiece.row, fromCol: chainJumpPiece.col, ...move };
        onCellClick(fullMove);
        return;
      }
      // Don't allow selecting a different piece during chain jump
      return;
    }

    if (selected) {
      const move = validMoves.find(m => m.row === r && m.col === c);
      if (move) {
        // Send move to server
        const fullMove = { fromRow: selected.row, fromCol: selected.col, ...move };
        onCellClick(fullMove);
        setSelected(null);
        setValidMoves([]);
        return;
      }
    }

    // Select a piece
    const piece = board[r][c];
    if (isMyPiece(piece)) {
      const moves = getValidMoves(board, r, c);
      // Enforce mandatory jumps
      const allMoves = getAllMoves(board, amPlayer1);
      const hasJumps = allMoves.some(m => m.jump);
      if (hasJumps && !moves.some(m => m.jump)) {
        setSelected(null);
        setValidMoves([]);
        return;
      }
      if (hasJumps) {
        setSelected({ row: r, col: c });
        setValidMoves(moves.filter(m => m.jump));
      } else {
        setSelected({ row: r, col: c });
        setValidMoves(moves);
      }
    } else {
      setSelected(null);
      setValidMoves([]);
    }
  }, [selected, validMoves, board, isMyTurn, gameOver, amPlayer1, onCellClick, isMyPiece, chainJumpPiece]);

  const p1Count = countPieces(board, true);
  const p2Count = countPieces(board, false);
  const myCount = amPlayer1 ? p1Count : p2Count;
  const opponentCount = amPlayer1 ? p2Count : p1Count;

  // If I'm player2, I see the board flipped so my pieces are at the bottom
  const displayBoard = amPlayer1
    ? board
    : [...board].reverse().map(row => [...row].reverse());

  // Transform coordinates for display when flipped
  const transformCoord = (r, c) => {
    if (amPlayer1) return { r, c };
    return { r: 7 - r, c: 7 - c };
  };

  // Transform lastMove for display
  const displayLastMove = lastMove && !amPlayer1
    ? { fromRow: 7 - lastMove.fromRow, fromCol: 7 - lastMove.fromCol, row: 7 - lastMove.row, col: 7 - lastMove.col }
    : lastMove;

  // Transform selected for display
  const displaySelected = selected && !amPlayer1
    ? { row: 7 - selected.row, col: 7 - selected.col }
    : selected;

  // Transform validMoves for display
  const displayValidMoves = !amPlayer1
    ? validMoves.map(m => ({ ...m, row: 7 - m.row, col: 7 - m.col }))
    : validMoves;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: "100%", padding: "20px 16px", gap: 16, position: "relative",
    }}>
      <ParticleField />

      {/* Match label */}
      <div style={{
        fontFamily: "'Cinzel', serif", fontSize: 11, color: S.gold,
        letterSpacing: 5, textTransform: "uppercase", zIndex: 1,
        animation: "float-up 0.5s ease both",
      }}>
        ⚔ {matchLabel}
      </div>

      {/* Player bar top - opponent */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, zIndex: 1,
        animation: "slide-in-right 0.5s ease both",
        opacity: !isMyTurn && !gameOver ? 1 : 0.6,
        transition: "opacity 0.3s",
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: `linear-gradient(135deg, ${amPlayer1 ? S.red : S.goldDark}, ${amPlayer1 ? S.redLight : S.gold})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, border: `2px solid ${!isMyTurn ? S.goldLight : "transparent"}`,
          transition: "border-color 0.3s",
        }}>{opponentAvatar}</div>
        <div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 600, color: S.white,
          }}>{opponentUsername}</div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 11, color: S.gray,
          }}>
            {opponentCount} pieces {!isMyTurn && !gameOver ? "· Their turn" : ""}
          </div>
        </div>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 10, color: S.gray,
          background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6,
        }}>ELO {opponentElo}</div>
      </div>

      {/* Board */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
        width: "min(360px, 90vw)",
        aspectRatio: "1",
        borderRadius: 8,
        overflow: "hidden",
        border: `2px solid rgba(212,165,60,0.3)`,
        boxShadow: `0 0 40px rgba(0,0,0,0.5), 0 0 80px rgba(26,107,74,0.1)`,
        zIndex: 1,
        animation: boardReady ? "board-appear 0.8s ease both" : "none",
      }}>
        {displayBoard.map((row, dr) => row.map((cell, dc) => {
          const isDark = (dr + dc) % 2 === 1;
          const isSelectedCell = displaySelected && displaySelected.row === dr && displaySelected.col === dc;
          const isValidTarget = displayValidMoves.some(m => m.row === dr && m.col === dc);
          const isLastFrom = displayLastMove && displayLastMove.fromRow === dr && displayLastMove.fromCol === dc;
          const isLastTo = displayLastMove && displayLastMove.row === dr && displayLastMove.col === dc;

          // Transform display coords back to real coords for click handler
          const realCoords = transformCoord(dr, dc);

          return (
            <div
              key={`${dr}-${dc}`}
              onClick={() => handleCellClick(realCoords.r, realCoords.c)}
              style={{
                aspectRatio: "1",
                background: isDark
                  ? isSelectedCell
                    ? `linear-gradient(135deg, rgba(212,165,60,0.4), ${S.emeraldDark})`
                    : isLastTo
                      ? `linear-gradient(135deg, rgba(40,160,106,0.3), ${S.emeraldDark})`
                      : S.emeraldDark
                  : isLastFrom
                    ? "rgba(240,208,120,0.1)"
                    : "#2a2a38",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isDark && (isMyPiece(cell) || isValidTarget) && isMyTurn ? "pointer" : "default",
                position: "relative",
                transition: "background 0.2s",
              }}
            >
              {isValidTarget && (
                <div style={{
                  position: "absolute",
                  width: "35%", height: "35%",
                  borderRadius: "50%",
                  background: `radial-gradient(circle, rgba(212,165,60,0.6), rgba(212,165,60,0.2))`,
                  boxShadow: `0 0 10px rgba(212,165,60,0.3)`,
                  animation: "pulse-gold 1.5s ease infinite",
                }} />
              )}
              {cell !== EMPTY && (
                <div style={{
                  width: "75%", height: "75%", borderRadius: "50%",
                  background: isP1(cell)
                    ? `radial-gradient(circle at 35% 35%, #f5e6c8, ${S.goldDark})`
                    : `radial-gradient(circle at 35% 35%, #8b3a3a, #3a1010)`,
                  border: `2px solid ${isP1(cell) ? S.goldLight : "#c0392b"}`,
                  boxShadow: isP1(cell)
                    ? `inset 0 2px 4px rgba(255,255,255,0.3), 0 3px 8px rgba(0,0,0,0.4)`
                    : `inset 0 2px 4px rgba(255,100,100,0.2), 0 3px 8px rgba(0,0,0,0.4)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: isKing(cell) ? "clamp(12px, 3vw, 18px)" : 0,
                  transition: "transform 0.15s",
                  transform: isSelectedCell ? "scale(1.1)" : "scale(1)",
                }}>
                  {isKing(cell) && "♔"}
                </div>
              )}
            </div>
          );
        }))}
      </div>

      {/* Player bar bottom - you */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, zIndex: 1,
        animation: "slide-in-left 0.5s ease both",
        opacity: isMyTurn && !gameOver ? 1 : 0.6,
        transition: "opacity 0.3s",
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: `linear-gradient(135deg, ${amPlayer1 ? S.goldDark : S.red}, ${amPlayer1 ? S.gold : S.redLight})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, border: `2px solid ${isMyTurn ? S.goldLight : "transparent"}`,
          transition: "border-color 0.3s",
        }}>{myAvatar}</div>
        <div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 600, color: S.white,
          }}>{myUsername} <span style={{ fontSize: 10, color: S.gold }}>(You)</span></div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 11, color: S.gray,
          }}>
            {myCount} pieces {isMyTurn && !gameOver ? "· Your turn" : ""}
          </div>
        </div>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 10, color: S.gray,
          background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 6,
        }}>ELO {myElo}</div>
      </div>

      {/* Forfeit button */}
      {!gameOver && (
        <button onClick={() => {
          if (confirm("Forfeit this match? Your opponent will be declared the winner.")) {
            onForfeit();
          }
        }} style={{
          fontFamily: "'Rajdhani', sans-serif", fontSize: 11, fontWeight: 600,
          color: S.gray, background: "transparent",
          border: `1px solid rgba(100,100,130,0.2)`,
          padding: "6px 16px", borderRadius: 6,
          cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
          zIndex: 1, transition: "all 0.2s",
        }}>
          Forfeit
        </button>
      )}

      {/* Game over overlay */}
      {gameOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          background: "rgba(10,10,15,0.85)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 20,
          backdropFilter: "blur(8px)",
          animation: "float-up 0.5s ease both",
        }}>
          <div style={{
            fontSize: 50,
            animation: gameOver.won ? "crown-bounce 2s ease infinite" : "none",
          }}>
            {gameOver.won ? "🏆" : "💀"}
          </div>
          <div style={{
            fontFamily: "'Cinzel', serif", fontSize: 24, fontWeight: 900,
            color: gameOver.won ? S.gold : S.redLight,
          }}>
            {gameOver.won ? "Victory!" : "Defeat"}
          </div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 14, color: S.grayLight,
          }}>
            {gameOver.reason === 'timeout'
              ? (gameOver.won ? "Opponent ran out of time" : "You ran out of time")
              : gameOver.reason === 'disconnect'
              ? (gameOver.won ? "Opponent disconnected" : "You were disconnected")
              : gameOver.reason === 'forfeit'
              ? (gameOver.won ? "Opponent forfeited" : "You forfeited the match")
              : `${gameOver.winnerUsername} wins this match`}
          </div>
          <div style={{
            fontFamily: "'Rajdhani', sans-serif", fontSize: 13, color: S.gray,
            marginTop: 8,
          }}>
            Returning to bracket...
          </div>
        </div>
      )}
    </div>
  );
}

function ChampionScreen({ champion, players, onPlayAgain }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100%", gap: 24, padding: 40, position: "relative", overflow: "hidden",
    }}>
      <ParticleField />

      {/* Extra confetti */}
      {Array.from({ length: 20 }, (_, i) => (
        <div key={`c-${i}`} style={{
          position: "absolute",
          left: `${Math.random() * 100}%`,
          top: "-20px",
          width: 6 + Math.random() * 8,
          height: 6 + Math.random() * 8,
          background: [S.gold, S.emeraldLight, S.redLight, S.goldLight, "#fff"][i % 5],
          borderRadius: Math.random() > 0.5 ? "50%" : "2px",
          animation: `confetti-fall ${3 + Math.random() * 4}s linear ${Math.random() * 2}s infinite`,
          opacity: 0.7,
          zIndex: 0,
        }} />
      ))}

      <div style={{
        fontSize: 70, zIndex: 1,
        animation: "crown-bounce 2s ease infinite",
        filter: "drop-shadow(0 0 20px rgba(212,165,60,0.5))",
      }}>🏆</div>

      <div style={{
        fontFamily: "'Cinzel', serif", fontSize: 13, color: S.gold,
        letterSpacing: 8, textTransform: "uppercase", zIndex: 1,
        animation: "float-up 0.6s ease 0.1s both",
      }}>Tournament Champion</div>

      <div style={{ zIndex: 1, animation: "float-up 0.6s ease 0.2s both" }}>
        <PlayerCard player={{ name: champion.username, avatar: champion.avatar, elo: champion.elo }} size="lg" winner />
      </div>

      <div style={{
        display: "flex", gap: 16, marginTop: 12, zIndex: 1,
        animation: "float-up 0.6s ease 0.4s both",
      }}>
        {players.filter(p => p.username !== champion.username).map((p, i) => (
          <PlayerCard key={p.username} player={{ name: p.username, avatar: p.avatar, elo: p.elo }} size="sm" eliminated delay={0.5 + i * 0.1} />
        ))}
      </div>

      <button onClick={onPlayAgain} style={{
        fontFamily: "'Cinzel', serif", fontSize: 14, fontWeight: 700,
        color: S.bg, background: `linear-gradient(135deg, ${S.gold}, ${S.goldLight})`,
        border: "none", padding: "12px 36px", borderRadius: 8,
        cursor: "pointer", letterSpacing: 3, textTransform: "uppercase",
        marginTop: 16, zIndex: 1,
        boxShadow: `0 6px 30px rgba(212,165,60,0.4)`,
        animation: "float-up 0.6s ease 0.6s both",
      }}>
        ⚔ New Tournament
      </button>
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────

function CheckersTournament() {
  const [screen, setScreen] = useState("lobby"); // lobby, matchmaking, bracket, game, champion
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState("👑");
  const [error, setError] = useState("");

  // Tournament state
  const [tournamentId, setTournamentId] = useState(null);
  const [players, setPlayers] = useState([]);       // [{username, avatar, elo, seed}]
  const [foundPlayers, setFoundPlayers] = useState([]); // queue players during matchmaking
  const [matchInfo, setMatchInfo] = useState({ semi1: null, semi2: null, final: null });
  const [matchResults, setMatchResults] = useState({ semi1: null, semi2: null, final: null });
  const [currentMatch, setCurrentMatch] = useState("semi1");

  // Game state (from server)
  const [gameBoard, setGameBoard] = useState(initBoard());
  const [gameRound, setGameRound] = useState(null);     // "semi1", "semi2", "final"
  const [gameCurrentTurn, setGameCurrentTurn] = useState(null);
  const [gameLastMove, setGameLastMove] = useState(null);
  const [gameOverState, setGameOverState] = useState(null);
  const [gamePlayer1, setGamePlayer1] = useState(null);
  const [gamePlayer2, setGamePlayer2] = useState(null);

  // Chain jump piece (for multi-jump enforcement)
  const [gameChainJumpPiece, setGameChainJumpPiece] = useState(null);

  // Champion
  const [champion, setChampion] = useState(null);

  // WebSocket
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const joinSentRef = useRef(false); // Prevent double tournament_join sends

  // Refs to access current state inside WebSocket callbacks without stale closures
  const screenRef = useRef(screen);
  const usernameRef = useRef(username);
  const avatarRef = useRef(avatar);
  const tournamentIdRef = useRef(tournamentId);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { avatarRef.current = avatar; }, [avatar]);
  useEffect(() => { tournamentIdRef.current = tournamentId; }, [tournamentId]);

  // Try to load username from localStorage (from the existing auth system)
  useEffect(() => {
    const stored = localStorage.getItem("username");
    if (stored) setUsername(stored);
  }, []);

  // Send tournament_join message on an open socket (with dedup guard)
  const sendTournamentJoin = useCallback((force = false) => {
    if (joinSentRef.current && !force) return; // Already sent, skip duplicate
    const ws = wsRef.current;
    const uname = usernameRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !uname) return;
    joinSentRef.current = true;
    ws.send(JSON.stringify({
      type: 'tournament_join',
      username: uname.trim(),
      avatar: avatarRef.current,
      elo: 1000,
      userId: uname,
      userType: 'registered'
    }));
    console.log("[Tournament] Sent tournament_join for", uname);
  }, []);

  // WebSocket connection — stable function, uses refs for current state
  const connectWs = useCallback(() => {
    // Close any existing dead socket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) return;
      if (wsRef.current.readyState === WebSocket.CONNECTING) return;
      // Socket is CLOSING or CLOSED, clean it up
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Tournament WS] Connected, screen:", screenRef.current);
      setError("");
      // If we're in matchmaking, re-send join so server knows about us (force on reconnect)
      if (screenRef.current === "matchmaking") {
        sendTournamentJoin(true);
      } else if (screenRef.current === "bracket" || screenRef.current === "game") {
        // Reconnected during active tournament — re-register socket with server
        // so disconnect forfeit timer is cancelled and server can reach us
        ws.send(JSON.stringify({
          type: 'tournament_reconnect',
          username: usernameRef.current,
          tournamentId: tournamentIdRef.current
        }));
        console.log("[Tournament WS] Sent reconnect for", usernameRef.current);
      }
    };

    ws.onclose = () => {
      console.log("[Tournament WS] Disconnected, screen:", screenRef.current);
      joinSentRef.current = false; // Reset so reconnection can re-send join
      // Auto-reconnect if not on lobby
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (screenRef.current !== "lobby") {
          console.log("[Tournament WS] Reconnecting...");
          connectWs();
        }
      }, 2000);
    };

    ws.onerror = (err) => {
      console.error("[Tournament WS] Error:", err);
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      const myName = usernameRef.current;

      switch (msg.type) {
        case 'tournament_queue_update':
          // Only update if still on matchmaking screen; ignore stale updates after tournament creation
          if (screenRef.current === "matchmaking") {
            setFoundPlayers(msg.players || []);
          }
          break;

        case 'tournament_created':
          setTournamentId(msg.tournamentId);
          setPlayers(msg.players);
          setMatchInfo({
            semi1: msg.matches.semi1,
            semi2: msg.matches.semi2,
            final: msg.matches.final || null
          });
          setMatchResults({ semi1: null, semi2: null, final: null });
          setCurrentMatch("semi1");
          setScreen("bracket");
          break;

        case 'tournament_match_waiting':
          break;

        case 'tournament_match_start':
          setGameBoard(msg.board);
          setGameRound(msg.round);
          setGameCurrentTurn(msg.currentTurn);
          setGameLastMove(null);
          setGameOverState(null);
          setGamePlayer1(msg.player1);
          setGamePlayer2(msg.player2);
          setGameChainJumpPiece(msg.chainJumpPiece || null);
          setScreen("game");
          break;

        case 'tournament_move_made':
          setGameBoard(msg.board);
          setGameCurrentTurn(msg.currentTurn);
          setGameLastMove(msg.lastMove);
          setGameChainJumpPiece(msg.chainJumpPiece || null);
          break;

        case 'tournament_move_rejected':
          console.warn("[Tournament] Move rejected:", msg.message);
          break;

        case 'tournament_game_over':
          setGameBoard(msg.board);
          setGameLastMove(msg.lastMove);
          setGameChainJumpPiece(null);
          setGameOverState({
            won: msg.winnerUsername === myName,
            winnerUsername: msg.winnerUsername,
            loserUsername: msg.loserUsername,
            reason: msg.reason || 'checkmate'
          });
          setTimeout(() => {
            setMatchResults(prev => ({ ...prev, [msg.round]: msg.winnerUsername }));
            setGameOverState(null);
            setScreen("bracket");
          }, 3000);
          break;

        case 'tournament_match_completed':
          setMatchResults(prev => ({ ...prev, [msg.round]: msg.winnerUsername }));
          if (msg.players) setPlayers(msg.players);
          break;

        case 'tournament_final_ready':
          setMatchInfo(prev => ({ ...prev, final: msg.finalMatch }));
          setCurrentMatch("final");
          if (msg.players) setPlayers(msg.players);
          setScreen("bracket");
          break;

        case 'tournament_champion': {
          const allPlayers = msg.players || [];
          const champ = allPlayers.find(p => p.username === msg.championUsername);
          setChampion(champ || { username: msg.championUsername, avatar: "🏆", elo: 1000 });
          setMatchResults(prev => ({ ...prev, final: msg.championUsername }));
          if (msg.players) setPlayers(msg.players);
          setScreen("champion");
          break;
        }

        case 'tournament_match_timeout':
          setGameOverState({
            won: msg.winnerUsername === myName,
            winnerUsername: msg.winnerUsername,
            loserUsername: msg.timedOutPlayer,
            reason: 'timeout'
          });
          setTimeout(() => {
            setMatchResults(prev => ({ ...prev, [msg.round]: msg.winnerUsername }));
            setGameOverState(null);
            setScreen("bracket");
          }, 3000);
          break;

        case 'tournament_opponent_disconnected':
          setGameOverState({
            won: msg.winnerUsername === myName,
            winnerUsername: msg.winnerUsername,
            loserUsername: msg.disconnectedPlayer,
            reason: msg.reason || 'disconnect'
          });
          setTimeout(() => {
            setMatchResults(prev => ({ ...prev, [msg.round]: msg.winnerUsername }));
            setGameOverState(null);
            setScreen("bracket");
          }, 3000);
          break;

        case 'tournament_error':
          setError(msg.message);
          break;

        case 'tournament_match_started_spectator':
          break;
      }
    };
  }, [sendTournamentJoin]);

  // Connect WebSocket when joining matchmaking
  const handleJoin = useCallback(() => {
    if (!username.trim()) {
      setError("Please enter a username");
      return;
    }

    setError("");
    joinSentRef.current = false; // Reset flag for fresh join
    localStorage.setItem("username", username);
    setScreen("matchmaking");
    setFoundPlayers([{ username: username.trim(), avatar }]);

    // Connect — onopen will send tournament_join once connected
    connectWs();

    // Fallback poll: if socket was already OPEN (connectWs returned early), onopen won't fire
    // so we need to send the join manually in that case
    setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !joinSentRef.current) {
        sendTournamentJoin(true);
      }
    }, 100);
  }, [username, avatar, connectWs, sendTournamentJoin]);

  const clearTournamentSession = useCallback(() => {
    sessionStorage.removeItem('tournament_active');
    sessionStorage.removeItem('tournament_screen');
    sessionStorage.removeItem('tournament_id');
  }, []);

  const handleCancelMatchmaking = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tournament_leave',
        username: usernameRef.current
      }));
    }
    clearTournamentSession();
    joinSentRef.current = false;
    setScreen("lobby");
    setFoundPlayers([]);
  }, [clearTournamentSession]);

  // Manual-ready: called by BracketScreen when player clicks "Play Match"
  const handleAutoReady = useCallback((round) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("[Tournament] Auto-ready for round:", round);
      wsRef.current.send(JSON.stringify({
        type: 'tournament_match_ready',
        tournamentId: tournamentIdRef.current,
        round,
        username: usernameRef.current
      }));
    }
  }, []);

  // Leave tournament (for eliminated players wanting to re-search)
  const handleLeaveTournament = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tournament_leave',
        username: usernameRef.current
      }));
    }
    clearTournamentSession();
    setTournamentId(null);
    setPlayers([]);
    setMatchInfo({ semi1: null, semi2: null, final: null });
    setMatchResults({ semi1: null, semi2: null, final: null });
    setCurrentMatch("semi1");
    setGameOverState(null);
    setChampion(null);
    setScreen("lobby");
  }, [clearTournamentSession]);

  const handleGameMove = useCallback((move) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tournament_move',
        tournamentId: tournamentIdRef.current,
        round: gameRound,
        username: usernameRef.current,
        move
      }));
    }
  }, [gameRound]);

  // Forfeit: intentionally leave match mid-game
  const handleForfeit = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'tournament_leave',
        username: usernameRef.current
      }));
    }
    clearTournamentSession();
  }, [clearTournamentSession]);

  const handlePlayAgain = useCallback(() => {
    clearTournamentSession();
    setScreen("lobby");
    setTournamentId(null);
    setPlayers([]);
    setFoundPlayers([]);
    setMatchInfo({ semi1: null, semi2: null, final: null });
    setMatchResults({ semi1: null, semi2: null, final: null });
    setCurrentMatch("semi1");
    setGameOverState(null);
    setChampion(null);
  }, [clearTournamentSession]);

  // Handle page refresh vs real navigation away
  // On refresh: beforeunload sets a sessionStorage flag, then the page reloads and
  // the WebSocket reconnects within the server's 30s grace period — no forfeit.
  // On real close/navigation: the flag is set but never consumed, and the server's
  // WS close handler starts the 30s disconnect timer (which forfeits if no reconnect).
  // We do NOT send tournament_leave on beforeunload because refresh triggers it too.
  useEffect(() => {
    // On mount: if we have an active tournament flag, this is a refresh — reconnect will handle it
    const wasTournamentRefresh = sessionStorage.getItem('tournament_active');
    if (wasTournamentRefresh) {
      console.log("[Tournament] Page refreshed, will reconnect via WebSocket");
    }

    const handleBeforeUnload = () => {
      const scr = screenRef.current;
      if (scr === "bracket" || scr === "game" || scr === "matchmaking") {
        // Mark that we're in an active tournament so reload knows to reconnect
        sessionStorage.setItem('tournament_active', 'true');
        sessionStorage.setItem('tournament_screen', scr);
        if (tournamentIdRef.current) {
          sessionStorage.setItem('tournament_id', tournamentIdRef.current);
        }
      }
      // Do NOT send tournament_leave here — the server's WS close handler
      // has a 30s grace period that allows reconnection after refresh
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Determine game screen props
  const amPlayer1 = gamePlayer1 && gamePlayer1.username === username;
  const matchLabels = { semi1: "Semi-Final 1", semi2: "Semi-Final 2", final: "Grand Final" };

  return (
    <div style={{
      width: "100%", minHeight: "100vh",
      background: `linear-gradient(145deg, ${S.bg} 0%, ${S.bg2} 50%, ${S.bg} 100%)`,
      color: S.white,
      overflow: "auto",
    }}>
      <style>{keyframes}</style>

      {screen === "lobby" && (
        <LobbyScreen
          onJoin={handleJoin}
          username={username}
          onUsernameChange={setUsername}
          avatar={avatar}
          onAvatarChange={setAvatar}
          error={error}
        />
      )}
      {screen === "matchmaking" && (
        <MatchmakingScreen
          foundPlayers={foundPlayers}
          onCancel={handleCancelMatchmaking}
        />
      )}
      {screen === "bracket" && (
        <BracketScreen
          players={players}
          matchResults={matchResults}
          currentMatch={currentMatch}
          onAutoReady={handleAutoReady}
          myUsername={username}
          matchInfo={matchInfo}
          onLeaveTournament={handleLeaveTournament}
        />
      )}
      {screen === "game" && gamePlayer1 && gamePlayer2 && (
        <GameScreen
          myUsername={username}
          opponentUsername={amPlayer1 ? gamePlayer2.username : gamePlayer1.username}
          myAvatar={amPlayer1 ? gamePlayer1.avatar : gamePlayer2.avatar}
          opponentAvatar={amPlayer1 ? gamePlayer2.avatar : gamePlayer1.avatar}
          myElo={amPlayer1 ? gamePlayer1.elo : gamePlayer2.elo}
          opponentElo={amPlayer1 ? gamePlayer2.elo : gamePlayer1.elo}
          board={gameBoard}
          isMyTurn={gameCurrentTurn === username}
          lastMove={gameLastMove}
          gameOver={gameOverState}
          onCellClick={handleGameMove}
          matchLabel={matchLabels[gameRound] || "Match"}
          amPlayer1={amPlayer1}
          onForfeit={handleForfeit}
          chainJumpPiece={gameChainJumpPiece}
        />
      )}
      {screen === "champion" && champion && (
        <ChampionScreen
          champion={champion}
          players={players}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}
