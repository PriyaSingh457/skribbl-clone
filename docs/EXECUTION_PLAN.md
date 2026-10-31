# Skribbl.io Clone — Full Execution Plan

## 1. Objective

Build and publicly deploy an end-to-end multiplayer drawing and guessing game based on the supplied PRD. The core flow must work in production:

**Create/join room → lobby → start game → select word → draw live → guess → score → rotate turns → leaderboard and winner.**

This plan preserves the PRD's must-have scope, schedules should-have items next, and keeps bonus ideas out of the critical path until the complete core loop is stable.

## 2. Scope and priority

### Must-have scope

- Create a room with host-configurable settings.
- Join by room code or invitation URL.
- Lobby with player list; host starts the game.
- Support public and private rooms. For a minimal public-room implementation, show a list of joinable public rooms; full matchmaking is not necessary.
- One drawer per turn; rotate players through the configured rounds.
- Word picker for the drawer with 1–5 choices.
- Real-time drawing synchronization.
- Guess checking and correct-guess feedback.
- Scores, leaderboard, final winner.
- Brush/pen, color choices, brush width, undo and clear.
- Public deployment, README with live URL, architecture explanation, and code walkthrough readiness.

### Should-have scope

- Configurable draw-time countdown.
- Timed letter hints.
- Guess chat and optional general chat.
- Private invite link.
- Clear round-end state and reveal the word.

### Stretch scope — only after the core loop is reliable

- Word categories and multiple languages.
- Eraser as a dedicated tool.
- Host kick/ban and votekick.
- Custom word lists, avatars, spectator mode, replay, and optional hidden/combination word modes.

## 3. Recommended stack and deployment shape

- **Frontend:** React + TypeScript + Vite.
- **Canvas:** HTML5 Canvas API, with custom drawing logic.
- **Backend:** Node.js + Express + TypeScript.
- **Real-time:** Socket.IO on the same HTTP server.
- **Words:** a curated JSON word list at first; organize by category so categories can be added later.
- **Deployment:** one Render Web Service for the initial version. Build the Vite client and serve its static output through Express; serve HTTP health checks and Socket.IO from the same origin. Railway is a viable alternative.

Keeping frontend and backend in one deployable service minimizes CORS and configuration issues. Use a single backend instance and in-memory room state for the assignment MVP. This is simple but means active games disappear on process restart and rooms are not shared between multiple instances. If the product later needs multi-instance scaling or durable sessions, add Redis for shared state / Socket.IO adapter and a database for persistence.

## 4. Core engineering decisions to settle before coding

The PRD leaves some gameplay details open. Record the chosen rules in the README so behaviour is deterministic and explainable:

1. **Meaning of “rounds”:** recommended interpretation: one round is one complete cycle in which every active player has a drawing turn. A setting of 3 rounds means each player draws up to three times.
2. **When a turn ends:** recommended MVP behaviour: end immediately when the first valid guess is correct, or when the timer expires. This follows the PRD's “time runs out or word guessed” wording. If the evaluator expects all players to keep guessing, change this before implementation.
3. **Scoring:** the PRD does not define an exact formula. Recommended simple rule: the first correct guesser receives a speed-based award (for example, 50–100 points based on remaining time); the drawer receives a fixed bonus when the word is guessed; no guesser award is issued if time expires. Keep the formula in one server-side function so it can be adjusted safely.
4. **Joining an active game:** recommended MVP: prevent new players from joining an already-running game, or allow them as spectators only if that mode is implemented intentionally. Do not silently add active players to turn order mid-round.
5. **Disconnects:** keep a disconnected player's seat temporarily (e.g. 30 seconds) so a reconnect can resume; after the grace period, mark them left and skip their turn if needed.
6. **Public rooms:** the PRD has conflicting priority signals: core requirements mention public and private rooms, while a feature table calls public rooms optional. To be safe, provide simple public-room discovery in the core plan, but defer random matchmaking and advanced filtering.
7. **General chat:** guesses must be checked before being broadcast as ordinary chat; handle correct guesses privately/with a system message so the secret is not leaked accidentally.

## 5. Architecture

```text
React + TypeScript client
  ├─ Lobby / room settings / player list
  ├─ Game screen / score board / timer / chat
  └─ Canvas input + stroke renderer
             │ HTTPS + Socket.IO (WSS in production)
             ▼
Node.js + Express + Socket.IO server
  ├─ SocketAuth / InputValidation / RateLimiter
  ├─ RoomManager
  ├─ GameEngine
  ├─ DrawingService
  ├─ GuessingAndScoringService
  └─ WordService
             │
             └─ In-memory Room state + JSON word list
```

**Authoritative-server rule:** client events express intent, not facts. For example, a client can request `start_game`, but the server checks host identity, room phase, and readiness before changing state. A client must never be allowed to tell the server “I am the drawer”, “my score is 100”, or “the word is correct”.

### Game state machine

`LOBBY → WORD_SELECTION → DRAWING → ROUND_END → WORD_SELECTION (next turn) → ... → GAME_OVER`

The server owns the phase, current round, drawer, secret word, deadline, scores, turn order, and completed strokes. The client renders snapshots and events received from the server.

## 6. Data models

Use TypeScript interfaces/classes so room/game logic is testable independently of Socket.IO handlers.

```ts
type RoomVisibility = 'public' | 'private';
type GamePhase = 'lobby' | 'word_selection' | 'drawing' | 'round_end' | 'game_over';

interface RoomSettings {
  maxPlayers: number;       // 2..20
  rounds: number;           // 2..10
  drawTimeSeconds: number;  // 15..240
  wordChoiceCount: number;  // 1..5
  hintsEnabled: boolean;
  hintCount: number;        // 0..5
  wordMode: 'normal' | 'hidden' | 'combination';
}

interface Player {
  id: string;               // server-generated stable player ID
  socketId?: string;        // current connection, not permanent identity
  name: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  joinedAt: number;
}

interface Stroke {
  id: string;
  playerId: string;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>; // normalized 0..1 coordinates
}

interface RoomState {
  id: string;
  visibility: RoomVisibility;
  inviteToken?: string;
  hostPlayerId: string;
  settings: RoomSettings;
  players: Player[];
  phase: GamePhase;
  roundNumber: number;
  turnIndex: number;
  drawerPlayerId?: string;
  secretWord?: string;       // never broadcast to all clients
  wordOptions?: string[];    // drawer-only payload
  deadlineAt?: number;
  strokes: Stroke[];
  guessedPlayerIds: string[];
}
```

Use server-generated opaque room IDs or sufficiently random codes/tokens. Private-room URLs should contain an invite token, not the secret word or any privileged game state. Keep room IDs and invite tokens separate if invite revocation is needed later.

## 7. Socket.IO event contract

The PRD supplies a useful baseline. Keep its names if desired, but define payloads and authorization rules in a shared TypeScript event map to prevent client/server drift.

### Client → server

| Event | Payload (suggested) | Server checks |
|---|---|---|
| `create_room` | `{ playerName, visibility, settings }` | Validate name/settings; create host and room |
| `join_room` | `{ roomId, playerName, inviteToken? }` | Room exists; invite access; capacity; game phase |
| `player_ready` | `{ ready }` | Player is in lobby |
| `start_game` | `{}` | Host only; enough players; lobby phase |
| `word_chosen` | `{ wordId }` | Current drawer only; valid option; selection phase |
| `draw_start` | `{ strokeId, x, y, color, size }` | Drawer only; drawing phase; valid bounds |
| `draw_move` | `{ strokeId, points[] }` | Active drawer stroke; rate and payload limits |
| `draw_end` | `{ strokeId }` | Drawer only; active stroke exists |
| `canvas_clear` | `{}` | Drawer only; drawing phase |
| `draw_undo` | `{}` | Drawer only; drawing phase |
| `guess` | `{ text }` | Eligible non-drawer; drawing phase; text limits |
| `chat` | `{ text }` | In-room player; text limits and rate limit |
| `leave_room` | `{}` | Player belongs to room |

### Server → clients

| Event | Purpose |
|---|---|
| `room_created` | Return room code and invite URL to host |
| `room_state` | Safe, room-wide snapshot: players, settings, phase, scores |
| `player_joined` / `player_left` | Lobby/player-list updates |
| `game_state` | Phase/round/drawer/timer/hints, personalized where necessary |
| `round_start` | New turn; send word choices only to the drawer |
| `word_options` | Private event for current drawer only |
| `draw_data` | Broadcast normalized stroke data to room |
| `canvas_state` | Replay/snapshot of completed strokes after join or reconnection |
| `guess_result` | Correct/incorrect result and score update without exposing the secret prematurely |
| `chat_message` | Sanitized chat message or safe system message |
| `timer_update` | Server deadline / remaining time update |
| `round_end` | Reveal word, round result, current scores, next drawer |
| `game_over` | Winner and final leaderboard |
| `error` | Structured, safe error code/message for rejected actions |

### Critical security rule: do not leak the secret word

The PRD's illustrative `game_state` payload includes a `word` field, but it must not be broadcast unchanged to every client. Create **role-specific state payloads**:

- Drawer receives the selected word and valid word options while choosing.
- Guessers receive blanks, hints, timer, drawer identity, and public scores—but never the secret word before round end.
- Only the server evaluates submitted guesses.

Also enforce host-only start controls, drawer-only drawing/undo/clear/word selection, player caps, message limits, and rate limits. Never trust scores, drawer IDs, or round state supplied by clients.

## 8. Drawing implementation

1. Render one fixed logical canvas coordinate space, such as 1000 × 600. Store normalized coordinates (`x / width`, `y / height`) so clients with different canvas sizes draw in the same place.
2. Use Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) so mouse, touch and stylus use one input path. Map pointer coordinates into canvas coordinates and account for device pixel ratio when rendering.
3. On pointer down, start a stroke; while moving, batch points and send them frequently enough for smoothness; on release, finish the stroke. Throttle or batch events rather than sending an unbounded event for every raw device event.
4. Draw locally immediately for responsiveness, and broadcast accepted strokes through the server. The server validates and relays strokes to everyone in the room.
5. Keep the authoritative list of completed strokes server-side for the active round. `draw_undo` removes the last completed stroke and broadcasts the correction; `canvas_clear` empties the stroke list. Do not implement undo as a client-only visual change.
6. On new round, clear the drawing state. On reconnection, send `canvas_state` so the client can rebuild the canvas instead of relying only on events it received live.
7. Set limits for points per stroke and total stored points to prevent oversized payloads or memory abuse.

The server should broadcast the authoritative stroke data to all room members, including the drawer, to keep the rendered state consistent.

## 9. Guessing, hints, timer, and scoring

- Normalize a guess using trimming, whitespace collapse, and case-insensitive comparison. Use exact normalized equality for scoring; do not award points for arbitrary partial matches. Near-miss feedback can be added without revealing the answer.
- Do not let the drawer guess their own word for points.
- Only the server decides whether a guess is correct and records that the player has guessed.
- Store `deadlineAt` as an absolute server timestamp. Clients display a countdown from that deadline; the server decides when time expires. This avoids trusting a client's local timer.
- Schedule hint events on the server based on configured hint count and draw duration. Broadcast masked letters and keep unmasked letters server-only until round end.
- Keep all score calculations in one function with unit tests. Define the scoring formula before coding because it is not fully specified in the PRD.
- End a round exactly once, even if a correct guess and timer expiry happen nearly simultaneously. Clear all timers when the round or room ends.
- At game end, sort scores descending and define a tie-break rule (recommended: shared winner for equal top scores, or use earliest achievement of top score if the PRD owner requires one winner).

## 10. Frontend screens and components

1. **Home:** display name, create room, join by code, public-room list.
2. **Create-room panel:** visibility and validation for max players (2–20), rounds (2–10), draw time (15–240 seconds), word choice count (1–5), hints (0–5), and word mode.
3. **Join-room panel:** room code or invitation link, clear errors for full/missing/private rooms.
4. **Lobby:** room code/share link, players, ready state, host badge, settings summary and host-only Start button.
5. **Game screen:** canvas, drawing toolbar, player score list, current drawer, masked word/hints, timer, guess/chat input and round status.
6. **Round-end overlay:** reveal answer, points gained, score update and transition to next turn.
7. **Game-over screen:** winner, final leaderboard, play-again / return-to-lobby action.
8. **Connection state:** visible reconnecting indicator and recover/rejoin flow.

Separate reusable components (`CanvasBoard`, `DrawingToolbar`, `PlayerList`, `Scoreboard`, `ChatPanel`, `GameTimer`, `WordHint`, `RoomSettingsForm`) from socket and game-state logic. A small client-side state reducer/store should consume server snapshots and events; avoid scattering authoritative rule logic into UI components.

## 11. Backend code structure

```text
server/src/
  app.ts                 # Express app and static frontend hosting
  server.ts              # HTTP + Socket.IO bootstrap
  config/env.ts          # Environment validation
  sockets/
    registerHandlers.ts
    eventTypes.ts
    validatePayload.ts
  rooms/
    RoomManager.ts       # create/join/leave/cleanup and room lookup
    Room.ts              # participants, host, settings, broadcast helpers
  game/
    GameEngine.ts        # phase machine, turn order, timers, round lifecycle
    ScoringService.ts    # one scoring function
    GuessService.ts      # normalization and answer checking
    HintService.ts       # masked words and timed hints
  drawing/
    DrawingService.ts    # stroke validation, storage, undo, clear, snapshot
  words/
    WordService.ts       # categorized JSON word list and random choices
  middleware/
    rateLimit.ts
    errorHandler.ts
  tests/
```

Keep Socket.IO event handlers thin: validate input, call a domain service, and emit resulting server state. Prefer unit-testable classes (`Room`, `GameEngine`, `Player`, and message/event handler) as encouraged by the PRD's OOP bonus.

## 12. Development milestones

### Milestone 1 — Project foundation

- Create a clean repository with client and server packages, TypeScript, lint/format scripts, and environment configuration.
- Add a health endpoint, a basic Vite app, and a Socket.IO connection smoke test.
- Confirm local client/server development works before adding gameplay.

**Exit criteria:** app loads locally, socket connects, server health check passes.

### Milestone 2 — Room lifecycle and lobby

- Implement create/join/leave, room codes, public/private visibility, player identity, capacity validation and host assignment.
- Add settings form, lobby, player list, ready status and host-only start.
- Handle host departure by assigning a new host or closing the room using a documented policy.

**Exit criteria:** multiple browser tabs can create/join the same room and see accurate lobby updates.

### Milestone 3 — Server game engine

- Implement the phase machine, word options, drawer rotation, rounds, server deadlines, round-end and game-over states.
- Add scoring and tie-break functions with tests.
- Ensure a new round cleans all old drawing/timer/guess data.

**Exit criteria:** a complete game can run with mock draw/guess actions without desynchronizing.

### Milestone 4 — Canvas and real-time sync

- Build the canvas and tools, normalized stroke model, draw start/move/end, clear and undo.
- Add batching/throttling and authoritative server validation.
- Add canvas snapshot/replay for reconnecting participants.

**Exit criteria:** strokes, undo and clear match across several concurrent clients with different canvas dimensions.

### Milestone 5 — Guessing, chat, scoring and hints

- Add exact guess normalization, correct-guess notification, timer and scoring.
- Add optional general chat, timed hints, and round-end answer reveal.
- Verify that the word is never exposed to non-drawers before the round ends.

**Exit criteria:** correct guesses score once, invalid guesses do not affect score, hints are consistent, and rounds end exactly once.

### Milestone 6 — UX, edge cases and polish

- Handle refresh/reconnect, disconnect grace period, duplicate events, full rooms, invalid names, host leaving, and game termination.
- Add loading, empty, error and reconnecting states. Verify layout at desktop and mobile widths.
- Add rate limits and payload validation.

**Exit criteria:** the most common failure cases have predictable UI and server behaviour.

### Milestone 7 — Production deployment and handover

- Build the frontend in deployment and serve it through Express; set environment variables and production CORS/origin policy.
- Deploy to Render or Railway; validate HTTPS/WSS from a separate network and device.
- Add README setup steps, environment variables, architecture diagram, event flow, scoring rules, known limitations and public live URL.
- Prepare a brief code walkthrough for canvas sync, server-authoritative game state, scoring, and hosting.

**Exit criteria:** public core flow works end to end and the repository explains how to run, deploy and maintain it.

## 13. Testing strategy

### Unit tests

- Settings validation and player capacity.
- Room creation/join/leave and host reassignment.
- Valid phase transitions and drawer turn order.
- Word choice and secret-word visibility rules.
- Guess normalization, exact matching, duplicate guess prevention, scoring and tie handling.
- Timer expiry and duplicate round-end protection.
- Stroke validation, undo, clear and snapshot generation.

### Integration tests

- Host creates a room, a second player joins, and host starts.
- Drawer receives choices while guessers receive only blanks/hints.
- Drawer strokes appear on every client; undo/clear propagate to all.
- Correct guess produces the expected score and round transition.
- Incorrect guess and ordinary chat cannot reveal the answer.
- Disconnect/reconnect restores the player and canvas when within the grace window.

### Manual production smoke test

Use at least three separate browser sessions (ideally separate devices): create a private room; join with a link/code; start; choose a word; draw using mouse and touch if available; guess correctly/incorrectly; verify score; observe the next drawer; finish the game; confirm the winner screen. Repeat with a public room and a full-room attempt.

## 14. Acceptance checklist

- [ ] Create and join a room by code or invite link.
- [ ] Public/private visibility works according to the selected policy.
- [ ] Room settings enforce PRD limits.
- [ ] Lobby shows current players and only host can start.
- [ ] Only the selected drawer receives the secret word/options.
- [ ] Only the drawer can draw, undo, clear and choose the word.
- [ ] All clients see matching live strokes and canvas corrections.
- [ ] A reconnecting player can restore room/game/canvas state as specified.
- [ ] Correct and incorrect guesses are processed server-side.
- [ ] Scores and leaderboard match the written scoring rules.
- [ ] Timer, hints, round rotation and game end work reliably.
- [ ] Final winner/tie behaviour is deterministic.
- [ ] No unhandled server crash from invalid or oversized payloads.
- [ ] Public deployment supports HTTPS/WSS and the README contains the live URL.
- [ ] README explains architecture, how to run locally, deployment and known limitations.

## 15. Main risks and mitigations

| Risk | Mitigation |
|---|---|
| Secret word leaks to all clients | Role-specific server payloads; never put the word in room-wide state |
| Draw events overload sockets | Batch points, rate-limit events, cap stroke payloads |
| Clients disagree on canvas | Normalized coordinate space, server-owned stroke history, snapshots on reconnect |
| Timer fires twice / race conditions | Server-owned phase machine, idempotent round-end guard, clear timers |
| Players spoof actions or points | Validate role/phase and derive scores only on the server |
| Reconnect leaves stale player data | Stable player ID, socket rebinding, grace period and room cleanup |
| Memory grows indefinitely | Remove expired empty rooms; cap player messages and canvas points |
| Deployed server restart loses games | Document as MVP limitation; add shared persistence if durability is required |
| Public room requirement ambiguous | Implement simple discovery because core requirements mention public and private rooms |

## 16. Deployment notes

- Serve the Vite production build and Socket.IO from the same Node service for the simplest setup.
- Bind the HTTP server to `0.0.0.0` and use the platform-provided port.
- Use HTTPS for the site and WSS for real-time traffic.
- Add a health-check endpoint and structured logs for connections, room lifecycle and game transitions; do not log secret words or invite tokens unnecessarily.
- Lock production origins down; validate all client events on the server.
- Verify platform behaviour during redeploys and document that active in-memory games may be interrupted.
- Do not add a database, Redis, accounts/authentication or microservices unless requirements expand beyond this assignment.

## 17. What I would deliberately not build first

Do not begin with avatars, replay, multiple languages, votekick, complex moderation, persistent profiles, microservices or advanced animation. First make room → draw → guess → score → next turn → game over completely reliable. That core loop is the assignment's principal acceptance path.

## 18. Final definition of done

The project is done when a new user can open the deployed URL, create or join a room, play a full multiplayer game with synchronized drawing and correct scoring, see the final leaderboard, and follow the README to run the project locally. The developer should be able to explain the state machine, how stroke data moves through Socket.IO, how the server prevents cheating and word leaks, and how the deployed WebSocket service is configured.

## References

- Supplied PRD: *Intern Assignment: skribbl.io Clone* (7 pages).
- Socket.IO rooms: https://socket.io/docs/v4/rooms/
- Socket.IO connection-state recovery: https://socket.io/docs/v4/connection-state-recovery/
- Render WebSockets: https://render.com/docs/websocket
- MDN Pointer Events: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
