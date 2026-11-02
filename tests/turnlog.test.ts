import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { createGame, hashState } from '../src/sim/game';
import {
  DesyncError,
  TurnRecorder,
  applyTurn,
  decodeFrames,
  encodeFrames,
  packInput,
  rebuild,
  unpackInput,
  type MatchRecord,
} from '../src/sim/turnlog';
import { EMPTY_INPUT, type InputFrame } from '../src/sim/types';

function playMatch(seed: number, maxTicks: number): { match: MatchRecord; finalHash: number } {
  const state = createGame({ seed, startHp: 60 });
  const match: MatchRecord = { config: { ...state.config }, turns: [] };
  const recorder = new TurnRecorder(state);
  const bots = [new Bot(seed + 1), new Bot(seed + 2)];
  for (let i = 0; i < maxTicks && state.phase !== 'gameover'; i++) {
    const { turn } = recorder.step(bots[state.activeTeam].input(state));
    if (turn) match.turns.push(turn);
  }
  return { match, finalHash: hashState(state) };
}

describe('turn log', () => {
  it('packs weapon picks up to 63 next to the keys', () => {
    for (const weapon of [1, 15, 16, 40, 63]) {
      const frame: InputFrame = { ...EMPTY_INPUT, fire: true, left: true, weapon };
      expect(unpackInput(packInput(frame))).toEqual(frame);
    }
  });

  it('packs and run-length encodes inputs losslessly', () => {
    const a: InputFrame = { ...EMPTY_INPUT, left: true, fire: true };
    expect(unpackInput(packInput(a))).toEqual(a);
    const frames = [EMPTY_INPUT, EMPTY_INPUT, a, a, a, EMPTY_INPUT];
    const rle = encodeFrames(frames);
    expect(rle).toEqual([0, 2, packInput(a), 3, 0, 1]);
    expect(decodeFrames(rle)).toEqual(frames);
  });

  it('splits a match into turns that replay to the same state', () => {
    const { match, finalHash } = playMatch(11, 60 * 60 * 15);
    expect(match.turns.length).toBeGreaterThan(3);
    match.turns.forEach((t, i) => expect(t.turn).toBe(i + 1));
    expect(hashState(rebuild(match))).toBe(finalHash);
    expect(rebuild(match).phase).toBe('gameover');
  });

  it('keeps logs small', () => {
    const { match } = playMatch(11, 60 * 60 * 15);
    const bytes = JSON.stringify(match.turns).length / match.turns.length;
    expect(bytes).toBeLessThan(2000);
  });

  it('rejects a tampered turn', () => {
    const { match } = playMatch(4, 60 * 60 * 3);
    const t = structuredClone(match.turns[0]);
    // Hold "aim up" for the first ten ticks instead of whatever was recorded.
    const frames = decodeFrames(t.frames);
    for (let i = 0; i < 10; i++) frames[i] = { ...EMPTY_INPUT, up: true };
    t.frames = encodeFrames(frames);
    expect(() => applyTurn(createGame(match.config), t)).toThrow(DesyncError);
  });

  it('rejects turns applied out of order', () => {
    const { match } = playMatch(4, 60 * 60 * 3);
    expect(() => applyTurn(createGame(match.config), match.turns[1])).toThrow(DesyncError);
  });
});
