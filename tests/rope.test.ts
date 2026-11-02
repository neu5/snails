import { describe, expect, it } from 'vitest';
import { SNAIL_R, activeSnail, createGame, step } from '../src/sim/game';
import { EMPTY_INPUT, WEAPONS, type GameState, type InputFrame, type SimEvent } from '../src/sim/types';

const FLOOR = 600;
const CEILING = 400;

/** A flat floor with a flat ceiling 200 px above it; everyone stands on the floor. */
function arena(): GameState {
  const state = createGame({ seed: 9 });
  const t = state.terrain;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) t.data[y * t.w + x] = y >= FLOOR || (y >= CEILING - 20 && y < CEILING) ? 1 : 0;
  }
  t.version++;
  state.snails.forEach((s, i) => {
    s.x = 100 + i * 150;
    s.y = FLOOR - SNAIL_R - 1;
  });
  for (let i = 0; i < 60; i++) step(state, EMPTY_INPUT);
  step(state, { ...EMPTY_INPUT, weapon: WEAPONS.indexOf('rope') + 1 });
  return state;
}

function run(state: GameState, input: InputFrame, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(state, input));
  return events;
}

const fire = { ...EMPTY_INPUT, fire: true };

/** Throws the hook and waits for it to stick or fall short. */
function shoot(state: GameState): SimEvent[] {
  const events = step(state, fire);
  for (let i = 0; i < 60 && state.hook; i++) events.push(...step(state, EMPTY_INPUT));
  return events;
}

describe('rope', () => {
  it('sticks to the ceiling, reels in, and does not use up the turn', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 80;
    const events = shoot(state);
    expect(events.some((e) => e.type === 'rope' && e.hit)).toBe(true);
    expect(state.rope).not.toBeNull();
    const len = state.rope!.len;
    const y = me.y;
    run(state, { ...EMPTY_INPUT, up: true }, 60);
    expect(state.rope!.len).toBeLessThan(len - 60);
    expect(me.y).toBeLessThan(y - 60);
    expect(state.phase).toBe('aiming');
    expect(state.shotsFired).toBe(0);
    expect(me.aim).toBe(80);
  });

  it('the hook takes a moment to fly out', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 80;
    step(state, fire);
    expect(state.hook).not.toBeNull();
    expect(state.rope).toBeNull();
    let ticks = 1;
    while (state.hook) {
      step(state, EMPTY_INPUT);
      ticks++;
    }
    // About 190 px up to the ceiling at 8 px a tick.
    expect(ticks).toBeGreaterThan(20);
    expect(state.rope).not.toBeNull();
  });

  it('misses when nothing is in reach', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 0;
    const events = shoot(state);
    expect(events.some((e) => e.type === 'rope' && !e.hit)).toBe(true);
    expect(state.rope).toBeNull();
  });

  it('left and right pump the swing; fire lets go and keeps the speed', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 88;
    shoot(state);
    run(state, EMPTY_INPUT, 1);
    run(state, { ...EMPTY_INPUT, up: true }, 40);
    const x0 = me.x;
    let reach = 0;
    for (let i = 0; i < 240; i++) {
      step(state, { ...EMPTY_INPUT, right: i % 80 < 40, left: i % 80 >= 40 });
      reach = Math.max(reach, Math.abs(me.x - x0));
    }
    expect(reach).toBeGreaterThan(40);
    const speed = Math.hypot(me.vx, me.vy);
    step(state, fire);
    expect(state.rope).toBeNull();
    expect(Math.hypot(me.vx, me.vy)).toBeGreaterThan(speed * 0.8);
  });

  it('bends around a corner and straightens back', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 88;
    shoot(state);
    const anchor = state.rope!.pivots[0];
    // A block hanging from the ceiling just right of the anchor.
    const t = state.terrain;
    for (let y = CEILING; y < CEILING + 40; y++) for (let x = Math.floor(anchor.x) + 10; x < anchor.x + 30; x++) t.data[y * t.w + x] = 1;
    // Swing from the left; on the way up the right side the rope catches on the block.
    me.x = anchor.x - 87;
    me.y = anchor.y + 50;
    me.vx = 0;
    me.vy = 0;
    state.rope!.len = 100;
    const counts: number[] = [];
    for (let i = 0; i < 300; i++) {
      step(state, EMPTY_INPUT);
      counts.push(state.rope!.pivots.length);
    }
    const wrapped = counts.indexOf(2);
    expect(wrapped).toBeGreaterThan(0);
    expect(counts.slice(wrapped).indexOf(1)).toBeGreaterThan(0);
  });

  it('a fast swing knocks another snail away', () => {
    const state = arena();
    const me = activeSnail(state)!;
    const other = state.snails.find((s) => s !== me)!;
    me.aim = 88;
    shoot(state);
    const anchor = state.rope!.pivots[0];
    other.x = anchor.x;
    other.y = FLOOR - SNAIL_R - 1;
    // Start the swing from the side, rope taut, so it sweeps through the bottom.
    const len = FLOOR - SNAIL_R - 1 - anchor.y;
    me.x = anchor.x - len;
    me.y = anchor.y;
    me.vx = 0;
    me.vy = 0;
    state.rope!.len = len;
    const events = run(state, EMPTY_INPUT, 120);
    expect(events.some((e) => e.type === 'knock')).toBe(true);
    expect(other.x).toBeGreaterThan(anchor.x + 10);
  });

  it('enter on the rope drops dynamite or a mine and keeps swinging', () => {
    for (const kind of ['dynamite', 'mine'] as const) {
      const state = arena();
      const me = activeSnail(state)!;
      me.aim = 80;
      shoot(state);
      run(state, { ...EMPTY_INPUT, up: true }, 40);
      step(state, { ...EMPTY_INPUT, weapon: WEAPONS.indexOf(kind) + 1 });
      expect(state.teams[state.activeTeam].weapon).toBe(kind);
      step(state, { ...EMPTY_INPUT, jump: true });
      expect(state.objects.map((o) => o.kind)).toContain(kind);
      expect(state.rope).not.toBeNull();
      expect(state.phase).toBe('retreat');
      // Still on the rope: reel in and swing during the retreat, then let go with Space.
      const len = state.rope!.len;
      run(state, { ...EMPTY_INPUT, up: true }, 10);
      expect(state.rope!.len).toBeLessThan(len);
      step(state, fire);
      expect(state.rope).toBeNull();
    }
  });

  it('enter on the rope with another weapon picked just lets go', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 80;
    shoot(state);
    step(state, EMPTY_INPUT);
    step(state, { ...EMPTY_INPUT, jump: true });
    expect(state.rope).toBeNull();
    expect(state.objects).toHaveLength(0);
    expect(state.phase).toBe('aiming');
  });

  it('turn end drops the rope', () => {
    const state = arena();
    const me = activeSnail(state)!;
    me.aim = 80;
    shoot(state);
    for (let i = 0; i < 4000 && state.phase === 'aiming'; i++) step(state, EMPTY_INPUT);
    expect(state.rope).toBeNull();
  });
});
