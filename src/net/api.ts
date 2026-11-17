/** Shapes the lobby server sends and takes. Shared by server/ and the browser. */

import type { LiveChunk } from '../sim/turnlog';

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
export type RoomEvent =
  | { type: 'room' }
  | { type: 'turn'; turn: number }
  /** Players with the room open right now (checked by token), and their game teams. */
  | { type: 'presence'; online: string[]; teams: number[] }
  /** A piece of the turn being played right now. */
  | { type: 'live'; chunk: LiveChunk };

/** Sent by the browser over the same socket. */
export type ClientMessage =
  /** First message: who this is (null to just watch). */
  | { type: 'hello'; token: string | null }
  /** The active player streams their turn as they play it. */
  | { type: 'live'; chunk: LiveChunk };

export const TEAM_NAME_MAX = 20;
export const SNAIL_NAME_MAX = 12;
