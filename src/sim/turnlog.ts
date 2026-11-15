import { TARGET_GRID, createGame, effectiveInput, hashState, step } from './game';
import { EMPTY_INPUT, type GameConfig, type GameState, type InputFrame, type SimEvent } from './types';

/**
 * One finished turn: the inputs that drove it plus the state hash after it. Applied on top
 * of the state the turn started from, it reproduces that turn exactly.
 */
export interface TurnRecord {
  /** state.turnNumber while this turn ran; the first turn of a match is 1. */
  turn: number;
  team: number;
  snailId: number;
  /** Run-length encoded input bitmasks: [bits, count, bits, count, ...], one entry per tick. */
  frames: number[];
  /** hashState right after the last frame. Replays must reach the same value. */
  hash: number;
}

/** A whole match as stored: the config fixes the map, the turns replay everything else. */
export interface MatchRecord {
  config: GameConfig;
  turns: TurnRecord[];
}

export class DesyncError extends Error {
  constructor(
    readonly turn: number,
    message: string,
  ) {
    super(`turn ${turn}: ${message}`);
    this.name = 'DesyncError';
  }
}

const KEYS = ['left', 'right', 'up', 'down', 'jump', 'fire'] as const;
/**
 * Bits 0-5 are KEYS, bits 6-11 the weapon picked (up to 63 weapons), bits 12-30 a map target in
 * TARGET_GRID cells: 10 bits of x + 1 (0 means no target), then 9 bits of y.
 */
const WEAPON_SHIFT = KEYS.length;
const TARGET_X_SHIFT = 12;
const TARGET_Y_SHIFT = 22;

export function packInput(input: InputFrame): number {
  let bits = (input.weapon & 63) << WEAPON_SHIFT;
  if (input.target) {
    bits |= (Math.floor(input.target.x / TARGET_GRID) + 1) << TARGET_X_SHIFT;
    bits |= Math.floor(input.target.y / TARGET_GRID) << TARGET_Y_SHIFT;
  }
  KEYS.forEach((k, i) => {
    if (input[k]) bits |= 1 << i;
  });
  return bits;
}

export function unpackInput(bits: number): InputFrame {
  const out = { ...EMPTY_INPUT, weapon: (bits >> WEAPON_SHIFT) & 63 };
  const cellX = (bits >> TARGET_X_SHIFT) & 1023;
  if (cellX > 0) out.target = { x: (cellX - 1) * TARGET_GRID, y: ((bits >> TARGET_Y_SHIFT) & 511) * TARGET_GRID };
  KEYS.forEach((k, i) => {
    out[k] = (bits & (1 << i)) !== 0;
  });
  return out;
}

function pushRun(rle: number[], bits: number): void {
  const n = rle.length;
  if (n > 0 && rle[n - 2] === bits) rle[n - 1]++;
  else rle.push(bits, 1);
}

export function encodeFrames(inputs: InputFrame[]): number[] {
  const rle: number[] = [];
  for (const i of inputs) pushRun(rle, packInput(i));
  return rle;
}

export function decodeFrames(rle: number[]): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < rle.length; i += 2) {
    const frame = unpackInput(rle[i]);
    for (let k = 0; k < rle[i + 1]; k++) out.push(frame);
  }
  return out;
}

function endsTurn(events: SimEvent[]): boolean {
  return events.some((e) => e.type === 'turn' || e.type === 'gameover');
}

/**
 * Wraps `step` for the side that plays live: records every tick of the current turn and
 * hands back a TurnRecord on the tick that ends it, then starts recording the next turn.
 */
export class TurnRecorder {
  private rle: number[] = [];
  private turn = 0;
  private team = 0;
  private snailId = 0;

  constructor(private state: GameState) {
    this.begin();
  }

  step(input: InputFrame): { events: SimEvent[]; turn: TurnRecord | null } {
    const s = this.state;
    if (s.phase === 'gameover') return { events: step(s, EMPTY_INPUT), turn: null };
    // Store only what the current phase listens to; it keeps runs long.
    const effective = effectiveInput(s, input);
    pushRun(this.rle, packInput(effective));
    const events = step(s, effective);
    if (!endsTurn(events)) return { events, turn: null };
    const turn: TurnRecord = {
      turn: this.turn,
      team: this.team,
      snailId: this.snailId,
      frames: this.rle,
      hash: hashState(s),
    };
    this.begin();
    return { events, turn };
  }

  private begin(): void {
    this.rle = [];
    this.turn = this.state.turnNumber;
    this.team = this.state.activeTeam;
    this.snailId = this.state.activeSnailId;
  }
}

/**
 * Plays a recorded turn tick by tick (for watching at normal speed) and checks that it ends
 * exactly on its last frame with the recorded hash. Throws DesyncError otherwise.
 */
export class TurnPlayback {
  private frames: InputFrame[];
  private i = 0;

  constructor(
    private state: GameState,
    readonly record: TurnRecord,
  ) {
    if (state.phase === 'gameover') throw new DesyncError(record.turn, 'game is already over');
    if (record.turn !== state.turnNumber || record.team !== state.activeTeam || record.snailId !== state.activeSnailId) {
      throw new DesyncError(record.turn, `expected turn ${state.turnNumber} of team ${state.activeTeam}`);
    }
    this.frames = decodeFrames(record.frames);
    if (this.frames.length === 0) throw new DesyncError(record.turn, 'no frames');
  }

  get done(): boolean {
    return this.i >= this.frames.length;
  }

  step(): SimEvent[] {
    const last = this.i === this.frames.length - 1;
    const events = step(this.state, this.frames[this.i++]);
    const ended = endsTurn(events);
    if (ended && !last) throw new DesyncError(this.record.turn, `ended early at frame ${this.i}`);
    if (last && !ended) throw new DesyncError(this.record.turn, 'did not end on its last frame');
    if (last && hashState(this.state) !== this.record.hash) throw new DesyncError(this.record.turn, 'state hash mismatch');
    return events;
  }
}

/** Applies a whole recorded turn at once. This is also what a server runs to validate a move. */
export function applyTurn(state: GameState, record: TurnRecord): SimEvent[] {
  const playback = new TurnPlayback(state, record);
  const events: SimEvent[] = [];
  while (!playback.done) events.push(...playback.step());
  return events;
}

/** Rebuilds the state of a match after its first `upto` turns. */
export function rebuild(match: MatchRecord, upto = match.turns.length): GameState {
  const state = createGame(match.config);
  for (const t of match.turns.slice(0, upto)) applyTurn(state, t);
  return state;
}
