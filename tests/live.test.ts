import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { createGame, hashState } from '../src/sim/game';
import { LiveTurn, TurnRecorder, type LiveChunk, type TurnRecord } from '../src/sim/turnlog';
import type { GameConfig } from '../src/sim/types';

const config: Partial<GameConfig> = { seed: 12, snailsPerTeam: 2, turnSeconds: 8 };

/** Plays turn 1 with a bot, cutting it into live chunks every `every` ticks. */
function playTurn(every: number): { chunks: LiveChunk[]; record: TurnRecord; hash: number } {
  const state = createGame(config);
  const recorder = new TurnRecorder(state);
  const bot = new Bot(4);
  const chunks: LiveChunk[] = [];
  for (let t = 1; ; t++) {
    const { turn } = recorder.step(bot.input(state));
    if (turn) return { chunks, record: turn, hash: hashState(state) };
    if (t % every === 0) {
      const c = recorder.takeLive();
      if (c) chunks.push(c);
    }
  }
}

describe('watching a turn live', () => {
  it('chunks then the record land on exactly the same state', () => {
    const { chunks, record, hash } = playTurn(15);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0].from).toBe(0);
    const viewer = createGame(config);
    const live = new LiveTurn(viewer, record.turn);
    for (const c of chunks) expect(live.add(c)).toBe(true);
    while (live.buffered > 0) live.step();
    const rest = live.finish(record)!;
    expect(rest).not.toBeNull();
    while (!rest.done) rest.step();
    expect(hashState(viewer)).toBe(hash);
  });

  it('can hand over to the record halfway through what was buffered', () => {
    const { chunks, record, hash } = playTurn(10);
    const viewer = createGame(config);
    const live = new LiveTurn(viewer, record.turn);
    for (const c of chunks) live.add(c);
    for (let i = 0; i < 40; i++) live.step();
    const rest = live.finish(record)!;
    while (!rest.done) rest.step();
    expect(hashState(viewer)).toBe(hash);
  });

  it('refuses a chunk that skips ticks, and a record that does not match what was played', () => {
    const { chunks, record } = playTurn(15);
    const viewer = createGame(config);
    const live = new LiveTurn(viewer, record.turn);
    expect(live.add(chunks[1])).toBe(false);
    live.add(chunks[0]);
    while (live.buffered > 0) live.step();
    const other: TurnRecord = { ...record, frames: [1, live.played + 5, ...record.frames] };
    expect(live.finish(other)).toBeNull();
  });
});
