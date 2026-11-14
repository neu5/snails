import { describe, expect, it } from 'vitest';
import { START_HP, gravesFromUrl, modeConfig } from '../src/lobby/test-lobby';
import { GRAVES } from '../src/render/graves';
import { ammoLeft, createGame } from '../src/sim/game';
import { WEAPONS } from '../src/sim/types';

describe('test lobby game modes', () => {
  it('infinite has no weapon limits', () => {
    const state = createGame({ seed: 4, ...modeConfig('infinite') });
    for (const t of state.teams) for (const w of WEAPONS) expect(ammoLeft(t, w)).toBe(Infinity);
  });

  it('default (or anything unknown) keeps the usual limits', () => {
    for (const mode of ['default', null, 'nonsense']) {
      const state = createGame({ seed: 4, ...modeConfig(mode) });
      expect(state.teams[0].ammo.dynamite).toBe(1);
    }
  });

  it('snails per team comes through to the game', () => {
    for (const n of [1, 2, 3, 4]) {
      const state = createGame({ seed: 4, snailsPerTeam: n });
      for (const t of state.teams) expect(state.snails.filter((s) => s.team === t.id)).toHaveLength(n);
    }
  });

  it('starting HP comes through to every snail', () => {
    for (const hp of START_HP) {
      const state = createGame({ seed: 4, startHp: hp });
      expect(state.snails.every((s) => s.hp === hp)).toBe(true);
    }
  });

  it('graves come from the URL, one per team, with bad values falling back to the first', () => {
    expect(gravesFromUrl('2,5')).toEqual([2, 5]);
    expect(gravesFromUrl('4')).toEqual([4, 0]);
    expect(gravesFromUrl('9,-1')).toEqual([0, 0]);
    expect(gravesFromUrl(null)).toEqual([0, 0]);
    expect(GRAVES).toHaveLength(6);
  });
});
