# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A cyberpunk-themed multiplayer checkers game with AI opponents, real-time WebSocket gameplay, user accounts, tournaments, and an admin dashboard. Built as a Node.js/Express monolith with MongoDB persistence and vanilla HTML/CSS/JS frontend.

## Commands

- **Start server**: `npm start` (runs `node server.js`)
- **Dev with auto-reload**: `npm run dev` (runs `nodemon server.js`)
- **Create admin account**: `node admin/create-admin.js`
- **List admins**: `node admin/list-admins.js`
- **Reset admin password**: `node admin/reset-admin-password.js`
- **Clear all admins**: `node admin/clear-admins.js`
- **Cleanup duplicate stats**: `node cleanup-duplicates.js`
- **Analyze game stats**: `node analyze-stats.js`

Server runs on `PORT` env var or defaults to 3000.

## Required Environment Variables

Set in `.env` file (not committed):
- `MONGODB_URI` — MongoDB connection string
- `JWT_SECRET` — Secret for JWT token signing
- `ADMIN_REGISTRATION_KEY` — Key required to register admin accounts
- `PORT` (optional) — Server port, defaults to 3000
- `CORS_ORIGIN` (optional) — Allowed CORS origin, defaults to `http://localhost:3000`

## Architecture

### Single-file server (`server.js`)

Everything lives in one large `server.js` file (~2700 lines). It contains:

1. **Server-side checkers engine** (lines ~70-175) — Complete game logic for tournament play with `t`-prefixed functions (`tInitBoard`, `tGetValidMoves`, `tApplyMove`, `tValidateMove`, `tCheckGameOver`). Uses numeric constants: `T_EMPTY=0, T_P1=1, T_P2=2, T_P1K=3, T_P2K=4`.

2. **Tournament system** (~lines 52-488) — 4-player single-elimination brackets (semi1, semi2, final). ELO-based seeding. Server is authoritative for board state. In-memory Maps track active tournaments alongside MongoDB persistence.

3. **WebSocket handler** (`wss.on('connection')`) — Manages real-time multiplayer. Message types include: `join_lobby`, `find_match`, `join_game_room`, `move`, `chat`, `game_end`, `rematch_request`, `tournament_join`, `tournament_move`, etc. In-memory Maps: `connectedPlayers`, `waitingPlayers`, `activeMatches`, `matchRooms`.

4. **REST API routes** (~line 1641+) — Two auth scopes:
   - **User routes** (`authenticateToken` middleware): `/api/register`, `/api/login`, `/api/preferences/*`, `/api/single-player/*`, `/api/user/dashboard`
   - **Admin routes** (`authenticateAdmin` middleware): `/api/admin/*` (dashboard, users, games, AI tests, cleanup)
   - **Guest routes** (no auth): `/api/guest/*` (limited single-player and dashboard)

5. **Security middleware** — Helmet CSP, CORS, `express-mongo-sanitize`, `express-xss-sanitizer`, rate limiting on auth routes (100 req/15min), custom `escapeHtml()` for output encoding.

### Frontend (`public/`)

Static HTML pages served by Express, each self-contained with inline `<script>` and linked CSS:
- `index.html` / `styles.css` — Login/register page
- `game-mode.html` — Mode selection (single-player, multiplayer, tournament)
- `lobby.html` / `lobby.css` — Multiplayer lobby with matchmaking
- `game-room.html` / `game-room.css` — Multiplayer game board with chat
- `single-player.html` / `single-player.css` — AI opponent with `CheckersAI` class (minimax + alpha-beta pruning + pattern learning)
- `admin-login.html`, `admin-register.html`, `admin-dashboard.html` — Admin panel

The client-side AI (`CheckersAI` class in `single-player.html`) is separate from the server-side tournament engine. Single-player games use client-side logic; tournaments use server-authoritative logic.

### Mongoose Models (`models/`)

- `User.js` — username + hashed password
- `Admin.js` — separate admin accounts with role field
- `GameState.js` — multiplayer match state (board, chat history, winner)
- `SinglePlayerGame.js` — single-player save state with AI patterns
- `Tournament.js` — tournament bracket with players, matches, ELO
- `UserDashboard.js` — persistent stats (wins, losses, game history, achievements)
- `UserPreferences.js` — game settings (difficulty, enhanced king mode)
- `ColorPreferences.js` — UI theme colors per user
- `AITestResult.js` — AI performance test results

### Key Design Patterns

- **Dual auth system**: Users and admins have completely separate auth flows and JWT verification. Admin tokens cannot access user routes and vice versa.
- **In-memory + DB hybrid**: Active matches and tournaments live in memory Maps for performance, with MongoDB for persistence. Server restart loses in-progress games.
- **Disconnection grace periods**: Both multiplayer and tournament modes use timeout-based reconnection windows before forfeiting.
- **Guest mode**: Guests can play single-player only (no multiplayer/tournaments). Guest data stored with session-based identifiers.

## AI System

Three difficulty levels control the `CheckersAI` minimax engine:
- **Easy**: depth 2, 30% random moves, 20% miss rate
- **Medium**: depth 4, 10% random, 80% pattern usage
- **Hard**: depth 6, fully optimal, 100% pattern usage

The AI learns from games via board-state hashing and pattern storage. See `AI_DOCUMENTATION.md` for full details.
