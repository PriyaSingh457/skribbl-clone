# Deployment guide — Doodle Party

## Recommended: one Render Web Service

This is the simplest deploy because the app is configured for Express to serve the built React frontend and the Socket.IO server from the same Node process.

### What you need

- A GitHub account (to store and connect the source repository).
- A Render account (to build and host the app).
- Node.js 22 locally if you want to test before deploying.

No database, Redis, object storage, API key, payment account, or custom domain is required for the first assignment deployment.

### Step 1 — Create a GitHub repo

From inside the unzipped `skribbl-clone` folder:

```bash
git init
git add .
git commit -m "Build Doodle Party multiplayer game"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Create an empty repository on GitHub first; do not add a second README or license if you already have the files here.

### Step 2 — Create the Render Web Service

1. Open https://dashboard.render.com/ and connect GitHub if prompted.
2. Choose **New + → Web Service**.
3. Select the repository you just pushed.
4. Use the following settings:

| Setting | Value |
|---|---|
| Name | `doodle-party` or another available name |
| Runtime | Node |
| Branch | `main` |
| Root Directory | leave blank (repository root) |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Node version | `22` (or use `.node-version`) |

Select a plan. Free is acceptable for an assignment demo, but it may sleep after inactivity and the first new visit can take around a minute to wake. A paid always-on instance is better for a smoother demo. Check Render's current plans before choosing.

### Step 3 — Environment variables

No environment variables are required for the one-service deployment. Render provides `PORT`; the server reads it automatically.

Optional:

- `CLIENT_ORIGINS`: only relevant if you host the frontend at a different origin. Set it to the frontend origin, such as `https://your-frontend.onrender.com`.
- `PORT`: don't set manually unless your host specifically requires it.

### Step 4 — Confirm deployment

When the deployment finishes, use the URL shown by Render (for example `https://doodle-party-abc1.onrender.com`).

1. Open `/health`; expect JSON with `"ok": true`.
2. Open the main URL in one browser and create a **public** room.
3. Copy the room code, then open the main URL in an incognito window or on another device.
4. Join the room, enter two different player names, and click ready in both sessions.
5. Start the game from the host session.
6. Choose a word in the drawer session; confirm the other session sees only blanks.
7. Draw, guess, verify score updates, and continue until the final leaderboard appears.
8. Test private room access by copying its invite link to a second browser.

### Step 5 — Automatic redeploys

When Render is connected to GitHub, pushes to the selected branch can trigger deployments automatically. Commit and push future fixes to `main`, then watch the deployment logs and repeat the two-browser smoke test.

## Deployment map: which parts go where?

| Project part | Deploy destination | Configuration |
|---|---|---|
| React + TypeScript UI | Same Render Web Service; built to `client/dist` | Root build command compiles Vite; Express serves the built files |
| HTTP routes (`/health`, `/api/words/categories`) | Same Render Web Service | Express |
| Socket.IO / WebSockets | Same Render Web Service | Same host/origin as the frontend |
| Turn engine, room manager, timers and scoring | Same Node process | Server memory for MVP |
| Word bank | Packaged with the server source | No separate service |
| Draw strokes and chat | In-memory room objects | No file or image storage service |
| Database | None for the MVP | Add one only if persistence is required |
| Redis | None for one instance | Add a secured Redis service only if you implement cross-instance messaging/shared state |
| Source code | GitHub | Render deploys from this repo |
| HTTPS certificate / public URL | Render | Provided by Render's service domain |

## Alternative: split frontend and backend

Use this only when you specifically want separate scaling/deployment.

### Backend service

- Create a Render **Web Service** from this repository.
- Set Root Directory to `server`.
- Build command: `npm install`.
- Start command: `npm start`.
- Set `CLIENT_ORIGINS` to the exact frontend origin, such as `https://doodle-party-web.onrender.com`.
- Backend URL will look like `https://doodle-party-api.onrender.com`.

### Frontend static site

- Create a Render **Static Site** from the same repository.
- Root Directory: `client`.
- Build command: `npm install --include=dev && npm run build`.
- Publish directory: `dist`.
- Add build-time environment variable `VITE_SERVER_URL=https://doodle-party-api.onrender.com`.
- Deploy and open the frontend URL.

For static-site deployment, Socket.IO must connect to the backend's HTTPS origin (Socket.IO will use secure WebSockets). The client code already reads `VITE_SERVER_URL`. If you use a different frontend host, update `CLIENT_ORIGINS` with that origin and redeploy the backend.

## Important: demo vs production

The current server stores games in process memory. A restart or sleep/redeploy loses active games. It is intended for assignment evaluation and small live demos, not durable or horizontally scaled production. To make it production-ready, first add validated server-side player authentication, rate limiting and abuse protection, metrics/error reporting, integration/load tests, and a shared room-state strategy. Add persistent storage only if match history or data needs to survive restarts. A Redis Socket.IO adapter enables cross-server broadcast but does **not** by itself share the `GameManager`'s in-memory room state.

## If deploy fails

- **Build fails at `tsc`:** inspect the first TypeScript error. Ensure the repository root contains the root `package.json`, and that Render's root directory is blank.
- **Site shows a blank page:** inspect `npm run build` logs and the browser console; verify static files were built into `client/dist`.
- **`/health` works but game shows connecting:** inspect Render logs, confirm the Web Service is running, and verify no static-host-only deployment was selected.
- **Split frontend fails to connect:** verify `VITE_SERVER_URL` is present at build time and `CLIENT_ORIGINS` contains the frontend URL.
- **Game rooms disappear:** this is expected on server restart in the in-memory MVP; persistent/shared room state is a separate production hardening task.
