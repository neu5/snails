import { describe, expect, it } from 'vitest';
import { Bot } from '../src/ai/bot';
import { createGame, hashState, step, activeSnail } from '../src/sim/game';
import { EMPTY_INPUT, type GameState, type InputFrame } from '../src/sim/types';

function runBots(seed: number, ticks: number): { state: GameState; inputs: InputFrame[] } {
  const state = createGame({ seed, startHp: 60 });
  const bots = [new Bot(seed + 1), new Bot(seed + 2)];
  const inputs: InputFrame[] = [];
  for (let i = 0; i < ticks && state.phase !== 'gameover'; i++) {
    const inp = bots[state.activeTeam].input(state);
    inputs.push(inp);
    step(state, inp);
  }
  return { state, inputs };
}

describe('simulation', () => {
  it('generates identical maps for the same seed', () => {
    expect(hashState(createGame({ seed: 42 }))).toBe(hashState(createGame({ seed: 42 })));
    expect(hashState(createGame({ seed: 42 }))).not.toBe(hashState(createGame({ seed: 43 })));
  });

  it('replaying a recorded input log reproduces the exact state', () => {
    const { state, inputs } = runBots(7, 6000);
    const replay = createGame({ seed: 7, startHp: 60 });
    for (const inp of inputs) step(replay, inp);
    expect(hashState(replay)).toBe(hashState(state));
    expect(state.turnNumber).toBeGreaterThan(3);
  });

  it('bot games end with a winner', () => {
    const { state } = runBots(3, 60 * 60 * 15);
    expect(state.phase).toBe('gameover');
    expect(state.winner).not.toBeNull();
  });

  it('turn timer passes the turn to the other team', () => {
    const state = createGame({ seed: 5, turnSeconds: 2 });
    expect(state.activeTeam).toBe(0);
    for (let i = 0; i < 60 * 4; i++) step(state, EMPTY_INPUT);
    expect(state.activeTeam).toBe(1);
  });

  it('firing damages terrain', () => {
    const state = createGame({ seed: 9 });
    for (let i = 0; i < 120; i++) step(state, EMPTY_INPUT);
    const s = activeSnail(state)!;
    s.aim = -60;
    const v = state.terrain.version;
    for (let i = 0; i < 20; i++) step(state, { ...EMPTY_INPUT, fire: true });
    for (let i = 0; i < 300 && state.phase === 'flying'; i++) step(state, EMPTY_INPUT);
    for (let i = 0; i < 2; i++) step(state, EMPTY_INPUT);
    expect(state.terrain.version).toBeGreaterThan(v);
  });
});
