import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/GameManager.js';

class MockSocket {
  constructor(id) { this.id = id; this.data = {}; this.rooms = new Set(); this.events = []; }
  join(room) { this.rooms.add(room); }
  leave(room) { this.rooms.delete(room); }
  emit(event, payload) { this.events.push({ event, payload }); }
}
class MockIO {
  constructor() { this.events = []; }
  emit(event, payload) { this.events.push({ event, payload }); }
  to(room) { return { emit: (event, payload) => this.events.push({ room, event, payload }) }; }
}

test('room creation and join keep room state on the manager and validate capacity', () => {
  const io = new MockIO(); const manager = new GameManager(io);
  const host = new MockSocket('socket-host');
  const created = manager.createRoom(host, { playerName: 'Host', playerId: 'host-id', settings: { maxPlayers: 2 }, isPrivate: true });
  assert.equal(created.ok, true);
  const room = manager.rooms.get(created.roomId);
  assert.equal(room.players.length, 1);
  const guest = new MockSocket('socket-guest');
  const joined = manager.joinRoom(guest, { roomId: created.roomId, playerName: 'Guest', playerId: 'guest-id' });
  assert.equal(joined.ok, true);
  assert.equal(room.players.length, 2);
  const third = manager.joinRoom(new MockSocket('socket-third'), { roomId: created.roomId, playerName: 'Third', playerId: 'third-id' });
  assert.equal(third.ok, false);
  assert.match(third.error, /full/i);
});

test('secret word options are private to drawer and hidden from guessers', () => {
  const io = new MockIO(); const manager = new GameManager(io);
  const host = new MockSocket('socket-host'); const guest = new MockSocket('socket-guest');
  const created = manager.createRoom(host, { playerName: 'Host', playerId: 'host-id', settings: { drawTime: 15, hints: 1, wordCount: 3 }, isPrivate: true });
  manager.joinRoom(guest, { roomId: created.roomId, playerName: 'Guest', playerId: 'guest-id' });
  const room = manager.rooms.get(created.roomId);
  const guestPlayer = room.players.find((p) => p.id === 'guest-id'); guestPlayer.ready = true;
  manager.startGame(host);
  assert.equal(room.phase, 'word_selection');
  const drawer = room.drawerId === 'host-id' ? host : guest;
  const guesser = room.drawerId === 'host-id' ? guest : host;
  assert.equal(manager.stateFor(room, manager.playerFor(room, drawer)).wordOptions.length, 3);
  assert.deepEqual(manager.stateFor(room, manager.playerFor(room, guesser)).wordOptions, []);
  const options = room.wordOptions;
  manager.chooseWord(drawer, options[0]);
  assert.equal(room.phase, 'drawing');
  assert.equal(manager.stateFor(room, manager.playerFor(room, drawer)).secretWord, options[0]);
  assert.equal(manager.stateFor(room, manager.playerFor(room, guesser)).secretWord, null);
  assert.ok(manager.stateFor(room, manager.playerFor(room, guesser)).maskedWord.includes('_'));
  manager.clearTimers(room);
});

test('correct guess is scored server-side and only exact guesses count', () => {
  const io = new MockIO(); const manager = new GameManager(io);
  const host = new MockSocket('socket-host'); const guest = new MockSocket('socket-guest');
  const created = manager.createRoom(host, { playerName: 'Host', playerId: 'host-id', settings: { drawTime: 15, wordCount: 2 }, isPrivate: true });
  manager.joinRoom(guest, { roomId: created.roomId, playerName: 'Guest', playerId: 'guest-id' });
  const room = manager.rooms.get(created.roomId); room.players.forEach((p) => { p.ready = true; });
  manager.startGame(host);
  const drawer = room.drawerId === 'host-id' ? host : guest;
  const guesser = room.drawerId === 'host-id' ? guest : host;
  manager.chooseWord(drawer, room.wordOptions[0]);
  const wrong = manager.handleGuess(guesser, `${room.secretWord} extra`);
  assert.equal(wrong.correct, false);
  const result = manager.handleGuess(guesser, ` ${room.secretWord.toUpperCase()}! `);
  assert.equal(result.correct, true);
  assert.ok(result.points >= 25 && result.points <= 100);
  assert.ok(room.players.find((p) => p.id === guesser.data.playerId).score >= 25);
  manager.clearTimers(room);
});
