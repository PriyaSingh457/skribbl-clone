# Doodle Party — Skribbl.io Clone MVP

A real-time multiplayer drawing and guessing game built with React, TypeScript, HTML Canvas, Node.js, Express and Socket.IO. The frontend and backend can be run together locally and deployed as **one Render Web Service**.

## MVP features implemented

- Create private invite-link rooms or public rooms; join by code or public lobby list.
- Host-configurable max players (2–20), rounds (2–10), draw time (15–240 seconds), word choices (1–5), hints (0–5), and normal/hidden word mode.
- Lobby player list, ready state, host-only start, host transfer when the host disconnects/leaves.
- Server-owned turn rotation, word selection, timer, exact case-insensitive guess matching, hints and scoring.
- Shared HTML Canvas with color palette, brush size, eraser, undo and clear.
- Live strokes via Socket.IO; masked secret word for guessers; drawer-only word options and secret word (except hidden mode).
- Chat, correct-guess notices, scoreboard, round reveal, final leaderboard and play again.
- Basic reconnect support for the same browser's stored player ID.
- `/health` endpoint and unit tests for guess normalization, word masking, scoring and word-bank size.

## Requirements

- Node.js 20+ (Node 22 recommended)
- npm 10+ (bundled with Node 22)

## Run locally

From the repository root:

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3001/health

Open the frontend in two or more separate browser windows/incognito sessions, enter different nicknames, create a room in one window, then join via the room code or invite URL. The host and all other connected players must mark ready before the host can start.

Production-style local run:

```bash
npm install
npm run build
npm start
```

Then open http://localhost:3001. The server serves the frontend build and the WebSocket endpoint from the same origin.

## Tests

```bash
npm test
```

## Deploy the full game to Render (recommended first deployment)

This repo is configured for a single Render web service. You do **not** need to deploy React, Express, Socket.IO or the word list separately.

1. Create a GitHub repository and push this project to it.
2. In Render, choose **New → Web Service** and connect the repository.
3. Set:
   - Runtime: Node
   - Build command: `npm install --include=dev && npm run build`
   - Start command: `npm start`
   - Health check path: `/health`
   - Node version: `22` (or use the included `.node-version`)
4. Deploy. Render will assign a URL similar to `https://doodle-party-xxxx.onrender.com`.
5. Open the URL from two different browsers/devices and complete a full game. Use the same URL for frontend and WebSocket traffic; no `VITE_SERVER_URL` is necessary in production.

`render.yaml` is included as an optional Blueprint configuration. If you create the service manually, use the dashboard settings above.

### What is hosted where?

| Component | Where it runs | Separate service? |
|---|---|---|
| React + Vite UI | Static files built into `client/dist`, served by Express | No |
| Express HTTP API / health endpoint | Render Web Service | No |
| Socket.IO real-time server | Same Render Web Service and process | No |
| Game room and score state | Server process memory | No, but it resets on restart |
| Word bank | `server/src/words.js` in the deployment image | No |
| Database | Not used in this MVP | No |
| Redis | Not used in this MVP | No |
| Image/file storage | Not used; drawings exist as strokes in room memory | No |
| Domain + TLS | Render-provided HTTPS domain initially | No |
| Source control / auto-deploy | GitHub connected to Render | GitHub account required |

## Optional split deployment

You may deploy the frontend to a static host and the backend to Render separately, but it adds configuration without helping this MVP. If you split them:

1. Deploy the backend directory as a Render Web Service with root directory `server`, build `npm install`, start `npm start`.
2. Deploy `client` to a static host such as Render Static Sites, set build command `npm install --include=dev && npm run build`, publish directory `dist`.
3. Set `VITE_SERVER_URL=https://YOUR-BACKEND.onrender.com` in the frontend build environment, rebuild/redeploy, and set `CLIENT_ORIGINS=https://YOUR-FRONTEND.onrender.com` in the backend environment.
4. Ensure WebSocket connections use `wss://` through the HTTPS backend URL.

Use the single-service option unless you have a reason to split it.

## Game rules and current scoring

- Each complete cycle through active players is one round; every active player gets a drawing turn per round.
- Correct guesses are exact after trimming, lowercasing and normalizing spaces; trailing punctuation is ignored.
- Guess points start at 100, decrease with elapsed drawing time, and have a minimum of 25.
- The drawer gets a 25-point bonus if at least one other player guesses correctly.
- A round ends when all connected guessers have guessed correctly or the timer expires.

These scoring rules are implementation choices for the assignment MVP; adjust them if your evaluator expects a different scoring system.

## Important limitations before production

This is a deployable assignment MVP, not a hardened production game service.

- All rooms, player scores, chat and strokes live in memory. Deploy restarts erase active games. Persistence is not included.
- Player identity is a browser-stored random ID and is not authentication. A public internet deployment can be spoofed or abused; do not use it for private/confidential sessions.
- There is no durable database, account system, moderation/ban list, spam protection beyond input bounds, observability, or automated load test suite.
- For multiple backend instances, use a shared room-state design plus a Socket.IO adapter such as Redis; a Socket.IO adapter by itself does not make in-memory game state shared.
- Free-host resource limits and sleeping behavior may affect responsiveness; confirm the selected host's current plan before a public demo.

## Suggested production hardening

1. Add authenticated player sessions and server-generated, signed player IDs.
2. Add Redis or another shared store for Socket.IO fan-out, rate limits, and/or room recovery; design how authoritative game state is shared before horizontal scaling.
3. Add persistent storage if active rooms or results must survive restarts.
4. Add structured logs, error reporting, rate limiting per socket/IP, input size limits and a load test with the expected concurrency.
5. Add tests for room/turn transitions, duplicate events, disconnects, hidden-word privacy and concurrent correct guesses.

## Architecture

- `client/src/App.tsx`: entry/lobby/game UI, room requests, chat and event wiring.
- `client/src/CanvasBoard.tsx`: HTML Canvas input/rendering and drawing toolbar.
- `client/src/types.ts`: frontend game payload types.
- `server/src/index.js`: Express, HTTP/Socket.IO bootstrap, static frontend hosting.
- `server/src/GameManager.js`: room membership, authoritative phases, turns, timer, scoring, validation and socket events.
- `server/src/words.js`: word list, normalization and hint masking.
- `server/src/scoring.js`: scoring formula.
- `server/test/game-utils.test.js`: unit tests.

## Main Socket.IO events

Client → server: `create_room`, `join_room`, `toggle_ready`, `start_game`, `word_chosen`, `guess`, `chat`, `draw_begin`, `draw_points`, `draw_end`, `draw_undo`, `canvas_clear`, `request_state`, `leave_room`, `play_again`.

Server → client: `game_state`, `public_rooms`, `player_joined`, `player_left`, `draw_started`, `draw_points`, `draw_finished`, `canvas_cleared`, `canvas_undone`, `chat_message`, `guess_result`.

The secret word is only included in the state payload sent to the current drawer, and word options are sent only to the drawer in word-selection phase. Guessers receive a masked word.
