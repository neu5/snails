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
/** A piece of a turn still being played, sent to people watching it live. */
export interface LiveChunk {
  turn: number;
  /** Index of the chunk's first tick in the turn. */
  from: number;
  /** Run-length encoded packed inputs, like TurnRecord.frames. */
  frames: number[];
}

export function encodeBits(bits: number[]): number[] {
  const rle: number[] = [];
  for (const b of bits) pushRun(rle, b);
  return rle;
}

export function decodeBits(rle: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < rle.length; i += 2) for (let k = 0; k < rle[i + 1]; k++) out.push(rle[i]);
  return out;
}

export class TurnRecorder {
  private rle: number[] = [];
  /** This turn's packed inputs one per tick, and how many takeLive has handed out. */
  private live: number[] = [];
  private sent = 0;
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
    const bits = packInput(effective);
    pushRun(this.rle, bits);
    this.live.push(bits);
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

  /**
   * The ticks of the turn in progress not handed out yet, for live viewers. The tick that ends
   * a turn is never in a chunk: viewers finish the turn from its TurnRecord.
   */
  takeLive(): LiveChunk | null {
    if (this.sent >= this.live.length) return null;
    const chunk = { turn: this.turn, from: this.sent, frames: encodeBits(this.live.slice(this.sent)) };
    this.sent = this.live.length;
    return chunk;
  }

  /** Hands out the whole turn so far again from tick 0 (after a reconnect). */
  resendLive(): void {
    this.sent = 0;
  }

  private begin(): void {
    this.rle = [];
    this.live = [];
    this.sent = 0;
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
  private i: number;

  /** `startAt` ticks of the turn were already played on `state` (watched live). */
  constructor(
    private state: GameState,
    readonly record: TurnRecord,
    startAt = 0,
  ) {
    this.i = startAt;
    if (state.phase === 'gameover') throw new DesyncError(record.turn, 'game is already over');
    if (record.turn !== state.turnNumber || record.team !== state.activeTeam || record.snailId !== state.activeSnailId) {
      throw new DesyncError(record.turn, `expected turn ${state.turnNumber} of team ${state.activeTeam}`);
    }
    this.frames = decodeFrames(record.frames);
    if (this.frames.length === 0) throw new DesyncError(record.turn, 'no frames');
    if (startAt >= this.frames.length) throw new DesyncError(record.turn, 'watched past the end of the turn');
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

/**
 * Plays a turn while its player is still playing it: ticks arrive in chunks (LiveChunk). Once
 * the turn's TurnRecord arrives, `finish` hands over to a TurnPlayback from the same tick.
 */
export class LiveTurn {
  private bits: number[] = [];
  private i = 0;

  constructor(
    private state: GameState,
    readonly turn: number,
  ) {
    if (state.turnNumber !== turn) throw new DesyncError(turn, `expected turn ${state.turnNumber}`);
  }

  /** Ticks played so far. */
  get played(): number {
    return this.i;
  }

  /** Ticks received but not played yet. */
  get buffered(): number {
    return this.bits.length - this.i;
  }

  /** Adds a chunk; returns false if it does not follow on from what came before. */
  add(chunk: LiveChunk): boolean {
    if (chunk.turn !== this.turn || chunk.from !== this.bits.length) return false;
    this.bits.push(...decodeBits(chunk.frames));
    return true;
  }

  step(): SimEvent[] {
    const events = step(this.state, unpackInput(this.bits[this.i++]));
    if (endsTurn(events)) throw new DesyncError(this.turn, 'a live chunk ended the turn');
    return events;
  }

  /**
   * Continues with the finished turn from where live play got to, or null when the record does
   * not start with the ticks already played (then the turn must be replayed from its start).
   */
  finish(record: TurnRecord): TurnPlayback | null {
    if (record.turn !== this.turn) return null;
    const recorded = decodeBits(record.frames);
    for (let k = 0; k < this.i; k++) if (recorded[k] !== this.bits[k]) return null;
    if (this.i >= recorded.length) return null;
    return new TurnPlayback(this.state, record, this.i);
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
