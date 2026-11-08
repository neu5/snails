import { describe, expect, it } from 'vitest';
import { GRENADE_FUSE, HOMING_FUEL, SNAIL_R, activeSnail, createGame, girderSpot, hashState, step } from '../src/sim/game';
import { isSolid } from '../src/sim/terrain';
import { TurnRecorder, rebuild, type MatchRecord } from '../src/sim/turnlog';
import { EMPTY_INPUT, WEAPONS, WEAPON_ROWS, type GameState, type InputFrame, type SimEvent, type WeaponId } from '../src/sim/types';

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

describe('weapon menu', () => {
  it('lists every weapon once, at most three in a row', () => {
    expect(WEAPON_ROWS.flat().slice().sort()).toEqual([...WEAPONS].sort());
    expect(Math.max(...WEAPON_ROWS.map((r) => r.length))).toBeLessThanOrEqual(3);
  });
});

describe('homing missile', () => {
  /** Open sky over a low floor, with snails far from the flight path. */
  function sky(): GameState {
    const state = createGame({ seed: 9 });
    const t = state.terrain;
    t.data.forEach((_, i) => (t.data[i] = Math.floor(i / t.w) >= 900 ? 1 : 0));
    t.version++;
    state.snails.forEach((s, i) => {
      s.x = 300 + i * 40;
      s.y = 891;
    });
    run(state, EMPTY_INPUT, 60);
    return state;
  }
  const missile = (state: GameState) => state.objects.find((o) => o.kind === 'homing');
  /** Flies it to the end, returning its path and where it blew up. */
  function fly(state: GameState) {
    const path: { x: number; y: number }[] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < 700 && missile(state); i++) {
      const o = missile(state)!;
      path.push({ x: o.x, y: o.y });
      events.push(...step(state, EMPTY_INPUT));
    }
    const blast = events.find((e) => e.type === 'explosion');
    return { path, blast: blast && blast.type === 'explosion' ? blast : null };
  }
  function aimAndFire(state: GameState, x: number, y: number) {
    select(state, 'homing');
    step(state, { ...EMPTY_INPUT, target: { x, y } });
    step(state, { ...EMPTY_INPUT, fire: true });
  }

  it('does nothing until a target is picked', () => {
    const state = sky();
    select(state, 'homing');
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(missile(state)).toBeUndefined();
    expect(state.phase).toBe('aiming');
  });

  it('flies to a far target from any aim and blows up there', () => {
    for (const [x, y, aim] of [
      [1500, 300, 45],
      [100, 600, 60],
      [700, 200, 20],
      [420, 760, 80],
    ]) {
      const state = sky();
      activeSnail(state)!.aim = aim;
      aimAndFire(state, x, y);
      expect(missile(state)).toBeDefined();
      const { blast } = fly(state);
      expect(blast).not.toBeNull();
      expect(Math.hypot(blast!.x - x, blast!.y - y)).toBeLessThan(20);
    }
  });

  it('is not smart: terrain in the way stops it', () => {
    const state = sky();
    const t = state.terrain;
    for (let y = 300; y < 900; y++) for (let x = 900; x < 960; x++) t.data[y * t.w + x] = 1;
    aimAndFire(state, 1400, 700);
    const { blast } = fly(state);
    expect(blast!.x).toBeLessThan(1000);
  });

  it('curves a little instead of flying a ruled line', () => {
    const state = sky();
    aimAndFire(state, 2000, 300);
    const { path } = fly(state);
    const a = path[60];
    const b = path[path.length - 10];
    // Largest distance from the straight line between two points of the cruise.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const off = Math.max(...path.slice(60, -10).map((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len));
    expect(off).toBeGreaterThan(1);
    expect(off).toBeLessThan(40);
  });

  it('runs out of fuel and drops', () => {
    const state = sky();
    activeSnail(state)!.aim = 45;
    select(state, 'homing');
    step(state, { ...EMPTY_INPUT, target: { x: 2550, y: 100 } });
    state.snails.forEach((s) => (s.x = 20));
    step(state, { ...EMPTY_INPUT, fire: true });
    run(state, EMPTY_INPUT, HOMING_FUEL + 5);
    const o = missile(state)!;
    const v = o.vy;
    run(state, EMPTY_INPUT, 20);
    expect(missile(state)!.vy).toBeGreaterThan(v + 1);
  });

  it('replays the same from the turn log', () => {
    const state = createGame({ seed: 21 });
    const match: MatchRecord = { config: { ...state.config }, turns: [] };
    const recorder = new TurnRecorder(state);
    for (let i = 0; i < 60; i++) recorder.step(EMPTY_INPUT);
    recorder.step({ ...EMPTY_INPUT, weapon: WEAPONS.indexOf('homing') + 1 });
    recorder.step({ ...EMPTY_INPUT, target: { x: 1234.7, y: 321.9 } });
    expect(state.target).toEqual({ x: 1232, y: 320 });
    recorder.step({ ...EMPTY_INPUT, fire: true });
    for (let i = 0; i < 2000 && match.turns.length === 0; i++) {
      const { turn } = recorder.step(EMPTY_INPUT);
      if (turn) match.turns.push(turn);
    }
    expect(match.turns).toHaveLength(1);
    expect(hashState(rebuild(match))).toBe(hashState(state));
  });
});

describe('change snail and surrender', () => {
  it('change hands the turn to the next living teammate and keeps the turn going', () => {
    const state = ready();
    const first = activeSnail(state)!;
    const mates = state.snails.filter((s) => s.team === first.team);
    expect(mates.length).toBeGreaterThan(1);
    mates[(mates.indexOf(first) + 1) % mates.length].alive = false;
    select(state, 'select');
    const events = step(state, { ...EMPTY_INPUT, fire: true });
    const now = activeSnail(state)!;
    expect(now.team).toBe(first.team);
    expect(now).not.toBe(first);
    expect(now.alive).toBe(true);
    expect(events.some((e) => e.type === 'select' && e.snailId === now.id)).toBe(true);
    expect(state.phase).toBe('aiming');
    expect(state.shotsFired).toBe(0);
    // The new snail can still use a weapon this turn.
    select(state, 'gun');
  });

  it('change is refused once the snail has moved', () => {
    const state = ready();
    const first = activeSnail(state)!;
    run(state, { ...EMPTY_INPUT, [first.facing > 0 ? 'right' : 'left']: true }, 30);
    expect(state.moved).toBe(true);
    select(state, 'select');
    const events = step(state, { ...EMPTY_INPUT, fire: true });
    expect(activeSnail(state)).toBe(first);
    expect(events.some((e) => e.type === 'selectRefused')).toBe(true);
  });

  it('the snail handed the turn may still change on before it moves', () => {
    const state = ready();
    const first = activeSnail(state)!;
    select(state, 'select');
    step(state, { ...EMPTY_INPUT, fire: true });
    const second = activeSnail(state)!;
    expect(state.moved).toBe(false);
    step(state, EMPTY_INPUT);
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(activeSnail(state)).not.toBe(second);
    expect(activeSnail(state)!.team).toBe(first.team);
  });

  it('change does nothing in the air', () => {
    const state = ready();
    const first = activeSnail(state)!;
    select(state, 'select');
    first.grounded = false;
    first.vy = -2;
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(activeSnail(state)).toBe(first);
  });

  it('surrender puts the team out and the other team wins', () => {
    const state = ready();
    const team = state.activeTeam;
    select(state, 'surrender');
    const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
    for (let i = 0; i < 1000 && state.phase !== 'gameover'; i++) events.push(...step(state, EMPTY_INPUT));
    expect(events.some((e) => e.type === 'surrender' && e.team === team)).toBe(true);
    expect(state.teams[team].surrendered).toBe(true);
    expect(state.phase).toBe('gameover');
    expect(state.winner).toBe(1 - team);
  });
});
