import { describe, expect, it } from 'vitest';
import { MemoryMatchStore } from '../src/net/store';
import { DEFAULT_CONFIG } from '../src/sim/game';
import type { TurnRecord } from '../src/sim/turnlog';

const turn = (n: number): TurnRecord => ({ turn: n, team: (n - 1) % 2, snailId: 0, frames: [0, 1], hash: 0 });

describe('match store', () => {
  it('appends turns in order and rejects out-of-order ones', async () => {
    const store = new MemoryMatchStore();
    const created = await store.create('m', DEFAULT_CONFIG);
    await store.appendTurn('m', turn(1));
    await expect(store.appendTurn('m', turn(1))).rejects.toThrow(/expected 2/);
    await expect(store.appendTurn('m', turn(3))).rejects.toThrow(/expected 2/);
    await store.appendTurn('m', turn(2));
    expect((await store.load('m'))!.turns.map((t) => t.turn)).toEqual([1, 2]);
    // Callers get copies, so mutating them never touches the store.
    created.turns.push(turn(9));
    expect((await store.load('m'))!.turns).toHaveLength(2);
  });
});
