import { describe, expect, it } from 'vitest';
import { GRENADE_FUSE, SNAIL_R, activeSnail, createGame, girderSpot, step } from '../src/sim/game';
import { isSolid } from '../src/sim/terrain';
import { EMPTY_INPUT, WEAPONS, type GameState, type InputFrame, type SimEvent, type WeaponId } from '../src/sim/types';

function ready(seed = 9): GameState {
  const state = createGame({ seed });
  for (let i = 0; i < 120; i++) step(state, EMPTY_INPUT);
  return state;
}

function run(state: GameState, input: InputFrame, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(state, input));
  return events;
}

function select(state: GameState, w: WeaponId): void {
  step(state, { ...EMPTY_INPUT, weapon: WEAPONS.indexOf(w) + 1 });
  expect(state.teams[state.activeTeam].weapon).toBe(w);
}

function enemyInFront(state: GameState, gap: number) {
  const me = activeSnail(state)!;
  const enemy = state.snails.find((s) => s.alive && s.team !== me.team)!;
  enemy.x = me.x + me.facing * gap;
  enemy.y = me.y - 2;
  me.aim = 0;
  return enemy;
}

const fire = { ...EMPTY_INPUT, fire: true };
const count = (events: SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type).length;

describe('more weapons', () => {
  it('cluster bomb bursts into bomblets that go off on impact', () => {
    const state = ready();
    select(state, 'cluster');
    activeSnail(state)!.aim = 60;
    run(state, fire, 30);
    step(state, EMPTY_INPUT);
    expect(state.objects.map((o) => o.kind)).toEqual(['cluster']);
    const events = run(state, EMPTY_INPUT, GRENADE_FUSE + 5);
    expect(count(events, 'explosion')).toBeGreaterThanOrEqual(1);
    expect(state.objects.filter((o) => o.kind === 'bomblet').length).toBeGreaterThan(0);
    events.push(...run(state, EMPTY_INPUT, 300));
    expect(count(events, 'explosion')).toBeGreaterThan(2);
    expect(state.objects.some((o) => o.kind === 'bomblet')).toBe(false);
  });

  it('punch hurts and throws the snail in front', () => {
    const state = ready();
    select(state, 'punch');
    const me = activeSnail(state)!;
    const enemy = enemyInFront(state, 16);
    const hp = enemy.hp;
    const events = step(state, fire);
    expect(enemy.hp).toBe(hp - 30);
    expect(enemy.vx * me.facing).toBeGreaterThan(3);
    expect(enemy.vy).toBeLessThan(0);
    expect(events.some((e) => e.type === 'punch' && e.hit)).toBe(true);
    expect(state.phase).toBe('retreat');
  });

  it('poke nudges without damage', () => {
    const state = ready();
    select(state, 'poke');
    const me = activeSnail(state)!;
    const enemy = enemyInFront(state, 16);
    const hp = enemy.hp;
    step(state, fire);
    expect(enemy.hp).toBe(hp);
    expect(enemy.vx * me.facing).toBeGreaterThan(1);
  });

  it('a punch at thin air misses but still uses the turn', () => {
    const state = ready();
    select(state, 'punch');
    for (const s of state.snails) if (s !== activeSnail(state)) s.x = 99999;
    const events = step(state, fire);
    expect(events.some((e) => e.type === 'punch' && !e.hit)).toBe(true);
    expect(state.phase).toBe('retreat');
  });

  it('kamikaze flies along the aim and blows up on the first snail', () => {
    const state = ready();
    select(state, 'kamikaze');
    const me = activeSnail(state)!;
    // Flat ground along the flight.
    const t = state.terrain;
    for (let y = Math.floor(me.y) - 80; y < me.y + 40; y++) {
      for (let x = Math.floor(me.x) - 120; x < me.x + 120; x++) t.data[y * t.w + x] = y >= me.y + SNAIL_R ? 1 : 0;
    }
    const enemy = enemyInFront(state, 70);
    me.aim = 0;
    enemy.y = me.y;
    const hp = enemy.hp;
    const events = step(state, fire);
    expect(state.phase).toBe('kamikaze');
    for (let i = 0; i < 100 && state.phase === 'kamikaze'; i++) events.push(...step(state, EMPTY_INPUT));
    expect(count(events, 'explosion')).toBe(1);
    expect(me.alive).toBe(false);
    expect(enemy.hp).toBeLessThan(hp - 30);
    expect(state.phase).toBe('settling');
  });

  it('platform goes where the outline shows, never inside a snail', () => {
    const state = ready();
    select(state, 'girder');
    const me = activeSnail(state)!;
    me.aim = 40;
    const g = girderSpot(me);
    expect(isSolid(state.terrain, g.x, g.y)).toBe(false);
    step(state, fire);
    expect(state.terrain.data[Math.floor(g.y) * state.terrain.w + Math.floor(g.x)]).toBe(2);
    expect(isSolid(state.terrain, me.x, me.y)).toBe(false);
    expect(state.phase).toBe('retreat');
  });

  it('parachute floats down safely and the turn goes on', () => {
    const fall = (open: boolean) => {
      const state = ready();
      select(state, 'parachute');
      const me = activeSnail(state)!;
      me.y -= 300;
      me.grounded = false;
      step(state, EMPTY_INPUT);
      if (open) step(state, fire);
      expect(state.parachute).toBe(open);
      let fastest = 0;
      for (let i = 0; i < 600 && !me.grounded; i++) {
        step(state, EMPTY_INPUT);
        fastest = Math.max(fastest, me.vy);
      }
      return { state, me, fastest };
    };
    const soft = fall(true);
    expect(soft.fastest).toBeLessThanOrEqual(1.1);
    expect(soft.me.hp).toBe(100);
    expect(soft.state.parachute).toBe(false);
    expect(soft.state.phase).toBe('aiming');
    const hard = fall(false);
    expect(hard.me.hp).toBeLessThan(100);
  });

  it('parachute does not open on the ground', () => {
    const state = ready();
    select(state, 'parachute');
    step(state, fire);
    expect(state.parachute).toBe(false);
  });

  it('hide skips the move and the snail stays in its shell until its next turn', () => {
    const state = ready();
    select(state, 'hide');
    const me = activeSnail(state)!;
    const turn = state.turnNumber;
    step(state, fire);
    expect(me.hidden).toBe(true);
    expect(state.phase).toBe('settling');
    for (let i = 0; i < 2000 && state.turnNumber === turn; i++) step(state, EMPTY_INPUT);
    expect(state.turnNumber).toBe(turn + 1);
    expect(me.hidden).toBe(true);
  });
});
