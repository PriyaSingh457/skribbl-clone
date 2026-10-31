import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GameManager, ALL_WORDS } from './GameManager.js';

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT) || 3001;
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../../');
const clientDist = resolve(projectRoot, 'client/dist');
const configuredOrigins = (process.env.CLIENT_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'skribbl-server', rooms: gameManager.rooms.size }));
app.get('/api/words/categories', (_req, res) => res.json({ categories: ['Animals', 'Food', 'Objects', 'Places', 'Actions', 'Nature'], count: ALL_WORDS.length }));

const io = new Server(httpServer, {
  cors: configuredOrigins.length ? { origin: configuredOrigins } : { origin: true },
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});
const gameManager = new GameManager(io);
io.on('connection', (socket) => gameManager.attachSocket(socket));

// The same service hosts the Vite production build to keep deployment to one web service.
app.use(express.static(clientDist, { fallthrough: true, maxAge: '1h' }));
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(resolve(clientDist, 'index.html'), (error) => { if (error) next(); });
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Doodle Party server listening on 0.0.0.0:${PORT}`));

function shutdown() {
  console.log('Shutting down server...');
  for (const room of gameManager.rooms.values()) gameManager.clearTimers(room);
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
