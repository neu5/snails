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
  /** 1-based index into WEAPONS while a weapon key is held, 0 otherwise (at most 15). */
  weapon: number;
}

export const EMPTY_INPUT: InputFrame = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  fire: false,
  weapon: 0,
};

export type WeaponId = 'bazooka' | 'grenade' | 'gun' | 'uzi' | 'mine' | 'dynamite' | 'drill' | 'torch' | 'rope';

/** Selection order; keys 1-9 pick these. */
export const WEAPONS: readonly WeaponId[] = ['bazooka', 'grenade', 'gun', 'uzi', 'mine', 'dynamite', 'drill', 'torch', 'rope'];

/**
 * aiming: walk, aim, pick and use a weapon. firing: an uzi burst is running (aim only).
 * digging: drill or blowtorch is cutting through the ground and carries the snail along.
 * retreat: weapon used, the snail may still walk and jump. settling: wait for things to stop.
 */
export type Phase = 'aiming' | 'firing' | 'digging' | 'retreat' | 'settling' | 'gameover';

/** A point the rope hangs from: the anchor, or a corner it wrapped around. */
export interface RopePivot {
  x: number;
  y: number;
  /**
   * For corners: the side (sign of the cross product) the snail swung in from. Swinging
   * back to that side unwraps the corner.
   */
  side: number;
}

/** The active snail swinging on a rope. Not a used weapon: the turn goes on while it swings. */
export interface Rope {
  /** Anchor first, then each wrapped corner; the snail swings from the last one. */
  pivots: RopePivot[];
  /** Free rope from the last pivot to the snail. */
  len: number;
}

/** The rope's hook on its way out; it becomes a Rope when it hits ground. */
export interface Hook {
  x: number;
  y: number;
  /** Unit direction of flight. */
  dx: number;
  dy: number;
  /** Distance flown so far. */
  dist: number;
}

/** A drill or blowtorch at work: the snail is pinned to (x, y), which moves along (dx, dy). */
export interface Dig {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ticksLeft: number;
  /** No ground under the snail: it falls freely, the tool still cutting along the aim. */
  falling: boolean;
  /** The digger's HP when the tool started; losing any stops the tool. */
  hp: number;
}

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
  /** Selected weapon; kept between this team's turns. */
  weapon: WeaponId;
}

export type ObjectKind = 'shell' | 'grenade' | 'mine' | 'dynamite';

/** Anything flying or lying on the map. Mines stay between turns. */
export interface Projectile {
  kind: ObjectKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ownerId: number;
  /** Ticks until it explodes; -1 means no fuse lit (shells blow on impact, mines wait for a snail). */
  fuse: number;
  /** Lying still on the ground. */
  resting: boolean;
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
  /** Shots used this turn (the gun has two). */
  shotsFired: number;
  /** Ticks left in an uzi burst (phase 'firing'). */
  burstTicks: number;
  /** Ticks left to walk away after using a weapon (phase 'retreat'). */
  retreatTicks: number;
  /** Ticks left to wait for a second jump press (back jump) before jumping forward. */
  jumpTicks: number;
  objects: Projectile[];
  dig: Dig | null;
  rope: Rope | null;
  hook: Hook | null;
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
  | { type: 'fire'; snailId: number; weapon: WeaponId }
  | { type: 'bullet'; x0: number; y0: number; x1: number; y1: number; hit: boolean }
  | { type: 'mineTriggered'; x: number; y: number }
  | { type: 'dig'; x: number; y: number }
  | { type: 'rope'; x0: number; y0: number; x1: number; y1: number; hit: boolean }
  /** A swinging snail slammed into another one. */
  | { type: 'knock'; x: number; y: number }
  | { type: 'turn'; team: number; snailId: number }
  | { type: 'gameover'; winner: number };
