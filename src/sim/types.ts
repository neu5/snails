import type { Terrain } from './terrain';

/**
 * Per-tick input for the active player. This is the only thing that crosses the
 * input -> simulation boundary, so for online play it is what gets sent over the wire.
 */
export interface InputFrame {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  fire: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  fire: false,
};

export type Phase = 'aiming' | 'flying' | 'settling' | 'gameover';

export interface Snail {
  id: number;
  team: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  alive: boolean;
  grounded: boolean;
  facing: 1 | -1;
  /** Aim angle in integer degrees relative to facing; +90 is straight up, -90 straight down. */
  aim: number;
}

export interface Team {
  id: number;
  name: string;
  /** Index into this team's snail list for the next turn. */
  nextIndex: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ownerId: number;
}

export interface GameConfig {
  seed: number;
  snailsPerTeam: number;
  startHp: number;
  turnSeconds: number;
}

export interface GameState {
  config: GameConfig;
  tick: number;
  rng: number;
  terrain: Terrain;
  snails: Snail[];
  teams: Team[];
  activeTeam: number;
  activeSnailId: number;
  turnNumber: number;
  phase: Phase;
  turnTicksLeft: number;
  /** 0..1 while the fire button is held. */
  power: number;
  charging: boolean;
  projectile: Projectile | null;
  /** Horizontal acceleration applied to projectiles, px/tick^2. */
  wind: number;
  settleTicks: number;
  /** Winning team id, -1 for draw, null while playing. */
  winner: number | null;
  prevInput: InputFrame;
}

/** Fire-and-forget notifications for presentation (sound, particles). Not part of state. */
export type SimEvent =
  | { type: 'explosion'; x: number; y: number; r: number }
  | { type: 'damage'; snailId: number; amount: number }
  | { type: 'death'; snailId: number }
  | { type: 'drown'; snailId: number }
  | { type: 'splash'; x: number }
  | { type: 'fire'; snailId: number }
  | { type: 'turn'; team: number; snailId: number }
  | { type: 'gameover'; winner: number };
