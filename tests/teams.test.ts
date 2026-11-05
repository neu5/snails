import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { createGame, hashState, step } from '../src/sim/game';
import { TurnRecorder, rebuild, type MatchRecord } from '../src/sim/turnlog';
import { type TeamSetup } from '../src/sim/types';

const teams: TeamSetup[] = [
  { name: 'Ants', color: 4, snailNames: ['A1', 'A2'] },
  { name: 'Bees', color: 7, snailNames: ['B1', 'B2'] },
  { name: 'Cats', color: 2, snailNames: ['C1', 'C2'] },
  { name: 'Dogs', color: 5, snailNames: ['D1', 'D2'] },
];

describe('teams from the lobby', () => {
  it('four teams get their names, colors and snails, and all of them take turns', () => {
    const state = createGame({ seed: 3, snailsPerTeam: 2, teams, turnSeconds: 2 });
    expect(state.teams.map((t) => [t.name, t.color])).toEqual(teams.map((t) => [t.name, t.color]));
    expect(state.snails).toHaveLength(8);
    for (const [i, t] of teams.entries()) {
      expect(state.snails.filter((s) => s.team === i).map((s) => s.name)).toEqual(t.snailNames);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 60 && seen.size < 4; i++) {
      step(state, { left: false, right: false, up: false, down: false, jump: false, fire: false, weapon: 0 });
      seen.add(state.activeTeam);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('a recorded 4-team match replays to the same state', () => {
    const config = { seed: 8, snailsPerTeam: 2, startHp: 60, turnSeconds: 5, teams };
    const state = createGame(config);
    const match: MatchRecord = { config: { ...state.config }, turns: [] };
    const recorder = new TurnRecorder(state);
    const bots = teams.map((_, i) => new Bot(i + 1));
    for (let i = 0; i < 60 * 60 * 4 && state.phase !== 'gameover'; i++) {
      const { turn } = recorder.step(bots[state.activeTeam].input(state));
      if (turn) match.turns.push(turn);
    }
    expect(match.turns.length).toBeGreaterThan(4);
    expect(hashState(rebuild(match))).toBe(hashState(state));
  });
});
