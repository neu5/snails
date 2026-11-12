import { Rng, clamp, dcos, degToRad, dsin } from './math';
import { carveCircle, fillBar, generateTerrain, isSolid, type Terrain } from './terrain';
import {
  EMPTY_INPUT,
  WEAPONS,
  type GameConfig,
  type GameState,
  type InputFrame,
  type ObjectKind,
  type Point,
  type Projectile,
  type Rope,
  type SimEvent,
  type Snail,
  type Team,
  type WeaponId,
} from './types';

export const TICK_RATE = 60;
export const MAP_W = 2560;
export const MAP_H = 1080;
export const WATER_Y = 1040;

export const SNAIL_R = 8;
const WALK_SPEED = 0.7;
const MAX_CLIMB = 4;
const JUMP_VX = 1.7;
const JUMP_VY = -2;
/** Enter twice quickly: a higher jump backwards. */
const BACK_JUMP_VX = 0.9;
const BACK_JUMP_VY = -2.6;
/** Ticks (150 ms) a jump waits for a second Enter before going off forward. */
export const JUMP_WAIT = 9;
const GRAVITY = 0.12;
const SAFE_FALL_SPEED = 5.2;
const FALL_DAMAGE_PER_SPEED = 7;

const AIM_MIN = -85;
const AIM_MAX = 88;
export const POWER_TICKS = 72;
export const MAX_LAUNCH_SPEED = 11;
export const PROJECTILE_GRAVITY = 0.12;
const MAX_WIND = 0.035;

interface Blast {
  terrainR: number;
  damageR: number;
  damage: number;
  knockback: number;
}
const OBJECT_KINDS: ObjectKind[] = ['shell', 'grenade', 'mine', 'dynamite', 'cluster', 'bomblet', 'homing'];
export const BLASTS: Record<ObjectKind, Blast> = {
  shell: { terrainR: 34, damageR: 58, damage: 50, knockback: 6.5 },
  homing: { terrainR: 30, damageR: 52, damage: 45, knockback: 6 },
  grenade: { terrainR: 30, damageR: 55, damage: 45, knockback: 6 },
  cluster: { terrainR: 24, damageR: 45, damage: 25, knockback: 5 },
  bomblet: { terrainR: 16, damageR: 34, damage: 18, knockback: 4 },
  mine: { terrainR: 30, damageR: 60, damage: 45, knockback: 7 },
  dynamite: { terrainR: 62, damageR: 100, damage: 75, knockback: 9 },
};

interface Bullet {
  damage: number;
  carve: number;
  knockback: number;
}
const GUN: Bullet = { damage: 25, carve: 8, knockback: 3.5 };
/** Bomblets a cluster bomb bursts into. */
export const BOMBLETS = 5;
/** Punch and poke reach a snail this close in front (snail centres, px). */
const MELEE_REACH = 22;
const PUNCH_DAMAGE = 30;
const KAMIKAZE_SPEED = 6;
const KAMIKAZE_TICKS = 90;
const KAMIKAZE_BLAST: Blast = { terrainR: 46, damageR: 80, damage: 55, knockback: 8 };
/** Platform size and how far in front of the snail it goes. */
export const GIRDER_LEN = 80;
const GIRDER_THICK = 8;
export const GIRDER_REACH = 60;
/** Platforms and blowtorch cuts tilt at most this much. */
const STEEP_AIM = 60;
/** Fall speed under a parachute, px/tick. */
const PARACHUTE_FALL = 1.1;
const UZI: Bullet = { damage: 5, carve: 4, knockback: 1.2 };
export const GUN_SHOTS = 2;
const UZI_BURST_TICKS = 30;
const UZI_EVERY = 3;
const UZI_SPREAD = 4;
const BULLET_RANGE = 1400;

export const RETREAT_TICKS = 3 * TICK_RATE;
export const GRENADE_FUSE = 3 * TICK_RATE;
export const DYNAMITE_FUSE = 5 * TICK_RATE;
export const MINE_ARM_TICKS = 2 * TICK_RATE;
const MINE_TRIGGER_R = 28;

/**
 * Drill goes straight down; blowtorch cuts a tunnel along the aim. Both carry the snail and
 * hurt any other snail in the way (`damage` per carve, never below 1 HP) while shoving it aside.
 */
export const DIG_TOOLS = {
  drill: { speed: 0.7, ticks: 150, damage: 5 },
  torch: { speed: 0.9, ticks: 180, damage: 5 },
};
const DIG_KNOCKBACK = 1.6;
/** The blowtorch cuts at most this steep (degrees), never straight up or down. */
export const TORCH_AIM = 60;
const DIG_R = 11;
/** Carving every few ticks (ahead of the snail) keeps terrain redraws cheap. */
const DIG_EVERY = 6;
const DIG_AHEAD = 6;
const MINE_FUSE = 50;
const BOUNCE = 0.45;

const SETTLE_MIN_TICKS = 45;
const SETTLE_MAX_TICKS = 600;

/** Map targets are kept in cells this many px wide, so they fit in the turn log. */
export const TARGET_GRID = 4;
/** Launch speed; the missile then flies free for HOMING_LOCK ticks before it steers. */
const HOMING_LAUNCH = 5;
export const HOMING_LOCK = 20;
/** Ticks of rocket; after that it drops like a shell. */
export const HOMING_FUEL = 300;
const HOMING_SPEED = 7;
const HOMING_THRUST = 0.08;
/** Pull toward the target, px/tick^2; it grows close by so the missile cannot circle it. */
const HOMING_TURN = 0.35;
const HOMING_TURN_NEAR = 150;
/** A slow side-to-side sway, so it does not fly like a ruler. */
const HOMING_SWAY = 0.1;
const HOMING_SWAY_RATE = 0.14;
const HOMING_REACH = 12;

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
  ammo: { homing: 1, cluster: 2, kamikaze: 1, mine: 4, dynamite: 1, drill: 4, torch: 4, girder: 2, rope: 4, select: 1 },
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
      // Away from the coasts, which slope down into the sea.
      x = Math.floor(rng.range(MAP_W * 0.2, MAP_W * 0.8));
      if (usedX.some((u) => Math.abs(u - x) < 70) && attempt < 300) continue;
      y = findSurfaceY(terrain, x);
      if (y !== null && y < WATER_Y - 120) break;
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
      hidden: false,
    });
  }

  const state: GameState = {
    config,
    tick: 0,
    rng: rng.state,
    terrain,
    snails,
    teams: TEAM_NAMES.slice(0, teamCount).map((name, id) => ({ id, name, nextIndex: 0, weapon: 'bazooka' as WeaponId, surrendered: false, ammo: { ...config.ammo } })),
    activeTeam: 0,
    activeSnailId: 0,
    turnNumber: 0,
    phase: 'aiming',
    turnTicksLeft: 0,
    power: 0,
    charging: false,
    shotsFired: 0,
    burstTicks: 0,
    retreatTicks: 0,
    jumpTicks: 0,
    rope: null,
    hook: null,
    target: null,
    startSpot: { x: 0, y: 0 },
    moved: false,
    paid: [],
    kamikaze: null,
    parachute: false,
    objects: [],
    dig: null,
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
  pick.hidden = false;
  state.turnNumber++;
  state.phase = 'aiming';
  state.turnTicksLeft = state.config.turnSeconds * TICK_RATE;
  state.power = 0;
  state.charging = false;
  state.shotsFired = 0;
  state.burstTicks = 0;
  state.retreatTicks = 0;
  state.jumpTicks = 0;
  state.dig = null;
  state.rope = null;
  state.hook = null;
  state.target = null;
  state.startSpot = { x: pick.x, y: pick.y };
  state.moved = false;
  state.paid = [];
  // A weapon used up last time is no longer in hand.
  if (ammoLeft(t, t.weapon) === 0) t.weapon = WEAPONS.find((w) => ammoLeft(t, w) > 0) ?? t.weapon;
  state.kamikaze = null;
  state.parachute = false;
  // Only mines outlive a turn; anything else still around timed out while settling.
  state.objects = state.objects.filter((o) => o.kind === 'mine');
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
  const aliveTeams = state.teams.filter((t) => !t.surrendered && state.snails.some((s) => s.alive && s.team === t.id));
  if (aliveTeams.length <= 1) {
    state.phase = 'gameover';
    state.winner = aliveTeams.length === 1 ? aliveTeams[0].id : -1;
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

export function launchProjectile(s: Snail, power: number, kind: 'shell' | 'grenade' | 'cluster' | 'homing' = 'shell'): Projectile {
  const [dx, dy] = aimVector(s);
  const speed = MAX_LAUNCH_SPEED * Math.max(power, 0.05);
  return {
    kind,
    x: s.x + dx * (SNAIL_R + 6),
    y: s.y + dy * (SNAIL_R + 6),
    vx: dx * speed,
    vy: dy * speed,
    age: 0,
    ownerId: s.id,
    fuse: kind === 'shell' || kind === 'homing' ? -1 : GRENADE_FUSE,
    resting: false,
  };
}

/** Mines and dynamite are dropped just in front of the snail. */
function dropObject(state: GameState, s: Snail, kind: 'mine' | 'dynamite'): Projectile {
  const fuse = kind === 'dynamite' ? DYNAMITE_FUSE : -1;
  // Let go of from a rope, it falls from under the snail with the swing's speed.
  if (state.rope) {
    return { kind, x: s.x, y: s.y + 4, vx: s.vx, vy: s.vy, age: 0, ownerId: s.id, fuse, resting: false };
  }
  const front = s.x + s.facing * (SNAIL_R + 2);
  return {
    kind,
    x: isSolid(state.terrain, front, s.y) ? s.x : front,
    y: s.y,
    vx: s.facing * 0.6,
    vy: -1.2,
    age: 0,
    ownerId: s.id,
    fuse,
    resting: false,
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

/** Moves a grenade, mine or dynamite one tick: gravity, no wind, bounces off terrain. */
function advanceBouncer(o: Projectile, t: Terrain): void {
  if (o.resting) {
    if (isSolid(t, o.x, o.y + 1)) return;
    o.resting = false;
  }
  for (let i = 0; i < 12 && isSolid(t, o.x, o.y); i++) o.y -= 1;
  o.vy += PROJECTILE_GRAVITY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(o.vx), Math.abs(o.vy))));
  for (let i = 0; i < steps; i++) {
    const nx = o.x + o.vx / steps;
    if (isSolid(t, nx, o.y)) {
      o.vx = -o.vx * BOUNCE;
      break;
    }
    o.x = nx;
    const ny = o.y + o.vy / steps;
    if (isSolid(t, o.x, ny)) {
      if (Math.abs(o.vy) < 1 && Math.abs(o.vx) < 0.6) {
        o.vx = 0;
        o.vy = 0;
        o.resting = true;
      } else {
        o.vy = -o.vy * BOUNCE;
        o.vx *= 0.7;
      }
      break;
    }
    o.y = ny;
  }
}

function removeObject(state: GameState, o: Projectile): void {
  const i = state.objects.indexOf(o);
  if (i >= 0) state.objects.splice(i, 1);
}

/** A cluster bomb throws its bomblets up and out in a fan. */
function burst(state: GameState, o: Projectile): void {
  for (let i = 0; i < BOMBLETS; i++) {
    state.objects.push({
      kind: 'bomblet',
      x: o.x,
      y: o.y - 6,
      vx: (i - (BOMBLETS - 1) / 2) * 1.2 + (random(state) - 0.5) * 0.8,
      vy: -3.5 - random(state) * 1.5,
      age: 0,
      ownerId: -1,
      fuse: -1,
      resting: false,
    });
  }
}

const reached = (o: Projectile, t: Point) => (t.x - o.x) ** 2 + (t.y - o.y) ** 2 < HOMING_REACH * HOMING_REACH;

/**
 * The rocket's pull on the missile, if it is locked on and has fuel. It knows only where the
 * target is: it heads straight there, and whatever stands in the way blows it up. Turning by
 * a push, not by a set heading, gives it a curve; the sway keeps the line from being ruled.
 */
function steerHoming(o: Projectile, target: Point | null): boolean {
  if (!target || o.age < HOMING_LOCK || o.age >= HOMING_FUEL) return false;
  const speed = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
  const dx = target.x - o.x;
  const dy = target.y - o.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const pull = HOMING_TURN * (1 + HOMING_TURN_NEAR / (d + 30));
  const sway = dsin(o.age * HOMING_SWAY_RATE) * HOMING_SWAY;
  const vx = o.vx + (dx / d) * pull - (o.vy / speed) * sway;
  const vy = o.vy + (dy / d) * pull + (o.vx / speed) * sway;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const next = Math.min(HOMING_SPEED, speed + HOMING_THRUST);
  o.vx = (vx / len) * next;
  // advanceProjectile adds gravity next; the rocket cancels it.
  o.vy = (vy / len) * next - PROJECTILE_GRAVITY;
  return true;
}

function updateObjects(state: GameState, events: SimEvent[]): void {
  for (const o of [...state.objects]) {
    // An earlier explosion this tick may have removed it.
    if (!state.objects.includes(o)) continue;
    if (o.kind === 'shell' || o.kind === 'bomblet' || o.kind === 'homing') {
      const homing = o.kind === 'homing' && steerHoming(o, state.target);
      // Bomblets fly like shells but the wind does not carry them; nor does a steering rocket.
      const res = advanceProjectile(o, state.terrain, state.snails, o.kind === 'bomblet' || homing ? 0 : state.wind);
      const arrived = !res && homing && reached(o, state.target!);
      if (!res && !arrived) continue;
      removeObject(state, o);
      if (arrived || res?.type === 'explode') explode(state, res?.x ?? o.x, res?.y ?? o.y, BLASTS[o.kind], events);
      else if (res && res.y > WATER_Y) events.push({ type: 'splash', x: res.x });
      continue;
    }
    o.age++;
    advanceBouncer(o, state.terrain);
    if (o.y > WATER_Y || o.x < -400 || o.x > state.terrain.w + 400) {
      removeObject(state, o);
      if (o.y > WATER_Y) events.push({ type: 'splash', x: o.x });
      continue;
    }
    if (o.kind === 'mine' && o.fuse < 0 && o.age >= MINE_ARM_TICKS) {
      const near = state.snails.some((s) => s.alive && (s.x - o.x) ** 2 + (s.y - o.y) ** 2 < MINE_TRIGGER_R * MINE_TRIGGER_R);
      if (near) {
        o.fuse = MINE_FUSE;
        events.push({ type: 'mineTriggered', x: o.x, y: o.y });
      }
    }
    if (o.fuse > 0 && --o.fuse === 0) {
      removeObject(state, o);
      explode(state, o.x, o.y, BLASTS[o.kind], events);
      if (o.kind === 'cluster') burst(state, o);
    }
  }
}

function explode(state: GameState, x: number, y: number, blast: Blast, events: SimEvent[]): void {
  carveCircle(state.terrain, x, y, blast.terrainR);
  events.push({ type: 'explosion', x, y, r: blast.terrainR });
  for (const s of state.snails) {
    if (!s.alive) continue;
    const dx = s.x - x;
    const dy = s.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= blast.damageR) continue;
    const f = 1 - d / blast.damageR;
    const dmg = Math.round(blast.damage * f);
    if (dmg > 0) {
      s.hp -= dmg;
      events.push({ type: 'damage', snailId: s.id, amount: dmg });
    }
    const nx = d > 0.001 ? dx / d : 0;
    const ny = d > 0.001 ? dy / d : -1;
    const k = blast.knockback * f;
    s.vx += nx * k;
    s.vy += ny * k - 1.8 * f;
    s.grounded = false;
  }
  // Toss nearby objects; mines caught in a blast go off shortly after.
  for (const o of state.objects) {
    if (o.kind === 'shell' || o.kind === 'homing') continue;
    const dx = o.x - x;
    const dy = o.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= blast.damageR) continue;
    const f = 1 - d / blast.damageR;
    o.vx += (d > 0.001 ? dx / d : 0) * blast.knockback * f;
    o.vy += (d > 0.001 ? dy / d : -1) * blast.knockback * f - 1.5 * f;
    o.resting = false;
    if (o.kind === 'mine' && o.fuse < 0) o.fuse = 10;
  }
}

export interface BulletHit {
  x: number;
  y: number;
  snail: Snail | null;
  terrain: boolean;
}

/** Follows a bullet in a straight line until terrain, a snail or the map edge. Pure; the bot uses it too. */
export function traceBullet(
  terrain: Terrain,
  snails: readonly Snail[],
  x: number,
  y: number,
  dx: number,
  dy: number,
  ownerId: number,
): BulletHit {
  for (let i = 0; i < BULLET_RANGE; i++) {
    x += dx;
    y += dy;
    if (y > WATER_Y || y < -100 || x < -50 || x > terrain.w + 50) break;
    if (isSolid(terrain, x, y)) return { x, y, snail: null, terrain: true };
    for (const s of snails) {
      if (!s.alive || s.id === ownerId) continue;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < SNAIL_R * SNAIL_R) return { x, y, snail: s, terrain: false };
    }
  }
  return { x, y, snail: null, terrain: false };
}

function shoot(state: GameState, s: Snail, spread: number, bullet: Bullet, events: SimEvent[]): void {
  const a = degToRad(s.aim + spread);
  const dx = s.facing * dcos(a);
  const dy = -dsin(a);
  const x0 = s.x + dx * (SNAIL_R + 4);
  const y0 = s.y - 2 + dy * (SNAIL_R + 4);
  const hit = traceBullet(state.terrain, state.snails, x0, y0, dx, dy, s.id);
  events.push({ type: 'bullet', x0, y0, x1: hit.x, y1: hit.y, hit: hit.snail !== null || hit.terrain });
  if (hit.snail) {
    const t = hit.snail;
    t.hp -= bullet.damage;
    events.push({ type: 'damage', snailId: t.id, amount: bullet.damage });
    t.vx += dx * bullet.knockback;
    t.vy += dy * bullet.knockback - 1;
    t.grounded = false;
  } else if (hit.terrain) {
    carveCircle(state.terrain, hit.x, hit.y, bullet.carve);
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
  if (state.parachute && s.id === state.activeSnailId) {
    // Slow, safe fall, drifting with the wind.
    s.vy = Math.min(s.vy, PARACHUTE_FALL);
    s.vx = clamp(s.vx + state.wind * 0.6, -1.5, 1.5);
  }
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
          // A painful fall ends the active snail's move.
          if (s.id === state.activeSnailId && isMoving(state)) beginSettling(state);
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

/** Bazooka and grenade charge while fire is held; the rest go off on the press. */
export function isCharged(w: WeaponId): boolean {
  return w === 'bazooka' || w === 'grenade' || w === 'cluster';
}

/** The part of the input the current phase listens to. Recorders store this, so logs stay small. */
export function effectiveInput(state: GameState, input: InputFrame): InputFrame {
  switch (state.phase) {
    case 'aiming':
      return input;
    case 'firing':
      return { ...EMPTY_INPUT, up: input.up, down: input.down };
    case 'digging':
      return { ...EMPTY_INPUT, fire: input.fire };
    case 'retreat':
      // Still on the rope after a drop: swing, reel and let go as before.
      if (state.rope) return { ...input, weapon: 0 };
      return { ...EMPTY_INPUT, left: input.left, right: input.right, jump: input.jump };
    default:
      return EMPTY_INPUT;
  }
}

function move(state: GameState, s: Snail, input: InputFrame): void {
  const press = input.jump && !state.prevInput.jump;
  if (state.jumpTicks > 0) {
    // Enter was pressed: wait a moment to see whether a second press makes it a back jump.
    if (!s.grounded) state.jumpTicks = 0;
    else if (press) jump(state, s, -BACK_JUMP_VX, BACK_JUMP_VY);
    else if (--state.jumpTicks === 0) jump(state, s, JUMP_VX, JUMP_VY);
    return;
  }
  if (!s.grounded) return;
  if (press) {
    state.jumpTicks = JUMP_WAIT;
  } else if (input.left && !input.right) {
    tryWalk(state, s, -1);
  } else if (input.right && !input.left) {
    tryWalk(state, s, 1);
  }
}

/** vx is along the way the snail faces; negative jumps backwards. */
function jump(state: GameState, s: Snail, vx: number, vy: number): void {
  s.vx = s.facing * vx;
  s.vy = vy;
  s.grounded = false;
  state.jumpTicks = 0;
}

/** A snail this far (px) from where its turn began has moved, and can no longer hand the turn on. */
const MOVED_BY = 1;

/** Switches this turn to the next living snail of the team, if this one has not moved yet. */
function selectNextSnail(state: GameState, s: Snail, events: SimEvent[]): void {
  if (state.moved) {
    events.push({ type: 'selectRefused', snailId: s.id });
    return;
  }
  if (!s.grounded || state.rope || state.hook || state.parachute) return;
  const members = teamSnails(state, s.team);
  const start = members.indexOf(s);
  for (let k = 1; k < members.length; k++) {
    const next = members[(start + k) % members.length];
    if (!next.alive) continue;
    spend(state, 'select');
    state.activeSnailId = next.id;
    state.startSpot = { x: next.x, y: next.y };
    next.hidden = false;
    state.jumpTicks = 0;
    events.push({ type: 'select', snailId: next.id });
    return;
  }
}

/** A map point on the grid the turn log stores, clamped to the map. */
function snapTarget(p: Point): Point {
  const cell = (v: number, max: number) => Math.floor(clamp(v, 0, max - 1) / TARGET_GRID) * TARGET_GRID;
  return { x: cell(p.x, MAP_W), y: cell(p.y, MAP_H) };
}

function clampAim(w: WeaponId, aim: number): number {
  if (w === 'torch') return clamp(aim, -TORCH_AIM, TORCH_AIM);
  if (w === 'girder') return clamp(aim, -STEEP_AIM, STEEP_AIM);
  return clamp(aim, AIM_MIN, AIM_MAX);
}

function handleActiveInput(state: GameState, input: InputFrame, events: SimEvent[]): void {
  const s = activeSnail(state);
  if (!s || !s.alive) return;

  // Nothing to do but watch while the hook flies.
  if (state.hook) return;
  const team = state.teams[state.activeTeam];
  // On the rope, up and down reel it in and out instead of aiming.
  if (!state.rope) {
    if (input.up) s.aim = clampAim(team.weapon, s.aim + 1);
    if (input.down) s.aim = clampAim(team.weapon, s.aim - 1);
  }
  if (state.phase === 'retreat') {
    if (state.rope) ropeInput(state, s, input);
    else move(state, s, input);
  }
  if (state.phase !== 'aiming') return;

  const picked = WEAPONS[input.weapon - 1];
  if (picked && state.shotsFired === 0 && !state.charging && ammoLeft(team, picked) > 0) {
    team.weapon = picked;
    s.aim = clampAim(team.weapon, s.aim);
  }
  const w = team.weapon;
  if (input.target && w === 'homing' && state.shotsFired === 0) state.target = snapTarget(input.target);
  if (state.parachute) {
    parachuteInput(state, s, input);
    return;
  }
  if (state.rope) {
    // Enter on the rope drops a mine or dynamite (and the snail keeps swinging); else lets go.
    const drop = (w === 'mine' || w === 'dynamite') && ammoLeft(team, w) > 0;
    if (drop && input.jump && !state.prevInput.jump) useWeapon(state, s, w, events);
    else ropeInput(state, s, input);
    return;
  }
  // Used up: walk around, pick another weapon.
  if (ammoLeft(team, w) === 0 && !state.paid.includes(w)) {
    if (state.shotsFired === 0) move(state, s, input);
    return;
  }
  if (w === 'rope') {
    if (input.fire && !state.prevInput.fire) {
      fireRope(state, s);
      return;
    }
  } else if (w === 'parachute') {
    // Opens only in the air (after a jump or off a ledge); not a shot, the turn goes on.
    if (input.fire && !state.prevInput.fire && !s.grounded) {
      state.parachute = true;
      state.jumpTicks = 0;
      spend(state, 'parachute');
      return;
    }
  } else if (isCharged(w)) {
    if (input.fire) {
      state.charging = true;
      state.power = Math.min(1, Math.round(state.power * POWER_TICKS + 1) / POWER_TICKS);
      if (state.power >= 1) useWeapon(state, s, w, events);
      return;
    }
    if (state.charging) {
      useWeapon(state, s, w, events);
      return;
    }
  } else if (w === 'select') {
    // Each press hands the turn to the next snail of the team; not a shot, the turn goes on.
    if (input.fire && !state.prevInput.fire) {
      selectNextSnail(state, s, events);
      return;
    }
  } else if (w === 'girder') {
    // Not over a snail: the outline turns red and Space does nothing.
    if (input.fire && !state.prevInput.fire && !girderBlocked(state, s)) {
      useWeapon(state, s, w, events);
      return;
    }
  } else if (w === 'homing') {
    // Nowhere to go until a target is picked.
    if (input.fire && !state.prevInput.fire && state.target) {
      useWeapon(state, s, w, events);
      return;
    }
  } else if (input.fire && !state.prevInput.fire && (s.grounded || (w !== 'drill' && w !== 'torch'))) {
    // Dig tools need ground to start from; no torching mid-jump.
    useWeapon(state, s, w, events);
    return;
  }
  // After the first gun shot the snail stays put but may re-aim.
  if (state.shotsFired === 0) move(state, s, input);
}

/** Uses left of a weapon; Infinity when it is not limited. */
export function ammoLeft(team: Team, w: WeaponId): number {
  return team.ammo[w] ?? Infinity;
}

/** Takes one use of a limited weapon from the active team, at most once per turn. */
function spend(state: GameState, w: WeaponId): void {
  const ammo = state.teams[state.activeTeam].ammo;
  if (ammo[w] === undefined || state.paid.includes(w)) return;
  ammo[w] = Math.max(0, ammo[w]! - 1);
  state.paid.push(w);
}

function useWeapon(state: GameState, s: Snail, w: WeaponId, events: SimEvent[]): void {
  events.push({ type: 'fire', snailId: s.id, weapon: w });
  spend(state, w);
  state.shotsFired++;
  switch (w) {
    case 'bazooka':
    case 'grenade':
    case 'cluster':
      state.objects.push(launchProjectile(s, state.power, w === 'bazooka' ? 'shell' : w));
      startRetreat(state);
      break;
    case 'homing':
      state.objects.push(launchProjectile(s, HOMING_LAUNCH / MAX_LAUNCH_SPEED, w));
      startRetreat(state);
      break;
    case 'punch':
    case 'poke':
      melee(state, s, w === 'poke', events);
      startRetreat(state);
      break;
    case 'kamikaze': {
      const [dx, dy] = aimVector(s);
      state.kamikaze = { dx, dy, ticksLeft: KAMIKAZE_TICKS };
      state.phase = 'kamikaze';
      // A little hop at take-off, so a flight along a slope does not end at the first bump.
      s.y -= 3;
      s.grounded = false;
      break;
    }
    case 'girder':
      placeGirder(state, s);
      startRetreat(state);
      break;
    case 'surrender':
      // The team gives up and is out; with two teams that ends the game.
      state.teams[s.team].surrendered = true;
      events.push({ type: 'surrender', team: s.team });
      beginSettling(state);
      break;
    case 'hide':
      // Skips the move: the snail tucks into its shell until its next turn.
      s.hidden = true;
      events.push({ type: 'hide', snailId: s.id });
      beginSettling(state);
      break;
    case 'gun':
      shoot(state, s, 0, GUN, events);
      if (state.shotsFired >= GUN_SHOTS) startRetreat(state);
      break;
    case 'uzi':
      state.phase = 'firing';
      state.burstTicks = UZI_BURST_TICKS;
      break;
    case 'mine':
    case 'dynamite':
      state.objects.push(dropObject(state, s, w));
      startRetreat(state);
      break;
    case 'drill':
    case 'torch': {
      const [dx, dy] = w === 'drill' ? [0, 1] : aimVector(s);
      const { speed, ticks } = DIG_TOOLS[w];
      state.dig = { x: s.x, y: s.y, dx: dx * speed, dy: dy * speed, ticksLeft: ticks, falling: false, hp: s.hp };
      state.phase = 'digging';
      break;
    }
  }
}

/** Punch (30 HP, sends it flying) or poke (no damage, a nudge) the snail just in front. */
function melee(state: GameState, s: Snail, poke: boolean, events: SimEvent[]): void {
  const hx = s.x + s.facing * 12;
  const hy = s.y - 2;
  let target: Snail | null = null;
  let best = MELEE_REACH * MELEE_REACH;
  for (const o of state.snails) {
    if (!o.alive || o === s) continue;
    const d = (o.x - hx) ** 2 + (o.y - hy) ** 2;
    if (d < best) {
      best = d;
      target = o;
    }
  }
  events.push({ type: 'punch', x: hx + s.facing * 6, y: hy, hit: target !== null, poke });
  if (!target) return;
  if (!poke) {
    target.hp -= PUNCH_DAMAGE;
    events.push({ type: 'damage', snailId: target.id, amount: PUNCH_DAMAGE });
  }
  target.vx += s.facing * (poke ? 2.2 : 4.5);
  target.vy += poke ? -2 : -5;
  target.grounded = false;
}

/** Where a platform would go for this snail: centre and unit direction along it. */
export function girderSpot(s: Snail): { x: number; y: number; ux: number; uy: number } {
  const [dx, dy] = aimVector(s);
  return { x: s.x + dx * GIRDER_REACH, y: s.y + dy * GIRDER_REACH, ux: dx, uy: dy };
}

/** Gap a platform must keep from every snail (px past its body). */
const GIRDER_GAP = 2;

/** True if the platform would go over (or right up against) a living snail, the user included. */
export function girderBlocked(state: GameState, s: Snail): boolean {
  const g = girderSpot(s);
  return state.snails.some((o) => {
    if (!o.alive) return false;
    // Distance from the snail to the platform's rectangle, in the platform's own axes.
    const dx = o.x - g.x;
    const dy = o.y - g.y;
    const along = Math.max(0, Math.abs(dx * g.ux + dy * g.uy) - GIRDER_LEN / 2);
    const across = Math.max(0, Math.abs(-dx * g.uy + dy * g.ux) - GIRDER_THICK / 2);
    return along * along + across * across < (SNAIL_R + GIRDER_GAP) ** 2;
  });
}

function placeGirder(state: GameState, s: Snail): void {
  const g = girderSpot(s);
  // Tilted like the aim, so aiming up makes a ramp. Never inside a snail.
  const clear = SNAIL_R + 1;
  fillBar(state.terrain, g.x, g.y, g.ux, g.uy, GIRDER_LEN, GIRDER_THICK, (x, y) =>
    state.snails.some((o) => o.alive && (o.x - x) ** 2 + (o.y - y) ** 2 < clear * clear),
  );
}

/** One tick of a kamikaze flight; it blows up on whatever it hits, or when time runs out. */
function advanceKamikaze(state: GameState, s: Snail, events: SimEvent[]): void {
  const k = state.kamikaze!;
  // The ground it takes off from does not count on the first tick.
  const launching = k.ticksLeft === KAMIKAZE_TICKS;
  let boom = --k.ticksLeft <= 0;
  for (let i = 0; i < KAMIKAZE_SPEED && !boom; i++) {
    const nx = s.x + k.dx;
    const ny = s.y + k.dy;
    const hitsSnail = state.snails.some(
      (o) => o.alive && o !== s && (o.x - nx) ** 2 + (o.y - ny) ** 2 < (SNAIL_R * 2) ** 2,
    );
    if (hitsSnail || (!launching && snailHitsTerrain(state.terrain, nx, ny))) {
      boom = true;
      break;
    }
    s.x = nx;
    s.y = ny;
    if (s.y > WATER_Y + SNAIL_R) {
      // Flew into the sea: no bang, just a splash.
      state.kamikaze = null;
      s.alive = false;
      s.hp = 0;
      events.push({ type: 'drown', snailId: s.id }, { type: 'splash', x: s.x });
      beginSettling(state);
      return;
    }
    if (s.x < -200 || s.x > state.terrain.w + 200 || s.y < -600) boom = true;
  }
  s.vx = 0;
  s.vy = 0;
  if (!boom) return;
  state.kamikaze = null;
  explode(state, s.x, s.y, KAMIKAZE_BLAST, events);
  s.alive = false;
  s.hp = 0;
  events.push({ type: 'death', snailId: s.id });
  beginSettling(state);
}

function parachuteInput(state: GameState, s: Snail, input: InputFrame): void {
  // Fire again folds it away; left and right steer.
  if (input.fire && !state.prevInput.fire) {
    state.parachute = false;
    return;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    s.vx = clamp(s.vx + dir * 0.08, -1.5, 1.5);
    s.facing = dir > 0 ? 1 : -1;
  }
}

/** One tick of drilling or tunnelling. Returns false once the tool is done. */
function advanceDig(state: GameState, s: Snail, events: SimEvent[]): boolean {
  const d = state.dig!;
  // Hurt by a fall, a mine or anything else: the snail drops the tool.
  if (s.hp < d.hp) return false;
  const len = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
  if (d.falling) {
    // Physics moves the snail; the tool goes with it and keeps cutting.
    d.x = s.x;
    d.y = s.y;
    if (s.grounded) d.falling = false;
  }
  if (d.ticksLeft % DIG_EVERY === 0) {
    const cx = d.x + (d.dx / len) * DIG_AHEAD;
    const cy = d.y + (d.dy / len) * DIG_AHEAD;
    carveCircle(state.terrain, cx, cy, DIG_R);
    events.push({ type: 'dig', x: cx, y: cy });
    hurtInPath(state, s, cx, cy, d.dx / len, d.dy / len, events);
  }
  if (!d.falling) {
    d.x += d.dx;
    d.y += d.dy;
    pinToDig(state, s);
    // Out in open air (a gap, a cave, above the surface) there is nothing to hold on to:
    // the snail falls, still cutting.
    if (!hasGrip(state.terrain, d.x, d.y)) {
      d.falling = true;
      // A small push so it slides off the lip instead of perching on it.
      s.vx = (d.dx / len) * 1.5;
      s.grounded = false;
    }
  }
  d.ticksLeft--;
  // Past the water line the snail drowns, on purpose or not.
  const out = d.x < SNAIL_R || d.x > state.terrain.w - SNAIL_R || d.y < SNAIL_R || d.y > WATER_Y + SNAIL_R;
  return d.ticksLeft > 0 && !out;
}

/** Points just outside a snail in its own tunnel; a digging snail must touch terrain at one of them. */
const DIG_GRIP = SNAIL_R + 5;
const GRIP_OFFSETS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dy = -DIG_GRIP; dy <= DIG_GRIP; dy++) {
    for (let dx = -DIG_GRIP; dx <= DIG_GRIP; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= DIG_GRIP * DIG_GRIP && d2 > (DIG_GRIP - 1) * (DIG_GRIP - 1)) out.push([dx, dy]);
    }
  }
  return out;
})();

/** False once the snail has cut its way out into open air (no flying on a torch). */
function hasGrip(t: Terrain, x: number, y: number): boolean {
  for (const [dx, dy] of GRIP_OFFSETS) if (isSolid(t, x + dx, y + dy)) return true;
  return false;
}

/** Other snails touching the tool get hurt and pushed out of its way. */
function hurtInPath(state: GameState, digger: Snail, x: number, y: number, ux: number, uy: number, events: SimEvent[]): void {
  const tool = state.teams[state.activeTeam].weapon === 'torch' ? DIG_TOOLS.torch : DIG_TOOLS.drill;
  const reach = DIG_R + SNAIL_R + 2;
  for (const t of state.snails) {
    if (!t.alive || t === digger) continue;
    const dx = t.x - x;
    const dy = t.y - y;
    if (dx * dx + dy * dy >= reach * reach) continue;
    // Tools wound but never kill: they stop at 1 HP.
    const dmg = Math.min(tool.damage, t.hp - 1);
    if (dmg > 0) {
      t.hp -= dmg;
      events.push({ type: 'damage', snailId: t.id, amount: dmg });
    }
    // Sideways off the tool's line, plus a bit along it.
    const side = dx * -uy + dy * ux >= 0 ? 1 : -1;
    t.vx += (-uy * side + ux * 0.5) * DIG_KNOCKBACK;
    t.vy += (ux * side + uy * 0.5) * DIG_KNOCKBACK - 1;
    t.grounded = false;
  }
}

function pinToDig(state: GameState, s: Snail): void {
  const d = state.dig!;
  s.x = d.x;
  s.y = d.y;
  s.vx = 0;
  s.vy = 0;
  s.grounded = true;
}

function startRetreat(state: GameState): void {
  state.phase = 'retreat';
  state.retreatTicks = RETREAT_TICKS;
  state.charging = false;
  state.power = 0;
}

function isMoving(state: GameState): boolean {
  return state.phase === 'aiming' || state.phase === 'firing' || state.phase === 'digging' || state.phase === 'retreat';
}

function beginSettling(state: GameState): void {
  state.phase = 'settling';
  state.dig = null;
  state.rope = null;
  state.hook = null;
  state.kamikaze = null;
  state.parachute = false;
  state.settleTicks = 0;
  state.charging = false;
  state.power = 0;
}

/**
 * Advance the game by exactly one fixed tick. Same state + same input sequence
 * always yields the same result, which is what lockstep netplay needs.
 */
export function step(state: GameState, rawInput: InputFrame): SimEvent[] {
  const events: SimEvent[] = [];
  const input = effectiveInput(state, rawInput);
  state.tick++;

  switch (state.phase) {
    case 'aiming': {
      handleActiveInput(state, input, events);
      if (state.hook) advanceHook(state, events);
      if (state.phase === 'aiming' && --state.turnTicksLeft <= 0) beginSettling(state);
      break;
    }
    case 'firing': {
      handleActiveInput(state, input, events);
      const s = activeSnail(state);
      if (s && s.alive && state.burstTicks % UZI_EVERY === 0) {
        shoot(state, s, (random(state) * 2 - 1) * UZI_SPREAD, UZI, events);
      }
      if (--state.burstTicks <= 0) startRetreat(state);
      break;
    }
    case 'kamikaze': {
      const s = activeSnail(state);
      if (s && s.alive && state.kamikaze) advanceKamikaze(state, s, events);
      else beginSettling(state);
      break;
    }
    case 'digging': {
      const s = activeSnail(state);
      // A second fire press stops the tool early.
      const stop = input.fire && !state.prevInput.fire;
      if (!s || !s.alive || stop || !advanceDig(state, s, events)) {
        state.dig = null;
        startRetreat(state);
      }
      break;
    }
    case 'retreat':
      handleActiveInput(state, input, events);
      if (--state.retreatTicks <= 0) beginSettling(state);
      break;
    case 'settling': {
      state.settleTicks++;
      const still = state.snails.every((s) => !s.alive || s.grounded);
      const busy = state.objects.some((o) => o.kind === 'shell' || o.kind === 'homing' || o.fuse > 0 || !o.resting);
      if ((still && !busy && state.settleTicks >= SETTLE_MIN_TICKS) || state.settleTicks >= SETTLE_MAX_TICKS) {
        finishTurn(state, events);
      }
      break;
    }
    case 'gameover':
      break;
  }

  updateObjects(state, events);
  for (const s of state.snails) {
    if (!s.alive) continue;
    if (s.id === state.activeSnailId && state.kamikaze) continue;
    if (state.rope && s.id === state.activeSnailId) ropePhysics(state, s, events);
    else updateSnailPhysics(state, s, events);
  }
  // The parachute folds away on landing.
  if (state.parachute && activeSnail(state)?.grounded !== false) state.parachute = false;
  // Physics would drop the snail inside its own hole; the tool holds it in place.
  const digger = activeSnail(state);
  if (state.dig && !state.dig.falling && digger?.alive) pinToDig(state, digger);

  if (isMoving(state)) {
    const a = activeSnail(state);
    if (!a || !a.alive) beginSettling(state);
    else if (Math.abs(a.x - state.startSpot.x) > MOVED_BY || Math.abs(a.y - state.startSpot.y) > MOVED_BY) state.moved = true;
  }

  state.prevInput = { ...input };
  return events;
}

/** How far the rope reaches when fired. */
export const ROPE_MAX = 260;
const ROPE_MIN = 12;
/** Reel speed (px/tick) for up/down. */
const ROPE_REEL = 1.6;
/** Push along the swing (px/tick^2) for left/right. */
const ROPE_PUMP = 0.07;
const ROPE_MAX_SPEED = 7.5;
/** A swinging snail moving faster than this knocks others away. */
const KNOCK_SPEED = 1.5;

/** Hook flight speed, px/tick: the full reach takes about half a second. */
const HOOK_SPEED = 8;

/** Throws the hook along the aim; it flies for a moment before it sticks or falls short. */
function fireRope(state: GameState, s: Snail): void {
  spend(state, 'rope');
  const [dx, dy] = aimVector(s);
  state.hook = { x: s.x, y: s.y, dx, dy, dist: 0 };
  state.jumpTicks = 0;
}

/** One tick of hook flight: it sticks to the first ground it meets, or misses at full reach. */
function advanceHook(state: GameState, events: SimEvent[]): void {
  const h = state.hook!;
  const s = activeSnail(state);
  if (!s || !s.alive) {
    state.hook = null;
    return;
  }
  for (let k = 0; k < HOOK_SPEED; k += 2) {
    const nx = h.x + h.dx * 2;
    const ny = h.y + h.dy * 2;
    if (h.dist >= SNAIL_R && isSolid(state.terrain, nx, ny)) {
      state.hook = null;
      events.push({ type: 'rope', x0: s.x, y0: s.y, x1: h.x, y1: h.y, hit: true });
      const len = Math.sqrt((h.x - s.x) ** 2 + (h.y - s.y) ** 2);
      state.rope = { pivots: [{ x: h.x, y: h.y, side: 0 }], len: Math.min(ROPE_MAX, Math.max(ROPE_MIN, len)) };
      s.grounded = false;
      return;
    }
    h.x = nx;
    h.y = ny;
    h.dist += 2;
    if (h.dist >= ROPE_MAX) {
      state.hook = null;
      events.push({ type: 'rope', x0: s.x, y0: s.y, x1: h.x, y1: h.y, hit: false });
      return;
    }
  }
}

function ropeInput(state: GameState, s: Snail, input: InputFrame): void {
  const r = state.rope!;
  // Fire or jump lets go, keeping the swing's speed. Fire again (in the air too) for a new rope.
  // (With a mine or dynamite picked, Enter drops it instead; see handleActiveInput.)
  if ((input.fire && !state.prevInput.fire) || (input.jump && !state.prevInput.jump)) {
    state.rope = null;
    return;
  }
  if (input.up) r.len = Math.max(ROPE_MIN, r.len - ROPE_REEL);
  if (input.down) r.len = Math.min(ROPE_MAX, r.len + ROPE_REEL);
  const p = r.pivots[r.pivots.length - 1];
  const dx = s.x - p.x;
  const dy = s.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.001) return;
  // Tangent of the swing, pointing right-ish.
  let tx = -dy / d;
  let ty = dx / d;
  if (tx < 0) {
    tx = -tx;
    ty = -ty;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    s.vx += tx * ROPE_PUMP * dir;
    s.vy += ty * ROPE_PUMP * dir;
    s.facing = dir > 0 ? 1 : -1;
  }
}

const lastPivot = (r: Rope) => r.pivots[r.pivots.length - 1];
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Swinging: gravity, the rope holding the snail at most `len` from its pivot, terrain bumps. */
function ropePhysics(state: GameState, s: Snail, events: SimEvent[]): void {
  const r = state.rope!;
  const t = state.terrain;
  const px = s.x;
  const py = s.y;
  s.grounded = false;
  s.vy += GRAVITY;
  s.vx *= 0.998;
  s.vy *= 0.998;
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (speed > ROPE_MAX_SPEED) {
    s.vx *= ROPE_MAX_SPEED / speed;
    s.vy *= ROPE_MAX_SPEED / speed;
  }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(s.vx), Math.abs(s.vy))));
  for (let i = 0; i < steps; i++) {
    let nx = s.x + s.vx / steps;
    let ny = s.y + s.vy / steps;
    const p = lastPivot(r);
    const dx = nx - p.x;
    const dy = ny - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r.len) {
      nx = p.x + (dx / d) * r.len;
      ny = p.y + (dy / d) * r.len;
    }
    if (!snailHitsTerrain(t, nx, ny)) {
      s.x = nx;
      s.y = ny;
      continue;
    }
    // Bumped into terrain: slide along it if one axis is free, else bounce a little.
    if (!snailHitsTerrain(t, nx, s.y)) {
      s.x = nx;
      s.vy = Math.abs(s.vy) < 1 ? 0 : -s.vy * 0.3;
      s.vx *= 0.9;
    } else if (!snailHitsTerrain(t, s.x, ny)) {
      s.y = ny;
      s.vx = Math.abs(s.vx) < 1 ? 0 : -s.vx * 0.3;
    } else {
      s.vx *= -0.3;
      s.vy *= -0.3;
    }
    break;
  }
  // A taut rope stops the snail moving away from the pivot.
  const p = lastPivot(r);
  const dx = s.x - p.x;
  const dy = s.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.001 && d >= r.len - 0.5) {
    const out = (s.vx * dx + s.vy * dy) / d;
    if (out > 0) {
      s.vx -= (out * dx) / d;
      s.vy -= (out * dy) / d;
    }
  }
  for (let k = 0; k < 3 && wrapRope(state, s, px, py); k++);
  knockSnails(state, s, events);
  if (s.y > WATER_Y + SNAIL_R) {
    s.alive = false;
    s.hp = 0;
    state.rope = null;
    events.push({ type: 'drown', snailId: s.id }, { type: 'splash', x: s.x });
  }
}

/**
 * Bends the rope around a corner it swung into, or straightens it again once the snail swings
 * back. (px, py) is where the snail was before this tick. Returns true if it changed anything.
 */
function wrapRope(state: GameState, s: Snail, px: number, py: number): boolean {
  const r = state.rope!;
  const p = lastPivot(r);
  if (r.pivots.length > 1) {
    const q = r.pivots[r.pivots.length - 2];
    const c = cross(p.x - q.x, p.y - q.y, s.x - q.x, s.y - q.y);
    if (Math.sign(c) === p.side) {
      r.len += Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
      r.pivots.pop();
      return true;
    }
  }
  const dx = s.x - p.x;
  const dy = s.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  for (let k = 3; k < d - SNAIL_R; k += 2) {
    if (!isSolid(state.terrain, p.x + (dx / d) * k, p.y + (dy / d) * k)) continue;
    const back = k - 2;
    const cx = p.x + (dx / d) * back;
    const cy = p.y + (dy / d) * back;
    const side = Math.sign(cross(cx - p.x, cy - p.y, px - p.x, py - p.y));
    if (side === 0 || back < 2) return false;
    r.pivots.push({ x: cx, y: cy, side });
    r.len = Math.max(ROPE_MIN / 2, r.len - back);
    return true;
  }
  return false;
}

/** A fast swing into another snail sends it flying; the swinger loses some speed. */
function knockSnails(state: GameState, s: Snail, events: SimEvent[]): void {
  const reach = SNAIL_R * 2 + 2;
  for (const o of state.snails) {
    if (!o.alive || o === s) continue;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    if (dx * dx + dy * dy >= reach * reach) continue;
    const closing = (s.vx - o.vx) * dx + (s.vy - o.vy) * dy;
    if (closing <= 0 || Math.sqrt(s.vx * s.vx + s.vy * s.vy) < KNOCK_SPEED) continue;
    o.vx += s.vx * 0.9;
    o.vy += s.vy * 0.9 - 1.2;
    o.grounded = false;
    s.vx *= 0.5;
    s.vy *= 0.5;
    events.push({ type: 'knock', x: (s.x + o.x) / 2, y: (s.y + o.y) / 2 });
  }
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
    mix(s.hidden ? 1 : 0);
  }
  mix(state.parachute ? 1 : 0);
  if (state.kamikaze) {
    mixF(state.kamikaze.dx);
    mixF(state.kamikaze.dy);
    mix(state.kamikaze.ticksLeft);
  }
  mix(state.shotsFired);
  mix(state.burstTicks);
  mix(state.retreatTicks);
  mix(state.jumpTicks);
  mix(state.moved ? 1 : 0);
  for (const w of state.paid) mix(WEAPONS.indexOf(w));
  mixF(state.startSpot.x);
  mixF(state.startSpot.y);
  if (state.target) {
    mixF(state.target.x);
    mixF(state.target.y);
  }
  if (state.hook) {
    mixF(state.hook.x);
    mixF(state.hook.y);
    mixF(state.hook.dist);
  }
  if (state.rope) {
    mixF(state.rope.len);
    for (const p of state.rope.pivots) {
      mixF(p.x);
      mixF(p.y);
      mix(p.side);
    }
  }
  if (state.dig) {
    mixF(state.dig.x);
    mixF(state.dig.y);
    mix(state.dig.ticksLeft);
    mix(state.dig.falling ? 1 : 0);
    mix(state.dig.hp);
  }
  for (const t of state.teams) {
    mix(WEAPONS.indexOf(t.weapon));
    mix(t.surrendered ? 1 : 0);
    for (const w of WEAPONS) mix(t.ammo[w] ?? -1);
  }
  for (const o of state.objects) {
    mix(OBJECT_KINDS.indexOf(o.kind));
    mixF(o.x);
    mixF(o.y);
    mixF(o.vx);
    mixF(o.vy);
    mix(o.fuse);
  }
  const d = state.terrain.data;
  for (let i = 0; i < d.length; i += 4) mix(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
  return h >>> 0;
}
