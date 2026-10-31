# PRD feature status in this codebase

## Implemented in the MVP

- Create private or public rooms; room code and invite URL.
- Join by room code or public-lobby list.
- Host-configurable settings within PRD ranges: player cap, rounds, draw duration, number of word choices, hints; normal and hidden modes.
- Lobby player list, ready status and host-only game start.
- Rotating drawing turns; word choices for the current drawer only.
- Real-time drawing strokes, palette, variable brush size, eraser, undo and clear.
- Exact normalized guess checking; correct-guess notification; timer and progressive hints.
- Server-controlled scores, per-round reveal, leaderboard, game winner and play again.
- General chat and guess messages.
- Public Render deployment configuration; health check and local test suite.

## Not yet implemented (PRD bonus or production hardening)

- Combination word mode.
- Avatars, spectator mode, replay, custom word lists, multiple languages.
- Host kick/ban/votekick/report controls.
- Authentication and signed player identity.
- Durable room/game persistence and cross-instance shared game state.
- Automated browser end-to-end suite and load test.
- Production logging/monitoring and advanced abuse prevention.

The PRD itself labels many of these as bonus ideas or nice-to-haves. They are intentionally not included before the core game flow is ready.
