import { randomBytes } from 'node:crypto';
import { ALL_WORDS, maskWord, normalizeGuess, randomWords } from './words.js';
import { calculateGuessPoints } from './scoring.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_SETTINGS = { maxPlayers: 8, rounds: 3, drawTime: 80, wordCount: 3, hints: 2, wordMode: 'normal' };
const NAME_LIMIT = 18;
const CHAT_LIMIT = 200;
const POINT_LIMIT = 500;

function makeId(length = 10) {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length]).join('');
}
function cleanName(value) {
  return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, NAME_LIMIT) || 'Player';
}
function isFinitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((room) => !room.isPrivate && room.phase === 'lobby')
      .map((room) => ({ roomId: room.id, hostName: room.players.find((p) => p.id === room.hostId)?.name ?? 'Host',
        players: room.players.filter((p) => p.connected).length, maxPlayers: room.settings.maxPlayers,
        rounds: room.settings.rounds, drawTime: room.settings.drawTime }));
  }

  publishPublicRooms() { this.io.emit('public_rooms', this.listPublicRooms()); }

  validateSettings(input = {}) {
    const intInRange = (value, fallback, min, max) => {
      const number = Number(value);
      return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
    };
    return {
      maxPlayers: intInRange(input.maxPlayers, DEFAULT_SETTINGS.maxPlayers, 2, 20),
      rounds: intInRange(input.rounds, DEFAULT_SETTINGS.rounds, 2, 10),
      drawTime: intInRange(input.drawTime, DEFAULT_SETTINGS.drawTime, 15, 240),
      wordCount: intInRange(input.wordCount, DEFAULT_SETTINGS.wordCount, 1, 5),
      hints: intInRange(input.hints, DEFAULT_SETTINGS.hints, 0, 5),
      wordMode: input.wordMode === 'hidden' ? 'hidden' : 'normal'
    };
  }

  createRoom(socket, { playerName, playerId, settings, isPrivate } = {}) {
    const id = this.newRoomCode();
    const safePlayerId = String(playerId ?? '').slice(0, 80) || makeId(12);
    const player = { id: safePlayerId, name: cleanName(playerName), score: 0, ready: true, connected: true, socketId: socket.id, hasGuessed: false };
    const room = {
      id, isPrivate: Boolean(isPrivate), hostId: player.id, settings: this.validateSettings(settings), players: [player],
      phase: 'lobby', round: 0, turnIndex: -1, turnOrder: [], drawerId: null, secretWord: null, wordOptions: [],
      strokes: [], currentStrokeId: null, guessedIds: new Set(), hintLettersRevealed: 0, remainingTime: 0,
      startedAt: null, roundResult: null, chat: [], timer: null, phaseTimeout: null, closed: false
    };
    this.rooms.set(id, room);
    socket.join(id);
    socket.data.roomId = id;
    socket.data.playerId = player.id;
    this.emitRoomState(room);
    this.publishPublicRooms();
    return { ok: true, roomId: id, playerId: player.id };
  }

  newRoomCode() {
    let id;
    do { id = makeId(6); } while (this.rooms.has(id));
    return id;
  }

  joinRoom(socket, { roomId, playerName, playerId } = {}) {
    const id = String(roomId ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = this.rooms.get(id);
    if (!room || room.closed) return { ok: false, error: 'Room not found. Check the code and try again.' };
    const safePlayerId = String(playerId ?? '').slice(0, 80) || makeId(12);
    let player = room.players.find((entry) => entry.id === safePlayerId);
    if (player && player.connected) return { ok: false, error: 'This player session is already in the room.' };
    if (!player) {
      if (room.phase !== 'lobby') return { ok: false, error: 'This game has already started.' };
      // Clear abandoned lobby seats when a new player joins, while preserving reconnecting IDs.
      room.players = room.players.filter((entry) => entry.connected);
      if (!room.players.some((entry) => entry.id === room.hostId)) room.hostId = room.players[0]?.id ?? safePlayerId;
      if (room.players.filter((entry) => entry.connected).length >= room.settings.maxPlayers) return { ok: false, error: 'This room is full.' };
      player = { id: safePlayerId, name: cleanName(playerName), score: 0, ready: false, connected: true, socketId: socket.id, hasGuessed: false };
      room.players.push(player);
      this.io.to(room.id).emit('player_joined', { player: this.publicPlayer(player) });
    } else {
      player.name = cleanName(playerName || player.name);
      player.connected = true;
      player.socketId = socket.id;
    }
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.playerId = player.id;
    this.emitRoomState(room);
    this.publishPublicRooms();
    return { ok: true, roomId: room.id, playerId: player.id };
  }

  publicPlayer(player) {
    return { id: player.id, name: player.name, score: player.score, ready: player.ready, connected: player.connected, hasGuessed: player.hasGuessed };
  }

  playerFor(room, socket) {
    if (!room || socket.data.roomId !== room.id) return null;
    return room.players.find((player) => player.id === socket.data.playerId && player.socketId === socket.id && player.connected) ?? null;
  }

  roomFor(socket) { return this.rooms.get(socket.data.roomId); }

  stateFor(room, player) {
    const drawer = player?.id === room.drawerId;
    const guesserMaskCount = room.hintLettersRevealed;
    const ranked = [...room.players].sort((a, b) => b.score - a.score);
    return {
      roomId: room.id, isPrivate: room.isPrivate, hostId: room.hostId, settings: room.settings,
      players: room.players.map((entry) => this.publicPlayer(entry)), phase: room.phase, round: room.round,
      totalRounds: room.settings.rounds, drawerId: room.drawerId,
      drawerName: room.players.find((entry) => entry.id === room.drawerId)?.name ?? null,
      wordOptions: drawer && room.phase === 'word_selection' ? room.wordOptions : [],
      secretWord: drawer && room.secretWord && room.settings.wordMode !== 'hidden' ? room.secretWord : null,
      maskedWord: room.secretWord ? maskWord(room.secretWord, guesserMaskCount) : '',
      hintLettersRevealed: guesserMaskCount, remainingTime: room.remainingTime,
      strokes: room.strokes.map((stroke) => ({ ...stroke, points: [...stroke.points] })),
      roundResult: room.roundResult,
      chat: room.chat.slice(-60), leaderboard: ranked.map((entry) => this.publicPlayer(entry)),
      viewerId: player?.id ?? null, canDraw: drawer && room.phase === 'drawing',
      hasGuessed: room.guessedIds.has(player?.id),
      connectedPlayerCount: room.players.filter((entry) => entry.connected).length
    };
  }

  emitRoomState(room) {
    for (const player of room.players) {
      if (!player.connected || !player.socketId) continue;
      this.io.to(player.socketId).emit('game_state', this.stateFor(room, player));
    }
  }

  sendRoomStateToSocket(socket) {
    const room = this.roomFor(socket);
    const player = this.playerFor(room, socket);
    if (room && player) socket.emit('game_state', this.stateFor(room, player));
  }

  addChat(room, message) {
    room.chat.push({ id: makeId(8), playerId: message.playerId, playerName: message.playerName, text: message.text, kind: message.kind ?? 'chat', timestamp: Date.now() });
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
  }

  handleReady(socket, ready) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || room.phase !== 'lobby') return { ok: false, error: 'Ready status can only change in the lobby.' };
    player.ready = Boolean(ready);
    this.emitRoomState(room);
    return { ok: true };
  }

  startGame(socket) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.hostId) return { ok: false, error: 'Only the host can start the game.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'The game has already started.' };
    const activePlayers = room.players.filter((entry) => entry.connected);
    if (activePlayers.length < 2) return { ok: false, error: 'At least two players are required.' };
    const notReady = activePlayers.filter((entry) => !entry.ready);
    if (notReady.length) return { ok: false, error: 'Everyone must be ready before the host starts.' };
    for (const entry of room.players) { entry.score = 0; entry.hasGuessed = false; }
    room.turnOrder = activePlayers.map((entry) => entry.id);
    room.turnIndex = -1;
    room.round = 1;
    room.chat = [];
    this.nextTurn(room);
    return { ok: true };
  }

  chooseWord(socket, selectedWord) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || room.phase !== 'word_selection' || player.id !== room.drawerId) return { ok: false, error: 'Only the current drawer can choose a word.' };
    const chosen = String(selectedWord ?? '').trim().toLocaleLowerCase('en-US');
    if (!room.wordOptions.includes(chosen)) return { ok: false, error: 'Choose one of the offered words.' };
    this.startDrawing(room, chosen);
    return { ok: true };
  }

  nextTurn(room) {
    this.clearTimers(room);
    if (room.phase === 'game_over') return;
    const maxAttempts = room.turnOrder.length;
    let attempts = 0;
    while (attempts < maxAttempts) {
      room.turnIndex += 1;
      if (room.turnIndex >= room.turnOrder.length) {
        room.turnIndex = 0;
        room.round += 1;
      }
      if (room.round > room.settings.rounds) {
        this.finishGame(room);
        return;
      }
      const nextPlayer = room.players.find((entry) => entry.id === room.turnOrder[room.turnIndex]);
      if (nextPlayer?.connected) break;
      attempts += 1;
    }
    const drawer = room.players.find((entry) => entry.id === room.turnOrder[room.turnIndex]);
    if (!drawer?.connected) { this.finishGame(room); return; }
    room.drawerId = drawer.id;
    room.phase = 'word_selection';
    room.secretWord = null;
    room.wordOptions = randomWords(room.settings.wordCount).map((word) => word.toLocaleLowerCase('en-US'));
    room.strokes = [];
    room.currentStrokeId = null;
    room.guessedIds = new Set();
    room.hintLettersRevealed = 0;
    room.remainingTime = room.settings.drawTime;
    room.startedAt = null;
    room.roundResult = null;
    this.addChat(room, { playerId: 'system', playerName: 'Game', text: `${drawer.name} is choosing a word.`, kind: 'system' });
    this.emitRoomState(room);
    // Avoid a permanently stuck round if the drawer leaves the word-selection screen.
    room.phaseTimeout = setTimeout(() => {
      if (room.phase === 'word_selection') this.startDrawing(room, room.wordOptions[Math.floor(Math.random() * room.wordOptions.length)]);
    }, 20000);
    this.publishPublicRooms();
  }

  startDrawing(room, word) {
    this.clearTimers(room);
    room.phase = 'drawing';
    room.secretWord = word;
    room.startedAt = Date.now();
    room.remainingTime = room.settings.drawTime;
    room.strokes = [];
    room.currentStrokeId = null;
    room.hintLettersRevealed = 0;
    room.guessedIds = new Set([room.drawerId]);
    for (const entry of room.players) entry.hasGuessed = entry.id === room.drawerId;
    this.addChat(room, { playerId: 'system', playerName: 'Game', text: 'The drawing round has started!', kind: 'system' });
    this.emitRoomState(room);
    room.timer = setInterval(() => {
      if (room.phase !== 'drawing') { this.clearTimers(room); return; }
      room.remainingTime = Math.max(0, room.settings.drawTime - Math.floor((Date.now() - room.startedAt) / 1000));
      const elapsed = room.settings.drawTime - room.remainingTime;
      if (room.settings.hints > 0) {
        const targetHintCount = Math.min(room.settings.hints, Math.floor(elapsed / (room.settings.drawTime / (room.settings.hints + 1))));
        if (targetHintCount > room.hintLettersRevealed) room.hintLettersRevealed = targetHintCount;
      }
      this.emitRoomState(room);
      if (room.remainingTime <= 0) this.finishRound(room, 'time_up');
    }, 1000);
  }

  handleGuess(socket, rawText) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    const text = String(rawText ?? '').trim().slice(0, CHAT_LIMIT);
    if (!room || !player || !text) return { ok: false, error: 'Enter a guess first.' };
    if (room.phase !== 'drawing') return { ok: false, error: 'Guesses are only accepted during a drawing round.' };
    if (player.id === room.drawerId) return { ok: false, error: 'The drawer cannot guess their own word.' };
    if (room.guessedIds.has(player.id)) return { ok: false, error: 'You have already guessed correctly.' };
    const correct = normalizeGuess(text) === normalizeGuess(room.secretWord);
    if (!correct) {
      this.addChat(room, { playerId: player.id, playerName: player.name, text, kind: 'guess' });
      this.io.to(room.id).emit('chat_message', room.chat.at(-1));
      return { ok: true, correct: false };
    }
    const elapsed = (Date.now() - room.startedAt) / 1000;
    const points = calculateGuessPoints({ drawTimeSeconds: room.settings.drawTime, elapsedSeconds: elapsed });
    player.score += points;
    room.guessedIds.add(player.id);
    player.hasGuessed = true;
    const message = { playerId: player.id, playerName: player.name, text: `${player.name} guessed the word!`, kind: 'correct', points, timestamp: Date.now() };
    this.addChat(room, message);
    this.io.to(room.id).emit('guess_result', { correct: true, playerId: player.id, playerName: player.name, points, guessedCount: room.guessedIds.size - 1 });
    this.io.to(room.id).emit('chat_message', room.chat.at(-1));
    const guessersCount = room.players.filter((entry) => entry.connected && entry.id !== room.drawerId).length;
    this.emitRoomState(room);
    if (room.guessedIds.size - 1 >= guessersCount) this.finishRound(room, 'all_guessed');
    return { ok: true, correct: true, points };
  }

  handleChat(socket, rawText) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    const text = String(rawText ?? '').trim().slice(0, CHAT_LIMIT);
    if (!room || !player || !text) return { ok: false, error: 'Message cannot be empty.' };
    if (room.phase === 'game_over') return { ok: false, error: 'The game has ended.' };
    this.addChat(room, { playerId: player.id, playerName: player.name, text, kind: 'chat' });
    this.io.to(room.id).emit('chat_message', room.chat.at(-1));
    return { ok: true };
  }

  handleDrawBegin(socket, payload = {}) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.drawerId || room.phase !== 'drawing') return { ok: false, error: 'Only the current drawer can draw.' };
    if (room.currentStrokeId) return { ok: false, error: 'Finish the current stroke first.' };
    const id = String(payload.id ?? '').slice(0, 80);
    const size = Number(payload.size);
    const color = String(payload.color ?? '#172033').slice(0, 20);
    const eraser = Boolean(payload.eraser);
    if (!id || !Number.isFinite(size) || size < 1 || size > 50 || !/^#[0-9a-f]{3,8}$/i.test(color)) return { ok: false, error: 'Invalid drawing stroke.' };
    const stroke = { id, color, size, eraser, points: [], complete: false };
    room.strokes.push(stroke);
    room.currentStrokeId = id;
    this.io.to(room.id).emit('draw_started', { stroke: { ...stroke, points: [] } });
    return { ok: true };
  }

  handleDrawPoints(socket, rawPoints) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.drawerId || room.phase !== 'drawing') return { ok: false, error: 'Drawing is not allowed now.' };
    const stroke = room.strokes.find((entry) => entry.id === room.currentStrokeId);
    if (!stroke) return { ok: false, error: 'Start a stroke first.' };
    const points = Array.isArray(rawPoints) ? rawPoints.slice(0, 100).filter(isFinitePoint) : [];
    if (!points.length) return { ok: false, error: 'Invalid drawing points.' };
    const remaining = POINT_LIMIT - stroke.points.length;
    if (remaining <= 0) return { ok: false, error: 'This stroke reached the point limit. Start a new stroke.' };
    stroke.points.push(...points.slice(0, remaining));
    this.io.to(room.id).emit('draw_points', { id: stroke.id, points });
    return { ok: true };
  }

  handleDrawEnd(socket) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.drawerId || room.phase !== 'drawing') return { ok: false, error: 'Drawing is not allowed now.' };
    const stroke = room.strokes.find((entry) => entry.id === room.currentStrokeId);
    if (!stroke) return { ok: false, error: 'No active stroke.' };
    stroke.complete = true;
    room.currentStrokeId = null;
    this.io.to(room.id).emit('draw_finished', { id: stroke.id });
    return { ok: true };
  }

  handleUndo(socket) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.drawerId || room.phase !== 'drawing') return { ok: false, error: 'Only the drawer can undo.' };
    if (room.currentStrokeId) return { ok: false, error: 'Finish the current stroke before undoing.' };
    const index = room.strokes.map((stroke) => stroke.complete).lastIndexOf(true);
    if (index < 0) return { ok: false, error: 'Nothing to undo.' };
    const [removed] = room.strokes.splice(index, 1);
    this.io.to(room.id).emit('canvas_undone', { id: removed.id, strokes: room.strokes });
    return { ok: true };
  }

  handleClear(socket) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.drawerId || room.phase !== 'drawing') return { ok: false, error: 'Only the drawer can clear the canvas.' };
    room.strokes = [];
    room.currentStrokeId = null;
    this.io.to(room.id).emit('canvas_cleared', {});
    return { ok: true };
  }

  finishRound(room, reason) {
    if (room.phase !== 'drawing') return;
    this.clearTimers(room);
    room.phase = 'round_end';
    room.remainingTime = 0;
    if (room.currentStrokeId) {
      const active = room.strokes.find((stroke) => stroke.id === room.currentStrokeId);
      if (active) active.complete = true;
      room.currentStrokeId = null;
    }
    const drawer = room.players.find((entry) => entry.id === room.drawerId);
    const correctGuessers = room.players.filter((entry) => room.guessedIds.has(entry.id) && entry.id !== room.drawerId);
    let drawerBonus = 0;
    if (correctGuessers.length > 0 && drawer) { drawerBonus = 25; drawer.score += drawerBonus; }
    room.roundResult = { word: room.secretWord, reason, drawerId: room.drawerId, drawerName: drawer?.name ?? 'Drawer', correctGuessers: correctGuessers.map((entry) => entry.name), drawerBonus };
    this.addChat(room, { playerId: 'system', playerName: 'Game', text: `The word was “${room.secretWord}”.`, kind: 'system' });
    this.emitRoomState(room);
    room.phaseTimeout = setTimeout(() => this.nextTurn(room), 4500);
  }

  finishGame(room) {
    this.clearTimers(room);
    room.phase = 'game_over';
    room.drawerId = null;
    room.wordOptions = [];
    room.currentStrokeId = null;
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    const winner = sorted[0] ? { id: sorted[0].id, name: sorted[0].name, score: sorted[0].score } : null;
    room.roundResult = { winner, reason: 'game_over', leaderboard: sorted.map((player) => this.publicPlayer(player)) };
    this.addChat(room, { playerId: 'system', playerName: 'Game', text: winner ? `${winner.name} wins the game!` : 'Game over!', kind: 'system' });
    this.emitRoomState(room);
    this.publishPublicRooms();
  }

  clearTimers(room) {
    if (room.timer) clearInterval(room.timer);
    if (room.phaseTimeout) clearTimeout(room.phaseTimeout);
    room.timer = null;
    room.phaseTimeout = null;
  }

  leaveRoom(socket) {
    const room = this.roomFor(socket);
    const player = this.playerFor(room, socket);
    if (!room || !player) return { ok: false, error: 'You are not in a room.' };
    const wasDrawer = ['drawing', 'word_selection'].includes(room.phase) && player.id === room.drawerId;
    socket.leave(room.id);
    player.connected = false;
    player.socketId = null;
    if (room.phase === 'lobby') room.players = room.players.filter((entry) => entry.id !== player.id);
    if (room.hostId === player.id) room.hostId = room.players.find((entry) => entry.connected)?.id ?? room.hostId;
    socket.data.roomId = null;
    socket.data.playerId = null;
    if (wasDrawer && room.phase === 'drawing') this.finishRound(room, 'drawer_left');
    else if (wasDrawer && room.phase === 'word_selection') this.nextTurn(room);
    else if (room.phase === 'drawing') {
      const remaining = room.players.filter((entry) => entry.connected && entry.id !== room.drawerId);
      if (remaining.length > 0 && remaining.every((entry) => room.guessedIds.has(entry.id))) this.finishRound(room, 'all_guessed');
    }
    if (!room.players.some((entry) => entry.connected)) {
      this.clearTimers(room); room.closed = true; this.rooms.delete(room.id);
    } else this.emitRoomState(room);
    this.publishPublicRooms();
    return { ok: true };
  }

  playAgain(socket) {
    const room = this.roomFor(socket); const player = this.playerFor(room, socket);
    if (!room || !player || player.id !== room.hostId) return { ok: false, error: 'Only the host can restart the game.' };
    if (room.phase !== 'game_over') return { ok: false, error: 'The current game has not ended.' };
    this.clearTimers(room);
    room.phase = 'lobby'; room.round = 0; room.turnIndex = -1; room.turnOrder = []; room.drawerId = null;
    room.secretWord = null; room.wordOptions = []; room.strokes = []; room.currentStrokeId = null; room.guessedIds = new Set();
    room.remainingTime = 0; room.startedAt = null; room.roundResult = null; room.chat = [];
    for (const entry of room.players) { entry.score = 0; entry.hasGuessed = false; if (entry.connected) entry.ready = entry.id === room.hostId; }
    this.emitRoomState(room); this.publishPublicRooms();
    return { ok: true };
  }

  disconnect(socket) {
    const room = this.roomFor(socket);
    const player = this.playerFor(room, socket);
    if (!room || !player) return;
    player.connected = false;
    player.socketId = null;
    if (['drawing', 'word_selection'].includes(room.phase) && player.id === room.drawerId) {
      if (room.phase === 'drawing') this.finishRound(room, 'drawer_disconnected');
      else this.nextTurn(room);
    } else {
      this.io.to(room.id).emit('player_left', { playerId: player.id, playerName: player.name });
      // If a guesser leaves, do not block a round from ending indefinitely.
      if (room.phase === 'drawing') {
        const connectedGuessers = room.players.filter((entry) => entry.connected && entry.id !== room.drawerId);
        const allRemainingGuessed = connectedGuessers.every((entry) => room.guessedIds.has(entry.id));
        if (connectedGuessers.length > 0 && allRemainingGuessed) this.finishRound(room, 'all_guessed');
      }
      this.emitRoomState(room);
    }
    if (!room.players.some((entry) => entry.connected)) {
      this.clearTimers(room);
      room.closed = true;
      this.rooms.delete(room.id);
    } else if (room.hostId === player.id) {
      room.hostId = room.players.find((entry) => entry.connected)?.id ?? room.hostId;
      this.emitRoomState(room);
    }
    this.publishPublicRooms();
  }

  attachSocket(socket) {
    socket.on('list_rooms', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, rooms: this.listPublicRooms() });
      socket.emit('public_rooms', this.listPublicRooms());
    });
    socket.on('create_room', (payload, ack) => this.respond(ack, () => this.createRoom(socket, payload)));
    socket.on('join_room', (payload, ack) => this.respond(ack, () => this.joinRoom(socket, payload)));
    socket.on('toggle_ready', (payload, ack) => this.respond(ack, () => this.handleReady(socket, payload?.ready)));
    socket.on('start_game', (payload, ack) => this.respond(ack, () => this.startGame(socket)));
    socket.on('word_chosen', (payload, ack) => this.respond(ack, () => this.chooseWord(socket, payload?.word)));
    socket.on('guess', (payload, ack) => this.respond(ack, () => this.handleGuess(socket, payload?.text)));
    socket.on('chat', (payload, ack) => this.respond(ack, () => this.handleChat(socket, payload?.text)));
    socket.on('draw_begin', (payload, ack) => this.respond(ack, () => this.handleDrawBegin(socket, payload)));
    socket.on('draw_points', (payload, ack) => this.respond(ack, () => this.handleDrawPoints(socket, payload?.points)));
    socket.on('draw_end', (payload, ack) => this.respond(ack, () => this.handleDrawEnd(socket)));
    socket.on('draw_undo', (payload, ack) => this.respond(ack, () => this.handleUndo(socket)));
    socket.on('canvas_clear', (payload, ack) => this.respond(ack, () => this.handleClear(socket)));
    socket.on('request_state', () => this.sendRoomStateToSocket(socket));
    socket.on('leave_room', (payload, ack) => this.respond(ack, () => this.leaveRoom(socket)));
    socket.on('play_again', (payload, ack) => this.respond(ack, () => this.playAgain(socket)));
    socket.on('disconnect', () => this.disconnect(socket));
  }

  respond(ack, callback) {
    try {
      const result = callback();
      if (typeof ack === 'function') ack(result);
    } catch (error) {
      console.error('Socket event error:', error);
      if (typeof ack === 'function') ack({ ok: false, error: 'Unexpected server error.' });
    }
  }
}

export { ALL_WORDS };
