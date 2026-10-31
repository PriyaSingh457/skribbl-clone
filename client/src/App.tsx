import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import CanvasBoard from './CanvasBoard';
import type { GameState, PublicRoom, Settings, ChatMessage, Player } from './types';

const initialSettings: Settings = { maxPlayers: 8, rounds: 3, drawTime: 80, wordCount: 3, hints: 2, wordMode: 'normal' };
const playerStorageKey = 'doodle-party-player-id';
function getPlayerId() {
  let id = localStorage.getItem(playerStorageKey);
  if (!id) { id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; localStorage.setItem(playerStorageKey, id); }
  return id;
}
const playerId = getPlayerId();

export default function App() {
  const socket = useMemo<Socket>(() => io(import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : undefined), { autoConnect: false, reconnection: true, reconnectionAttempts: Infinity }), []);
  const [connected, setConnected] = useState(false);
  const [playerName, setPlayerName] = useState(localStorage.getItem('doodle-party-name') ?? '');
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get('room') ?? '');
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [isPrivate, setIsPrivate] = useState(true);
  const [game, setGame] = useState<GameState | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [guess, setGuess] = useState('');
  const [chatText, setChatText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const joinedRoomRef = useRef<string | null>(null);

  const notify = useCallback((message: string) => {
    setError(message);
    if (message) window.setTimeout(() => setError((current) => current === message ? '' : current), 4200);
  }, []);
  const request = useCallback(<T,>(event: string, payload?: unknown) => new Promise<T>((resolve, reject) => {
    if (!socket.connected) { reject(new Error('Connecting to game server. Please try again in a moment.')); return; }
    socket.timeout(5000).emit(event, payload, (timeoutError: Error | null, response: { ok?: boolean; error?: string } & T) => {
      if (timeoutError) { reject(new Error('The server did not respond. Please try again.')); return; }
      if (!response?.ok) { reject(new Error(response?.error ?? 'Something went wrong.')); return; }
      resolve(response as T);
    });
  }), [socket]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const priorRoom = joinedRoomRef.current;
      const inviteRoom = new URLSearchParams(window.location.search).get('room');
      const savedName = localStorage.getItem('doodle-party-name');
      if (priorRoom) {
        socket.emit('join_room', { roomId: priorRoom, playerName: localStorage.getItem('doodle-party-name') ?? 'Player', playerId }, (response: { ok?: boolean; error?: string }) => {
          if (!response?.ok) { joinedRoomRef.current = null; setGame(null); if (response?.error) notify(response.error); }
        });
      } else if (inviteRoom && savedName) {
        socket.emit('join_room', { roomId: inviteRoom, playerName: savedName, playerId }, (response: { ok?: boolean; error?: string }) => {
          if (!response?.ok && response?.error) notify(response.error);
        });
      } else socket.emit('list_rooms');
    };
    const onDisconnect = () => setConnected(false);
    const onState = (state: GameState) => {
      setGame(state);
      joinedRoomRef.current = state.roomId;
      setRoomCode(state.roomId);
      const url = new URL(window.location.href);
      url.searchParams.set('room', state.roomId);
      window.history.replaceState({}, '', url);
    };
    const onRooms = (rooms: PublicRoom[]) => setPublicRooms(rooms);
    const onChat = (message: ChatMessage) => setGame((current) => {
      if (!current || current.chat.some((entry) => entry.id === message.id)) return current;
      return { ...current, chat: [...current.chat, message].slice(-60) };
    });
    const onGuessResult = (result: { correct: boolean; playerName: string; points: number }) => {
      if (result.correct) setToast(`${result.playerName} guessed correctly! +${result.points} points`);
    };
    const onPlayerJoined = (data: { player: Player }) => setToast(`${data.player.name} joined the room`);
    const onPlayerLeft = (data: { playerName: string }) => setToast(`${data.playerName} disconnected`);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('game_state', onState);
    socket.on('public_rooms', onRooms);
    socket.on('chat_message', onChat);
    socket.on('guess_result', onGuessResult);
    socket.on('player_joined', onPlayerJoined);
    socket.on('player_left', onPlayerLeft);
    socket.connect();
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('game_state', onState);
      socket.off('public_rooms', onRooms); socket.off('chat_message', onChat); socket.off('guess_result', onGuessResult);
      socket.off('player_joined', onPlayerJoined); socket.off('player_left', onPlayerLeft); socket.disconnect();
    };
  }, [socket, notify]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [game?.chat.length]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const currentPlayer = game?.players.find((player) => player.id === playerId);
  const isHost = Boolean(game && game.hostId === playerId);
  const canStart = Boolean(game && game.players.filter((player) => player.connected).length >= 2 && game.players.filter((player) => player.connected).every((player) => player.ready));

  const createRoom = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const name = playerName.trim().slice(0, 18);
    if (!name) { notify('Enter your name first.'); return; }
    localStorage.setItem('doodle-party-name', name);
    try {
      await request<{ roomId: string; playerId: string }>('create_room', { playerName: name, playerId, settings, isPrivate });
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not create room.'); }
  };
  const joinRoom = async (code = roomCode) => {
    setError('');
    const name = playerName.trim().slice(0, 18);
    if (!name) { notify('Enter your name first.'); return; }
    if (!code.trim()) { notify('Enter a room code.'); return; }
    localStorage.setItem('doodle-party-name', name);
    try { await request<{ roomId: string; playerId: string }>('join_room', { roomId: code, playerName: name, playerId }); }
    catch (err) { notify(err instanceof Error ? err.message : 'Could not join room.'); }
  };
  const action = async (event: string, payload?: unknown) => {
    setError('');
    try { await request(event, payload); }
    catch (err) { notify(err instanceof Error ? err.message : 'Action failed.'); }
  };
  const leaveRoom = async () => {
    try { await request('leave_room'); } catch { /* resetting the view is still useful if a connection dropped */ }
    setGame(null); joinedRoomRef.current = null; setGuess(''); setChatText('');
    const url = new URL(window.location.href); url.searchParams.delete('room'); window.history.replaceState({}, '', url);
    socket.emit('list_rooms');
  };
  const copyInvite = async () => {
    const inviteUrl = `${window.location.origin}/?room=${game?.roomId}`;
    try { await navigator.clipboard.writeText(inviteUrl); setToast('Invite link copied!'); }
    catch { setToast(inviteUrl); }
  };
  const sendGuess = async (event: FormEvent) => {
    event.preventDefault();
    if (!guess.trim()) return;
    try { await action('guess', { text: guess }); setGuess(''); }
    catch { /* action displays an error */ }
  };
  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    if (!chatText.trim()) return;
    await action('chat', { text: chatText }); setChatText('');
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => { if (game) { event.preventDefault(); void leaveRoom(); } }}>
        <span className="brand-icon">✎</span><span>Doodle<span className="brand-accent">Party</span></span><span className="beta-tag">BETA</span>
      </a>
      <div className="topbar-right"><span className={`connection-pill ${connected ? 'online' : 'offline'}`}><i />{connected ? 'Connected' : 'Connecting…'}</span>{game && <button className="subtle-button" onClick={() => void leaveRoom()}>Leave room</button>}</div>
    </header>

    {!game ? <main className="home-layout">
      <section className="hero-panel">
        <div className="eyebrow"><span className="eyebrow-dot" /> REAL-TIME DRAWING GAME</div>
        <h1>Draw it.<br /><span>Guess it.</span><br />Own the lobby.</h1>
        <p className="hero-copy">Grab your friends, sketch the unexpected, and see who can guess their way to the top.</p>
        <div className="hero-pills"><span>✦ Up to 20 players</span><span>◉ Live multiplayer</span><span>♡ Free to play</span></div>
        <div className="doodle-stage" aria-hidden="true">
          <div className="doodle-card card-one"><span className="doodle-label">WHAT IS THIS?</span><svg viewBox="0 0 180 110"><path d="M46 83 C28 59 49 35 71 48 C79 18 118 31 112 52 C141 47 150 76 126 84 Z" fill="none" stroke="#e87938" strokeWidth="5" strokeLinecap="round"/><path d="M78 48 L83 29 M98 48 L106 32" stroke="#e87938" strokeWidth="4" strokeLinecap="round"/><path d="M88 87 L88 99 M106 86 L106 99" stroke="#e87938" strokeWidth="5" strokeLinecap="round"/></svg><span className="scribble-answer">a tiny cloud?</span></div>
          <div className="doodle-card card-two"><span className="doodle-label">QUICK, GUESS!</span><svg viewBox="0 0 160 100"><path d="M37 73 L53 48 L69 73 L88 35 L119 73 Z" fill="none" stroke="#28a58c" strokeWidth="5" strokeLinejoin="round"/><circle cx="104" cy="22" r="11" fill="none" stroke="#28a58c" strokeWidth="4"/></svg><span className="scribble-answer">mountain?</span></div>
          <div className="floating-spark spark-a">✦</div><div className="floating-spark spark-b">✳</div><div className="floating-spark spark-c">✧</div>
        </div>
      </section>

      <section className="entry-column">
        <div className="entry-card">
          <div className="card-kicker">LET'S PLAY</div><h2>Jump into the fun</h2><p className="muted">Choose a name so your friends know it's you.</p>
          <label className="field-label" htmlFor="playerName">YOUR NICKNAME</label>
          <input id="playerName" className="text-input" maxLength={18} placeholder="e.g. DoodleMaster" value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
          <div className="entry-divider"><span>CREATE A NEW ROOM</span></div>
          <form onSubmit={createRoom}>
            <div className="settings-grid">
              <label className="setting-field">Players <select value={settings.maxPlayers} onChange={(event) => setSettings({ ...settings, maxPlayers: Number(event.target.value) })}>{[2,4,6,8,10,12,16,20].map((n) => <option key={n} value={n}>{n} players</option>)}</select></label>
              <label className="setting-field">Rounds <select value={settings.rounds} onChange={(event) => setSettings({ ...settings, rounds: Number(event.target.value) })}>{[2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={n}>{n} rounds</option>)}</select></label>
              <label className="setting-field">Draw time <select value={settings.drawTime} onChange={(event) => setSettings({ ...settings, drawTime: Number(event.target.value) })}>{[30,45,60,80,90,120,180,240].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
              <label className="setting-field">Word choices <select value={settings.wordCount} onChange={(event) => setSettings({ ...settings, wordCount: Number(event.target.value) })}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} word{n > 1 ? 's' : ''}</option>)}</select></label>
              <label className="setting-field">Hints <select value={settings.hints} onChange={(event) => setSettings({ ...settings, hints: Number(event.target.value) })}>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n === 0 ? 'Disabled' : n}</option>)}</select></label>
              <label className="setting-field">Word mode <select value={settings.wordMode} onChange={(event) => setSettings({ ...settings, wordMode: event.target.value as Settings['wordMode'] })}><option value="normal">Normal</option><option value="hidden">Hidden</option></select></label>
            </div>
            <label className="privacy-toggle"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} /><span className="toggle-track"/><span><strong>{isPrivate ? 'Private room' : 'Public room'}</strong><small>{isPrivate ? 'Only people with your invite link can join.' : 'Show your room in the public room list.'}</small></span></label>
            <button className="primary-button full-button" type="submit" disabled={!connected}>Create room <span>↗</span></button>
          </form>
          <div className="entry-divider"><span>OR JOIN A ROOM</span></div>
          <form className="join-form" onSubmit={(event) => { event.preventDefault(); void joinRoom(); }}><input className="text-input code-input" aria-label="Room code" placeholder="ENTER ROOM CODE" maxLength={6} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /><button className="secondary-button" type="submit" disabled={!connected}>Join ↗</button></form>
        </div>
        <div className="public-rooms-card"><div className="rooms-header"><div><h3>Open lobbies</h3><p>Jump into a public room</p></div><button className="icon-button" title="Refresh rooms" onClick={() => socket.emit('list_rooms')}>↻</button></div>
          {publicRooms.length ? <div className="public-room-list">{publicRooms.slice(0, 4).map((room) => <button className="public-room-row" key={room.roomId} onClick={() => { setRoomCode(room.roomId); void joinRoom(room.roomId); }}><span className="room-avatar">{room.hostName.slice(0, 1).toUpperCase()}</span><span className="public-room-info"><strong>{room.hostName}'s room</strong><small>{room.rounds} rounds · {room.drawTime}s turns</small></span><span className="room-occupancy">{room.players}/{room.maxPlayers}</span><span className="row-arrow">↗</span></button>)}</div> : <div className="empty-rooms"><span>◎</span><div><strong>No open lobbies yet</strong><small>Create a public room and it will show up here.</small></div></div>}
        </div>
      </section>
    </main> : <main className="game-layout">
      <div className="game-topline"><div><span className="room-label">ROOM CODE</span><button className="room-code-button" onClick={() => void copyInvite()}>{game.roomId} <span>▣</span></button></div><div className="round-center"><span className="round-chip">{game.phase === 'lobby' ? 'LOBBY' : game.phase === 'game_over' ? 'GAME OVER' : `ROUND ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`}</span><strong>{game.phase === 'lobby' ? 'Waiting for players' : game.phase === 'word_selection' ? `${game.drawerName} is choosing a word` : game.phase === 'drawing' ? (game.canDraw ? 'Your turn to draw!' : `${game.drawerName} is drawing`) : game.phase === 'round_end' ? 'Round complete!' : 'Game complete!'}</strong></div><button className="secondary-button invite-button" onClick={() => void copyInvite()}>＋ Invite friends</button></div>

      {game.phase === 'lobby' ? <section className="lobby-panel"><div className="lobby-heading"><div className="lobby-icon">♧</div><div><h2>Waiting for your crew</h2><p>Share the room code and get everyone ready to play.</p></div><span className="player-count-pill">{game.players.filter((p) => p.connected).length} / {game.settings.maxPlayers} players</span></div><div className="lobby-content"><div className="player-grid">{game.players.map((player, index) => <div className={`player-tile ${player.id === playerId ? 'you-tile' : ''}`} key={player.id}><div className={`player-avatar avatar-${index % 6}`}>{player.name.slice(0, 1).toUpperCase()}</div><div className="player-tile-info"><strong>{player.name}{player.id === playerId ? ' (you)' : ''}</strong><small>{player.id === game.hostId ? '♛ Host' : player.connected ? (player.ready ? 'Ready to play' : 'Getting ready…') : 'Disconnected'}</small></div><span className={`ready-mark ${player.ready ? 'ready' : ''}`}>{player.ready ? '✓' : '·'}</span></div>)}</div><aside className="lobby-side"><div className="room-settings-summary"><h3>Game settings</h3><div><span>Rounds</span><strong>{game.settings.rounds}</strong></div><div><span>Draw time</span><strong>{game.settings.drawTime}s</strong></div><div><span>Word choices</span><strong>{game.settings.wordCount}</strong></div><div><span>Hints</span><strong>{game.settings.hints || 'Off'}</strong></div><div><span>Room type</span><strong>{game.isPrivate ? 'Private' : 'Public'}</strong></div></div><button className="primary-button full-button" onClick={() => void action('toggle_ready', { ready: !currentPlayer?.ready })}>{currentPlayer?.ready ? '✓ You are ready' : 'I’m ready'}</button>{isHost && <button className="secondary-button full-button" disabled={!canStart} onClick={() => void action('start_game')}>Start game ↗</button>}<p className="muted tiny center-text">{isHost ? (canStart ? 'Everyone is ready — let’s play!' : 'At least 2 players must join and be ready.') : 'The host will start when everyone is ready.'}</p></aside></div></section> : <>
        <section className="game-status-strip"><div className="word-status"><span className="status-dot"/><div><small>{game.canDraw ? 'YOUR SECRET WORD' : game.phase === 'round_end' ? 'THE WORD WAS' : game.phase === 'game_over' ? 'FINAL RESULT' : 'GUESS THE WORD'}</small><strong className={game.canDraw ? 'secret-word' : ''}>{game.phase === 'game_over' ? (game.roundResult?.winner?.name ? `${game.roundResult.winner.name} wins!` : 'Game over') : game.phase === 'round_end' ? (game.roundResult?.word ?? 'Round ended') : game.canDraw ? (game.secretWord ?? (game.settings.wordMode === 'hidden' ? 'Hidden mode — draw from memory' : 'Choose a word below')) : (game.maskedWord || (game.phase === 'word_selection' ? 'Word is being chosen…' : 'Waiting for first hint…'))}</strong></div></div><div className={`timer-box ${game.remainingTime <= 10 && game.phase === 'drawing' ? 'timer-warning' : ''}`}><span>◷</span><strong>{game.phase === 'word_selection' ? 'WORD?' : game.phase === 'round_end' || game.phase === 'game_over' ? '—' : `${game.remainingTime}s`}</strong></div></section>
        {game.phase === 'word_selection' && game.canDraw && <section className="word-choice-panel"><div><h3>Pick your word</h3><p>Choose one word to draw for your friends.</p></div><div className="word-options">{game.wordOptions.map((word) => <button key={word} onClick={() => void action('word_chosen', { word })}>{word}<span>↗</span></button>)}</div></section>}
        {game.phase === 'word_selection' && !game.canDraw && <div className="waiting-banner"><span className="loading-dots">•••</span> {game.drawerName} is picking a word. Get ready to guess!</div>}
        {game.phase === 'round_end' && <div className="round-result-banner"><strong>Word revealed: {game.roundResult?.word}</strong><span>{game.roundResult?.correctGuessers?.length ? `Correct guesses: ${game.roundResult.correctGuessers.join(', ')}` : 'Nobody guessed it this time.'}</span>{game.roundResult?.drawerBonus ? <small>{game.roundResult.drawerName} earned a +{game.roundResult.drawerBonus} drawer bonus.</small> : null}</div>}
        {game.phase === 'game_over' && <div className="game-over-banner"><div className="winner-cup">🏆</div><div><small>THE WINNER</small><h2>{game.roundResult?.winner?.name ?? 'No winner'}</h2><p>{game.roundResult?.winner?.score ?? 0} points · Great game, everyone!</p></div>{isHost && <button className="secondary-button" onClick={() => void action('play_again')}>Play again ↻</button>}</div>}
        <div className="game-main-grid"><section className="canvas-panel"><div className="panel-header"><div><span className="live-tag"><i/> LIVE CANVAS</span><h3>{game.phase === 'game_over' ? 'Last drawing' : game.canDraw ? 'Make it guessable' : 'What are they drawing?'}</h3></div><span className="canvas-player-tag">✎ {game.drawerName ?? 'No drawer'}</span></div><CanvasBoard socket={socket} strokes={game.strokes} canDraw={game.canDraw && game.phase === 'drawing'} /></section><aside className="side-panel"><section className="score-panel"><div className="panel-header compact"><div><h3>Players & scores</h3><p>Race to the top</p></div><span className="mini-count">{game.players.length}</span></div><div className="score-list">{game.leaderboard.map((player, index) => <div key={player.id} className={`score-row ${player.id === game.drawerId ? 'drawing-player' : ''}`}><span className={`score-rank ${index === 0 && player.score > 0 ? 'rank-first' : ''}`}>{index === 0 && player.score > 0 ? '♛' : index + 1}</span><span className={`mini-avatar avatar-${game.players.findIndex((p) => p.id === player.id) % 6}`}>{player.name.slice(0, 1).toUpperCase()}</span><span className="score-name">{player.name}{player.id === playerId ? ' (you)' : ''}<small>{player.id === game.drawerId ? '✎ Drawing' : player.hasGuessed && game.phase === 'drawing' ? '✓ Guessed' : player.connected ? '' : 'Disconnected'}</small></span><strong className="score-value">{player.score}</strong></div>)}</div></section><section className="chat-panel"><div className="panel-header compact"><div><h3>Game chat</h3><p>{game.phase === 'drawing' ? 'Drop your best guess' : 'Chat with the room'}</p></div><span className="chat-status">● LIVE</span></div><div className="chat-messages">{game.chat.map((message) => <div className={`chat-message ${message.kind}`} key={message.id}><span className="chat-author">{message.kind === 'system' ? '✦ Game' : message.playerName}</span><p>{message.text}</p></div>)}<div ref={chatEndRef}/></div>{game.phase === 'drawing' && !game.canDraw && !game.hasGuessed ? <form className="chat-input-row" onSubmit={sendGuess}><input value={guess} onChange={(event) => setGuess(event.target.value)} maxLength={100} placeholder="Type your guess…" aria-label="Guess the word"/><button type="submit" title="Send guess">↗</button></form> : <form className="chat-input-row" onSubmit={sendChat}><input value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={200} placeholder="Send a message…" aria-label="Chat message"/><button type="submit" title="Send message">↗</button></form>}</section></aside></div>
      </>}
      <footer className="game-footer"><span>✦ Draw with kindness. Guess with confidence.</span><span>Room {game.roomId} · {game.isPrivate ? 'Private' : 'Public'}</span></footer>
    </main>}
    {error && <div className="toast toast-error" role="alert"><span>!</span>{error}<button onClick={() => setError('')}>×</button></div>}
    {toast && <div className="toast toast-info"><span>✦</span>{toast}<button onClick={() => setToast('')}>×</button></div>}
    <div className="background-orb orb-left"/><div className="background-orb orb-right"/>
  </div>;
}
