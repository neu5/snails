import { describe, expect, it } from 'vitest';
import {
  DIG_TOOLS,
  DYNAMITE_FUSE,
  GRENADE_FUSE,
  JUMP_WAIT,
  MINE_ARM_TICKS,
  RETREAT_TICKS,
  SNAIL_R,
  TORCH_AIM,
  WATER_Y,
  activeSnail,
  createGame,
  hashState,
  step,
} from '../src/sim/game';
import { Rng } from '../src/sim/math';
import { carveCircle } from '../src/sim/terrain';
import { TurnRecorder, rebuild, type MatchRecord } from '../src/sim/turnlog';
import { EMPTY_INPUT, WEAPONS, type GameState, type InputFrame, type SimEvent, type WeaponId } from '../src/sim/types';

const key = (w: WeaponId): number => WEAPONS.indexOf(w) + 1;

/** A fresh game with everyone landed and the first snail ready to act. */
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
  step(state, { ...EMPTY_INPUT, weapon: key(w) });
  expect(state.teams[state.activeTeam].weapon).toBe(w);
}

/** Puts the nearest enemy right in front of the active snail, at aim 0. */
function enemyInFront(state: GameState, gap = 22) {
  const me = activeSnail(state)!;
  const enemy = state.snails.find((s) => s.alive && s.team !== me.team)!;
  enemy.x = me.x + me.facing * gap;
  enemy.y = me.y - 2;
  me.aim = 0;
  return enemy;
}

const count = (events: SimEvent[], type: SimEvent['type']) => events.filter((e) => e.type === type).length;

describe('weapons', () => {
  it('number keys pick a weapon, but not after using one', () => {
    const state = ready();
    select(state, 'gun');
    step(state, { ...EMPTY_INPUT, fire: true });
    step(state, { ...EMPTY_INPUT, weapon: key('dynamite') });
    expect(state.teams[state.activeTeam].weapon).toBe('gun');
  });

  it('gun fires two hitscan shots, then the snail retreats', () => {
    const state = ready();
    select(state, 'gun');
    const enemy = enemyInFront(state);
    const hp = enemy.hp;
    const first = step(state, { ...EMPTY_INPUT, fire: true });
    expect(count(first, 'bullet')).toBe(1);
    expect(enemy.hp).toBe(hp - 25);
    expect(state.phase).toBe('aiming');
    step(state, EMPTY_INPUT);
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(state.phase).toBe('retreat');
  });

  it('uzi fires a burst of ten bullets', () => {
    const state = ready();
    select(state, 'uzi');
    const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
    expect(state.phase).toBe('firing');
    events.push(...run(state, EMPTY_INPUT, 40));
    expect(count(events, 'bullet')).toBe(10);
    expect(state.phase).toBe('retreat');
  });

  it('grenade bounces and blows when its fuse runs out', () => {
    const state = ready();
    select(state, 'grenade');
    activeSnail(state)!.aim = 60;
    run(state, { ...EMPTY_INPUT, fire: true }, 30);
    step(state, EMPTY_INPUT);
    expect(state.objects.map((o) => o.kind)).toEqual(['grenade']);
    const early = run(state, EMPTY_INPUT, GRENADE_FUSE - 5);
    expect(count(early, 'explosion')).toBe(0);
    const late = run(state, EMPTY_INPUT, 10);
    expect(count(late, 'explosion')).toBe(1);
    expect(state.objects).toHaveLength(0);
  });

  it('dynamite lets the snail walk away before a big blast', () => {
    const state = ready();
    select(state, 'dynamite');
    const me = activeSnail(state)!;
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(state.phase).toBe('retreat');
    const x = me.x;
    run(state, { ...EMPTY_INPUT, [me.facing > 0 ? 'left' : 'right']: true }, RETREAT_TICKS - 5);
    expect(me.x).not.toBe(x);
    const events = run(state, EMPTY_INPUT, DYNAMITE_FUSE);
    const blast = events.find((e) => e.type === 'explosion');
    expect(blast && blast.type === 'explosion' && blast.r).toBe(62);
  });

  it('a mine blows up its owner who stands still', () => {
    const state = ready();
    select(state, 'mine');
    const me = activeSnail(state)!;
    const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
    // Drop it right at the snail's feet, so a slope cannot roll it out of reach.
    state.objects[0].x = me.x;
    state.objects[0].vx = 0;
    events.push(...run(state, EMPTY_INPUT, MINE_ARM_TICKS + 80));
    expect(count(events, 'mineTriggered')).toBe(1);
    expect(count(events, 'explosion')).toBe(1);
  });

  it('mines stay between turns and go off when a snail comes near', () => {
    const state = ready();
    select(state, 'mine');
    const me = activeSnail(state)!;
    step(state, { ...EMPTY_INPUT, fire: true });
    // Walk away before it arms, or it gets us.
    const away = { ...EMPTY_INPUT, [me.facing > 0 ? 'left' : 'right']: true };
    run(state, away, RETREAT_TICKS);
    const turn = state.turnNumber;
    for (let i = 0; i < 2000 && state.turnNumber === turn; i++) step(state, EMPTY_INPUT);
    expect(state.turnNumber).toBe(turn + 1);
    const mine = state.objects.find((o) => o.kind === 'mine')!;
    expect(mine.resting).toBe(true);
    expect(mine.age).toBeGreaterThanOrEqual(MINE_ARM_TICKS);
    const victim = activeSnail(state)!;
    victim.x = mine.x + 10;
    victim.y = mine.y - 8;
    const events = run(state, EMPTY_INPUT, 80);
    expect(count(events, 'mineTriggered')).toBe(1);
    expect(count(events, 'explosion')).toBe(1);
    expect(state.objects.some((o) => o.kind === 'mine')).toBe(false);
  });

  it('drill digs straight down and carries the snail', () => {
    const state = ready();
    select(state, 'drill');
    const me = activeSnail(state)!;
    const { x, y } = me;
    const v = state.terrain.version;
    const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
    expect(state.phase).toBe('digging');
    events.push(...run(state, EMPTY_INPUT, 200));
    expect(count(events, 'dig')).toBeGreaterThan(10);
    expect(state.terrain.version).toBeGreaterThan(v);
    expect(state.phase).toBe('retreat');
    expect(me.x).toBe(x);
    expect(me.y).toBeGreaterThan(y + 60);
    expect(me.hp).toBe(100);
  });

  it('blowtorch cuts a tunnel along the aim', () => {
    const state = ready();
    select(state, 'torch');
    const me = activeSnail(state)!;
    me.aim = 0;
    const x = me.x;
    run(state, { ...EMPTY_INPUT, fire: true }, 1);
    expect(state.phase).toBe('digging');
    // Arrow keys do nothing while the tool runs.
    run(state, { ...EMPTY_INPUT, left: true, right: true, up: true }, 100);
    expect(me.aim).toBe(0);
    run(state, EMPTY_INPUT, 100);
    expect(state.phase).toBe('retreat');
    expect((me.x - x) * me.facing).toBeGreaterThan(100);
  });

  it('drill and blowtorch hurt a snail in their way', () => {
    for (const tool of ['drill', 'torch'] as const) {
      const state = ready();
      select(state, tool);
      const me = activeSnail(state)!;
      me.aim = 0;
      const enemy = state.snails.find((s) => s.alive && s.team !== me.team)!;
      if (tool === 'drill') {
        enemy.x = me.x;
        enemy.y = me.y + 24;
      } else {
        enemy.x = me.x + me.facing * 24;
        enemy.y = me.y;
      }
      const hp = enemy.hp;
      const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
      events.push(...run(state, EMPTY_INPUT, 60));
      const hits = events.filter((e) => e.type === 'damage' && e.snailId === enemy.id).length;
      expect(hits).toBeGreaterThan(0);
      expect(enemy.hp).toBe(hp - hits * DIG_TOOLS[tool].damage);
      expect(me.hp).toBe(100);
    }
  });

  it('drill and blowtorch never take a snail below 1 HP', () => {
    const state = ready();
    select(state, 'drill');
    const me = activeSnail(state)!;
    const enemy = state.snails.find((s) => s.alive && s.team !== me.team)!;
    enemy.x = me.x;
    enemy.y = me.y + 24;
    enemy.hp = 3;
    run(state, { ...EMPTY_INPUT, fire: true }, 1);
    run(state, EMPTY_INPUT, 60);
    expect(enemy.hp).toBe(1);
  });

  it('a blowtorch run out over a gap falls and keeps cutting', () => {
    const state = ready();
    select(state, 'torch');
    const me = activeSnail(state)!;
    me.aim = 0;
    // A pit just ahead, shallow enough that the fall does not hurt.
    for (let i = 0; i < 5; i++) carveCircle(state.terrain, me.x + me.facing * (45 + i * 15), me.y + 10, 30);
    const y = me.y;
    run(state, { ...EMPTY_INPUT, fire: true }, 1);
    const events = run(state, EMPTY_INPUT, 90);
    expect(me.y).toBeGreaterThan(y + 20);
    expect(me.hp).toBe(100);
    expect(state.phase).toBe('digging');
    events.push(...run(state, EMPTY_INPUT, 100));
    expect(state.phase).toBe('retreat');
    expect(count(events, 'dig')).toBeGreaterThan(25);
  });

  it('a blowtorch cut up out of the ground does not fly on', () => {
    const state = ready();
    select(state, 'torch');
    const me = activeSnail(state)!;
    me.aim = TORCH_AIM;
    // Flat ground around the snail, open air above it.
    const t = state.terrain;
    for (let y = Math.floor(me.y) - 120; y < me.y + 60; y++) {
      for (let x = Math.floor(me.x) - 120; x < me.x + 120; x++) t.data[y * t.w + x] = y >= me.y + SNAIL_R ? 1 : 0;
    }
    const y = me.y;
    run(state, { ...EMPTY_INPUT, fire: true }, 1);
    let top = me.y;
    for (let i = 0; i < 179 && state.phase === 'digging'; i++) {
      step(state, EMPTY_INPUT);
      top = Math.min(top, me.y);
    }
    expect(top).toBeGreaterThan(y - 15);
  });

  it('dig tools do not start in mid-air', () => {
    const state = ready();
    select(state, 'torch');
    const me = activeSnail(state)!;
    step(state, { ...EMPTY_INPUT, jump: true });
    run(state, EMPTY_INPUT, JUMP_WAIT + 3);
    expect(me.grounded).toBe(false);
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(state.phase).toBe('aiming');
    expect(state.dig).toBeNull();
  });

  it('a digging snail hurt by a fall drops the tool and its move ends', () => {
    const state = ready();
    select(state, 'torch');
    const me = activeSnail(state)!;
    me.aim = 0;
    // A deep pit ahead: the fall hurts.
    for (let i = 0; i < 8; i++) carveCircle(state.terrain, me.x + me.facing * (50 + i * 15), me.y + 60, 70);
    run(state, { ...EMPTY_INPUT, fire: true }, 1);
    for (let i = 0; i < 170 && me.hp === 100; i++) step(state, EMPTY_INPUT);
    expect(me.hp).toBeLessThan(100);
    // The fall ends the move outright.
    expect(state.phase).toBe('settling');
    expect(state.dig).toBeNull();
  });

  it('a second fire press stops the tool early', () => {
    const state = ready();
    select(state, 'drill');
    const me = activeSnail(state)!;
    const y = me.y;
    // Holding fire from the first press does not stop it.
    run(state, { ...EMPTY_INPUT, fire: true }, 20);
    expect(state.phase).toBe('digging');
    run(state, EMPTY_INPUT, 20);
    const deep = me.y;
    step(state, { ...EMPTY_INPUT, fire: true });
    expect(state.phase).toBe('retreat');
    expect(state.dig).toBeNull();
    run(state, EMPTY_INPUT, 30);
    expect(me.y).toBeGreaterThan(y + 20);
    expect(me.y).toBeLessThan(deep + 10);
  });

  it('drilling into the water drowns the snail', () => {
    const state = ready();
    select(state, 'drill');
    const me = activeSnail(state)!;
    me.y = WATER_Y - 40;
    const events = run(state, { ...EMPTY_INPUT, fire: true }, 1);
    events.push(...run(state, EMPTY_INPUT, 120));
    expect(count(events, 'drown')).toBe(1);
    expect(me.alive).toBe(false);
  });

  it('blowtorch aim stops short of straight up and down', () => {
    const state = ready();
    const me = activeSnail(state)!;
    me.aim = 80;
    select(state, 'torch');
    expect(me.aim).toBe(TORCH_AIM);
    run(state, { ...EMPTY_INPUT, up: true }, 30);
    expect(me.aim).toBe(TORCH_AIM);
    run(state, { ...EMPTY_INPUT, down: true }, 200);
    expect(me.aim).toBe(-TORCH_AIM);
  });

  it('a match mixing every weapon replays to the same state', () => {
    const state = createGame({ seed: 21, startHp: 80, turnSeconds: 6 });
    const match: MatchRecord = { config: { ...state.config }, turns: [] };
    const recorder = new TurnRecorder(state);
    const rng = new Rng(5);
    let input: InputFrame = EMPTY_INPUT;
    for (let i = 0; i < 60 * 60 * 6 && state.phase !== 'gameover'; i++) {
      if (i % 20 === 0) {
        input = {
          ...EMPTY_INPUT,
          left: rng.next() < 0.2,
          right: rng.next() < 0.2,
          up: rng.next() < 0.3,
          jump: rng.next() < 0.05,
          fire: rng.next() < 0.3,
          weapon: rng.next() < 0.3 ? rng.int(1, WEAPONS.length + 1) : 0,
        };
      }
      const { turn } = recorder.step(input);
      if (turn) match.turns.push(turn);
    }
    expect(match.turns.length).toBeGreaterThan(10);
    expect(hashState(rebuild(match))).toBe(hashState(state));
  });
});

describe('jumping', () => {
  function airborne(state: GameState, me: ReturnType<typeof activeSnail> & object) {
    let top = me.y;
    for (let i = 0; i < 200 && !me.grounded; i++) {
      step(state, EMPTY_INPUT);
      top = Math.min(top, me.y);
    }
    return top;
  }

  it('enter waits a moment, then jumps forward', () => {
    const state = ready();
    const me = activeSnail(state)!;
    const { x, y } = me;
    step(state, { ...EMPTY_INPUT, jump: true });
    run(state, EMPTY_INPUT, JUMP_WAIT - 2);
    expect(me.grounded).toBe(true);
    run(state, EMPTY_INPUT, 3);
    expect(me.grounded).toBe(false);
    const top = airborne(state, me);
    expect((me.x - x) * me.facing).toBeGreaterThan(20);
    expect(y - top).toBeGreaterThan(8);
    expect(y - top).toBeLessThan(22);
  });

  it('a quick second enter jumps back and higher instead', () => {
    const a = ready();
    const me = activeSnail(a)!;
    const y = me.y;
    step(a, { ...EMPTY_INPUT, jump: true });
    run(a, EMPTY_INPUT, JUMP_WAIT + 1);
    const forwardTop = airborne(a, me);

    const b = ready();
    const him = activeSnail(b)!;
    const x = him.x;
    step(b, { ...EMPTY_INPUT, jump: true });
    run(b, EMPTY_INPUT, 3);
    step(b, { ...EMPTY_INPUT, jump: true });
    const backTop = airborne(b, him);
    expect((him.x - x) * him.facing).toBeLessThan(-10);
    expect(y - backTop).toBeGreaterThan(y - forwardTop);
    expect(y - backTop).toBeLessThan(35);
  });

  it('a painful fall ends the move', () => {
    const state = ready();
    const me = activeSnail(state)!;
    me.y -= 200;
    me.grounded = false;
    for (let i = 0; i < 300 && me.hp === 100; i++) step(state, EMPTY_INPUT);
    expect(me.hp).toBeLessThan(100);
    expect(state.phase).toBe('settling');
  });

  it('a short fall does not end the move', () => {
    const state = ready();
    const me = activeSnail(state)!;
    me.y -= 30;
    me.grounded = false;
    run(state, EMPTY_INPUT, 60);
    expect(me.grounded).toBe(true);
    expect(me.hp).toBe(100);
    expect(state.phase).toBe('aiming');
  });

  it('a late second enter does nothing in the air', () => {
    const state = ready();
    const me = activeSnail(state)!;
    const x = me.x;
    step(state, { ...EMPTY_INPUT, jump: true });
    run(state, EMPTY_INPUT, JUMP_WAIT + 5);
    expect(me.grounded).toBe(false);
    step(state, { ...EMPTY_INPUT, jump: true });
    airborne(state, me);
    expect((me.x - x) * me.facing).toBeGreaterThan(0);
  });
});
