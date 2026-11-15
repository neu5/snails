/** Shapes the lobby server sends and takes. Shared by server/ and the browser. */

export type RoomStatus = 'lobby' | 'playing' | 'over';

export interface TeamView {
  playerId: string;
  /** Join order; it becomes the team's turn order when the game starts. */
  seat: number;
  name: string;
  color: number;
  snailNames: string[];
  isHost: boolean;
  hasEmail: boolean;
  verified: boolean;
  /** Team index in the game, once it has started. */
  teamIndex: number | null;
}

export interface RoomView {
  id: string;
  status: RoomStatus;
  snailsPerTeam: number;
  startHp: number;
  turnSeconds: number;
  teams: TeamView[];
  /** The viewer's own seat, when they sent a valid token. */
  you: { playerId: string; isHost: boolean; email: string | null; verified: boolean } | null;
}

export interface TeamEdit {
  teamName: string;
  color: number;
  snailNames: string[];
  /** Empty string removes it. */
  email?: string;
}

export interface RoomSettings {
  snailsPerTeam?: number;
  turnSeconds?: number;
  startHp?: number;
}

/** Pushed over /ws?room=<id>. */
export type RoomEvent = { type: 'room' } | { type: 'turn'; turn: number };

export const TEAM_NAME_MAX = 20;
export const SNAIL_NAME_MAX = 12;
