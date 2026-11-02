import { Rng, clamp, dcos, degToRad, dsin } from './math';
import { carveCircle, generateTerrain, isSolid, type Terrain } from './terrain';
import {
  EMPTY_INPUT,
  WEAPONS,
  type GameConfig,
  type GameState,
  type InputFrame,
  type ObjectKind,
  type Projectile,
  type SimEvent,
  type Snail,
  type WeaponId,
} from './types';

export const TICK_RATE = 60;
export const MAP_W = 1280;
export const MAP_H = 720;
export const WATER_Y = 684;

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
const OBJECT_KINDS: ObjectKind[] = ['shell', 'grenade', 'mine', 'dynamite'];
export const BLASTS: Record<ObjectKind, Blast> = {
  shell: { terrainR: 34, damageR: 58, damage: 50, knockback: 6.5 },
  grenade: { terrainR: 30, damageR: 55, damage: 45, knockback: 6 },
  mine: { terrainR: 30, damageR: 60, damage: 45, knockback: 7 },
  dynamite: { terrainR: 62, damageR: 100, damage: 75, knockback: 9 },
};

interface Bullet {
  damage: number;
  carve: number;
  knockback: number;
}
const GUN: Bullet = { damage: 25, carve: 8, knockback: 3.5 };
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
    teams: TEAM_NAMES.slice(0, teamCount).map((name, id) => ({ id, name, nextIndex: 0, weapon: 'bazooka' as WeaponId })),
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
  const aliveTeams = state.teams.filter((t) => state.snails.some((s) => s.alive && s.team === t.id));
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

export function launchProjectile(s: Snail, power: number, kind: 'shell' | 'grenade' = 'shell'): Projectile {
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
    fuse: kind === 'grenade' ? GRENADE_FUSE : -1,
    resting: false,
  };
}

/** Mines and dynamite are dropped just in front of the snail. */
function dropObject(state: GameState, s: Snail, kind: 'mine' | 'dynamite'): Projectile {
  const front = s.x + s.facing * (SNAIL_R + 2);
  return {
    kind,
    x: isSolid(state.terrain, front, s.y) ? s.x : front,
    y: s.y,
    vx: s.facing * 0.6,
    vy: -1.2,
    age: 0,
    ownerId: s.id,
    fuse: kind === 'dynamite' ? DYNAMITE_FUSE : -1,
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

function updateObjects(state: GameState, events: SimEvent[]): void {
  for (const o of [...state.objects]) {
    // An earlier explosion this tick may have removed it.
    if (!state.objects.includes(o)) continue;
    if (o.kind === 'shell') {
      const res = advanceProjectile(o, state.terrain, state.snails, state.wind);
      if (!res) continue;
      removeObject(state, o);
      if (res.type === 'explode') explode(state, res.x, res.y, BLASTS.shell, events);
      else if (res.y > WATER_Y) events.push({ type: 'splash', x: res.x });
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
    if (o.kind === 'shell') continue;
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
  return w === 'bazooka' || w === 'grenade';
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

function clampAim(w: WeaponId, aim: number): number {
  return w === 'torch' ? clamp(aim, -TORCH_AIM, TORCH_AIM) : clamp(aim, AIM_MIN, AIM_MAX);
}

function handleActiveInput(state: GameState, input: InputFrame, events: SimEvent[]): void {
  const s = activeSnail(state);
  if (!s || !s.alive) return;

  const team = state.teams[state.activeTeam];
  if (input.up) s.aim = clampAim(team.weapon, s.aim + 1);
  if (input.down) s.aim = clampAim(team.weapon, s.aim - 1);
  if (state.phase === 'retreat') move(state, s, input);
  if (state.phase !== 'aiming') return;

  if (input.weapon > 0 && input.weapon <= WEAPONS.length && state.shotsFired === 0 && !state.charging) {
    team.weapon = WEAPONS[input.weapon - 1];
    s.aim = clampAim(team.weapon, s.aim);
  }
  const w = team.weapon;
  if (isCharged(w)) {
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
  } else if (input.fire && !state.prevInput.fire && (s.grounded || (w !== 'drill' && w !== 'torch'))) {
    // Dig tools need ground to start from; no torching mid-jump.
    useWeapon(state, s, w, events);
    return;
  }
  // After the first gun shot the snail stays put but may re-aim.
  if (state.shotsFired === 0) move(state, s, input);
}

function useWeapon(state: GameState, s: Snail, w: WeaponId, events: SimEvent[]): void {
  events.push({ type: 'fire', snailId: s.id, weapon: w });
  state.shotsFired++;
  switch (w) {
    case 'bazooka':
    case 'grenade':
      state.objects.push(launchProjectile(s, state.power, w === 'bazooka' ? 'shell' : 'grenade'));
      startRetreat(state);
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
      const busy = state.objects.some((o) => o.kind === 'shell' || o.fuse > 0 || !o.resting);
      if ((still && !busy && state.settleTicks >= SETTLE_MIN_TICKS) || state.settleTicks >= SETTLE_MAX_TICKS) {
        finishTurn(state, events);
      }
      break;
    }
    case 'gameover':
      break;
  }

  updateObjects(state, events);
  for (const s of state.snails) if (s.alive) updateSnailPhysics(state, s, events);
  // Physics would drop the snail inside its own hole; the tool holds it in place.
  const digger = activeSnail(state);
  if (state.dig && !state.dig.falling && digger?.alive) pinToDig(state, digger);

  if (isMoving(state)) {
    const a = activeSnail(state);
    if (!a || !a.alive) beginSettling(state);
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
  mix(state.shotsFired);
  mix(state.burstTicks);
  mix(state.retreatTicks);
  mix(state.jumpTicks);
  if (state.dig) {
    mixF(state.dig.x);
    mixF(state.dig.y);
    mix(state.dig.ticksLeft);
    mix(state.dig.falling ? 1 : 0);
    mix(state.dig.hp);
  }
  for (const t of state.teams) mix(WEAPONS.indexOf(t.weapon));
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
