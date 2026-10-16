import { Rng, clamp, dcos, degToRad, dsin } from './math';
import { carveCircle, generateTerrain, isSolid, type Terrain } from './terrain';
import {
  EMPTY_INPUT,
  type GameConfig,
  type GameState,
  type InputFrame,
  type Projectile,
  type SimEvent,
  type Snail,
} from './types';

export const TICK_RATE = 60;
export const MAP_W = 1280;
export const MAP_H = 720;
export const WATER_Y = 684;

export const SNAIL_R = 8;
const WALK_SPEED = 0.7;
const MAX_CLIMB = 4;
const JUMP_VX = 1.7;
const JUMP_VY = -3.3;
const GRAVITY = 0.12;
const SAFE_FALL_SPEED = 5.2;
const FALL_DAMAGE_PER_SPEED = 7;

const AIM_MIN = -85;
const AIM_MAX = 88;
export const POWER_TICKS = 72;
export const MAX_LAUNCH_SPEED = 11;
export const PROJECTILE_GRAVITY = 0.12;
const MAX_WIND = 0.035;

const BLAST_TERRAIN_R = 34;
const BLAST_DAMAGE_R = 58;
const BLAST_MAX_DAMAGE = 50;
const BLAST_KNOCKBACK = 6.5;

const SETTLE_MIN_TICKS = 45;
const SETTLE_MAX_TICKS = 600;

const TEAM_NAMES = ['Garden Gliders', 'Mossback Raiders'];
const SNAIL_NAMES = [
  ['Pebble', 'Slick', 'Dewdrop', 'Clover'],
  ['Grub', 'Mudlark', 'Spiral', 'Thistle'],
];

export const DEFAULT_CONFIG: GameConfig = {
  seed: 1,
  snailsPerTeam: 3,
  startHp: 100,
  turnSeconds: 30,
};

const CIRCLE_OFFSETS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dy = -SNAIL_R; dy <= SNAIL_R; dy++) {
    for (let dx = -SNAIL_R; dx <= SNAIL_R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= SNAIL_R * SNAIL_R && d2 >= (SNAIL_R - 2) * (SNAIL_R - 2)) out.push([dx, dy]);
    }
  }
  return out;
})();

function snailHitsTerrain(t: Terrain, x: number, y: number): boolean {
  for (const [dx, dy] of CIRCLE_OFFSETS) if (isSolid(t, x + dx, y + dy)) return true;
  return false;
}

function findSurfaceY(t: Terrain, x: number): number | null {
  for (let y = SNAIL_R; y < WATER_Y - SNAIL_R; y++) {
    if (snailHitsTerrain(t, x, y + 1)) return snailHitsTerrain(t, x, y) ? null : y;
  }
  return null;
}

export function createGame(partial: Partial<GameConfig> = {}): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...partial };
  const rng = new Rng(config.seed >>> 0);
  const terrain = generateTerrain(MAP_W, MAP_H, WATER_Y, rng);

  const snails: Snail[] = [];
  const teamCount = 2;
  const total = config.snailsPerTeam * teamCount;
  const usedX: number[] = [];
  for (let i = 0; i < total; i++) {
    const team = i % teamCount;
    let x = 0;
    let y: number | null = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      x = Math.floor(rng.range(MAP_W * 0.1, MAP_W * 0.9));
      if (usedX.some((u) => Math.abs(u - x) < 70) && attempt < 300) continue;
      y = findSurfaceY(terrain, x);
      if (y !== null && y < WATER_Y - 40) break;
      y = null;
    }
    if (y === null) y = 0;
    usedX.push(x);
    snails.push({
      id: i,
      team,
      name: SNAIL_NAMES[team][Math.floor(i / teamCount) % SNAIL_NAMES[team].length],
      x,
      y,
      vx: 0,
      vy: 0,
      hp: config.startHp,
      alive: true,
      grounded: false,
      facing: x < MAP_W / 2 ? 1 : -1,
      aim: 30,
    });
  }

  const state: GameState = {
    config,
    tick: 0,
    rng: rng.state,
    terrain,
    snails,
    teams: TEAM_NAMES.slice(0, teamCount).map((name, id) => ({ id, name, nextIndex: 0 })),
    activeTeam: 0,
    activeSnailId: 0,
    turnNumber: 0,
    phase: 'aiming',
    turnTicksLeft: 0,
    power: 0,
    charging: false,
    projectile: null,
    wind: 0,
    settleTicks: 0,
    winner: null,
    prevInput: { ...EMPTY_INPUT },
  };
  startTurn(state, 0, []);
  return state;
}

function random(state: GameState): number {
  const r = new Rng(state.rng);
  const v = r.next();
  state.rng = r.state;
  return v;
}

export function teamSnails(state: GameState, team: number): Snail[] {
  return state.snails.filter((s) => s.team === team);
}

export function activeSnail(state: GameState): Snail | undefined {
  return state.snails[state.activeSnailId];
}

function startTurn(state: GameState, team: number, events: SimEvent[]): void {
  const t = state.teams[team];
  const members = teamSnails(state, team);
  let pick = members[0];
  for (let k = 0; k < members.length; k++) {
    const cand = members[(t.nextIndex + k) % members.length];
    if (cand.alive) {
      pick = cand;
      t.nextIndex = (members.indexOf(cand) + 1) % members.length;
      break;
    }
  }
  state.activeTeam = team;
  state.activeSnailId = pick.id;
  state.turnNumber++;
  state.phase = 'aiming';
  state.turnTicksLeft = state.config.turnSeconds * TICK_RATE;
  state.power = 0;
  state.charging = false;
  state.projectile = null;
  state.settleTicks = 0;
  state.wind = Math.round((random(state) * 2 - 1) * MAX_WIND * 10000) / 10000;
  events.push({ type: 'turn', team, snailId: pick.id });
}

function finishTurn(state: GameState, events: SimEvent[]): void {
  for (const s of state.snails) {
    if (s.alive && s.hp <= 0) {
      s.alive = false;
      s.hp = 0;
      events.push({ type: 'death', snailId: s.id });
    }
  }
  const aliveTeams = state.teams.filter((t) => state.snails.some((s) => s.alive && s.team === t.id));
  if (aliveTeams.length <= 1) {
    state.phase = 'gameover';
    state.winner = aliveTeams.length === 1 ? aliveTeams[0].id : -1;
    state.projectile = null;
    events.push({ type: 'gameover', winner: state.winner });
    return;
  }
  let next = state.activeTeam;
  do next = (next + 1) % state.teams.length;
  while (!aliveTeams.some((t) => t.id === next));
  startTurn(state, next, events);
}

export function aimVector(s: Snail): [number, number] {
  const a = degToRad(s.aim);
  return [s.facing * dcos(a), -dsin(a)];
}

export function launchProjectile(s: Snail, power: number): Projectile {
  const [dx, dy] = aimVector(s);
  const speed = MAX_LAUNCH_SPEED * Math.max(power, 0.05);
  return {
    x: s.x + dx * (SNAIL_R + 6),
    y: s.y + dy * (SNAIL_R + 6),
    vx: dx * speed,
    vy: dy * speed,
    age: 0,
    ownerId: s.id,
  };
}

export type ProjectileResult = null | { type: 'explode'; x: number; y: number } | { type: 'lost'; x: number; y: number };

/** Advances a projectile by one tick (mutates it). Pure w.r.t. everything else; used by AI prediction too. */
export function advanceProjectile(
  p: Projectile,
  terrain: Terrain,
  snails: readonly Snail[],
  wind: number,
): ProjectileResult {
  p.vx += wind;
  p.vy += PROJECTILE_GRAVITY;
  p.age++;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
  for (let i = 0; i < steps; i++) {
    p.x += p.vx / steps;
    p.y += p.vy / steps;
    if (isSolid(terrain, p.x, p.y)) return { type: 'explode', x: p.x, y: p.y };
    for (const s of snails) {
      if (!s.alive) continue;
      if (s.id === p.ownerId && p.age < 12) continue;
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      if (dx * dx + dy * dy < (SNAIL_R + 2) * (SNAIL_R + 2)) return { type: 'explode', x: p.x, y: p.y };
    }
    if (p.y > WATER_Y) return { type: 'lost', x: p.x, y: p.y };
    if (p.x < -400 || p.x > terrain.w + 400) return { type: 'lost', x: p.x, y: p.y };
  }
  return null;
}

function explode(state: GameState, x: number, y: number, events: SimEvent[]): void {
  carveCircle(state.terrain, x, y, BLAST_TERRAIN_R);
  events.push({ type: 'explosion', x, y, r: BLAST_TERRAIN_R });
  for (const s of state.snails) {
    if (!s.alive) continue;
    const dx = s.x - x;
    const dy = s.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= BLAST_DAMAGE_R) continue;
    const f = 1 - d / BLAST_DAMAGE_R;
    const dmg = Math.round(BLAST_MAX_DAMAGE * f);
    if (dmg > 0) {
      s.hp -= dmg;
      events.push({ type: 'damage', snailId: s.id, amount: dmg });
    }
    const nx = d > 0.001 ? dx / d : 0;
    const ny = d > 0.001 ? dy / d : -1;
    const k = BLAST_KNOCKBACK * f;
    s.vx += nx * k;
    s.vy += ny * k - 1.8 * f;
    s.grounded = false;
  }
}

function tryWalk(state: GameState, s: Snail, dir: 1 | -1): void {
  s.facing = dir;
  const nx = s.x + dir * WALK_SPEED;
  for (let c = 0; c <= MAX_CLIMB; c++) {
    if (!snailHitsTerrain(state.terrain, nx, s.y - c)) {
      s.x = nx;
      s.y -= c;
      for (let d = 0; d < MAX_CLIMB && !snailHitsTerrain(state.terrain, s.x, s.y + 1); d++) s.y += 1;
      return;
    }
  }
}

function updateSnailPhysics(state: GameState, s: Snail, events: SimEvent[]): void {
  const t = state.terrain;
  if (s.grounded) {
    if (!snailHitsTerrain(t, s.x, s.y + 1)) {
      s.grounded = false;
    } else {
      return;
    }
  }
  // Pop out if embedded (e.g. spawn on a slope).
  for (let i = 0; i < 12 && snailHitsTerrain(t, s.x, s.y); i++) s.y -= 1;

  s.vy += GRAVITY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(s.vx), Math.abs(s.vy))));
  for (let i = 0; i < steps; i++) {
    const nx = s.x + s.vx / steps;
    if (snailHitsTerrain(t, nx, s.y)) {
      // Allow small steps up while sliding sideways.
      if (!snailHitsTerrain(t, nx, s.y - 2)) {
        s.x = nx;
        s.y -= 2;
      } else {
        s.vx = -s.vx * 0.3;
      }
    } else {
      s.x = nx;
    }
    const ny = s.y + s.vy / steps;
    if (snailHitsTerrain(t, s.x, ny)) {
      if (s.vy > 0) {
        const impact = s.vy;
        if (impact > SAFE_FALL_SPEED) {
          const dmg = Math.round((impact - SAFE_FALL_SPEED) * FALL_DAMAGE_PER_SPEED);
          s.hp -= dmg;
          events.push({ type: 'damage', snailId: s.id, amount: dmg });
        }
        if (impact > 3 || Math.abs(s.vx) > 2.5) {
          s.vy = -impact * 0.25;
          s.vx *= 0.5;
        } else {
          s.vx = 0;
          s.vy = 0;
          s.grounded = true;
          s.y = Math.round(s.y);
          while (snailHitsTerrain(t, s.x, s.y)) s.y -= 1;
        }
      } else {
        s.vy = 0;
      }
      break;
    }
    s.y = ny;
  }

  if (s.y > WATER_Y + SNAIL_R) {
    s.alive = false;
    s.hp = 0;
    s.grounded = false;
    events.push({ type: 'drown', snailId: s.id }, { type: 'splash', x: s.x });
  }
}

function handleActiveInput(state: GameState, input: InputFrame, events: SimEvent[]): void {
  const s = activeSnail(state);
  if (!s || !s.alive) return;
  const prev = state.prevInput;

  if (input.up) s.aim = clamp(s.aim + 1, AIM_MIN, AIM_MAX);
  if (input.down) s.aim = clamp(s.aim - 1, AIM_MIN, AIM_MAX);

  if (input.fire) {
    state.charging = true;
    state.power = Math.min(1, Math.round(state.power * POWER_TICKS + 1) / POWER_TICKS);
    if (state.power >= 1) fire(state, s, events);
    return;
  }
  if (state.charging) {
    fire(state, s, events);
    return;
  }

  if (s.grounded) {
    if (input.jump && !prev.jump) {
      s.vx = s.facing * JUMP_VX;
      s.vy = JUMP_VY;
      s.grounded = false;
    } else if (input.left && !input.right) {
      tryWalk(state, s, -1);
    } else if (input.right && !input.left) {
      tryWalk(state, s, 1);
    }
  }
}

function fire(state: GameState, s: Snail, events: SimEvent[]): void {
  state.projectile = launchProjectile(s, state.power);
  state.charging = false;
  state.phase = 'flying';
  events.push({ type: 'fire', snailId: s.id });
}

/**
 * Advance the game by exactly one fixed tick. Same state + same input sequence
 * always yields the same result, which is what lockstep netplay needs.
 */
export function step(state: GameState, rawInput: InputFrame): SimEvent[] {
  const events: SimEvent[] = [];
  const input = state.phase === 'aiming' ? rawInput : EMPTY_INPUT;
  state.tick++;

  switch (state.phase) {
    case 'aiming': {
      handleActiveInput(state, input, events);
      if (state.phase === 'aiming') {
        state.turnTicksLeft--;
        if (state.turnTicksLeft <= 0) {
          state.phase = 'settling';
          state.settleTicks = 0;
          state.charging = false;
          state.power = 0;
        }
      }
      break;
    }
    case 'flying': {
      const p = state.projectile;
      if (p) {
        const res = advanceProjectile(p, state.terrain, state.snails, state.wind);
        if (res) {
          if (res.type === 'explode') explode(state, res.x, res.y, events);
          else if (res.y > WATER_Y) events.push({ type: 'splash', x: res.x });
          state.projectile = null;
          state.phase = 'settling';
          state.settleTicks = 0;
        }
      } else {
        state.phase = 'settling';
      }
      break;
    }
    case 'settling': {
      state.settleTicks++;
      const still = state.snails.every((s) => !s.alive || s.grounded);
      if ((still && state.settleTicks >= SETTLE_MIN_TICKS) || state.settleTicks >= SETTLE_MAX_TICKS) {
        finishTurn(state, events);
      }
      break;
    }
    case 'gameover':
      break;
  }

  for (const s of state.snails) if (s.alive) updateSnailPhysics(state, s, events);

  if (state.phase === 'aiming') {
    const a = activeSnail(state);
    if (!a || !a.alive) {
      state.phase = 'settling';
      state.settleTicks = 0;
    }
  }

  state.prevInput = { ...input };
  return events;
}

/** FNV-1a hash over the full simulation state; compare across peers to detect desyncs. */
export function hashState(state: GameState): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  const mixF = (n: number) => {
    f64[0] = n;
    mix(u32[0]);
    mix(u32[1]);
  };
  mix(state.tick);
  mix(state.rng);
  mix(state.turnNumber);
  mixF(state.power);
  mixF(state.wind);
  for (const s of state.snails) {
    mixF(s.x);
    mixF(s.y);
    mixF(s.vx);
    mixF(s.vy);
    mix(s.hp);
    mix(s.aim);
    mix(s.alive ? 1 : 0);
  }
  if (state.projectile) {
    mixF(state.projectile.x);
    mixF(state.projectile.y);
  }
  const d = state.terrain.data;
  for (let i = 0; i < d.length; i += 4) mix(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
  return h >>> 0;
}
