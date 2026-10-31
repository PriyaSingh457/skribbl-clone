export type Phase = 'lobby' | 'word_selection' | 'drawing' | 'round_end' | 'game_over';
export type Player = { id: string; name: string; score: number; ready: boolean; connected: boolean; hasGuessed: boolean };
export type Point = { x: number; y: number };
export type Stroke = { id: string; color: string; size: number; eraser: boolean; points: Point[]; complete?: boolean };
export type ChatMessage = { id: string; playerId: string; playerName: string; text: string; kind: 'chat' | 'guess' | 'correct' | 'system'; timestamp: number };
export type Settings = { maxPlayers: number; rounds: number; drawTime: number; wordCount: number; hints: number; wordMode: 'normal' | 'hidden' };
export type PublicRoom = { roomId: string; hostName: string; players: number; maxPlayers: number; rounds: number; drawTime: number };
export type GameState = {
  roomId: string; isPrivate: boolean; hostId: string; settings: Settings; players: Player[]; phase: Phase;
  round: number; totalRounds: number; drawerId: string | null; drawerName: string | null; wordOptions: string[];
  secretWord: string | null; maskedWord: string; hintLettersRevealed: number; remainingTime: number; strokes: Stroke[];
  roundResult: { word?: string; reason?: string; drawerId?: string; drawerName?: string; correctGuessers?: string[]; drawerBonus?: number; winner?: Player | null; leaderboard?: Player[] } | null;
  chat: ChatMessage[]; leaderboard: Player[]; viewerId: string | null; canDraw: boolean; hasGuessed: boolean; connectedPlayerCount: number;
};
