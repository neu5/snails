import { GIRDER_LEN, HOMING_FUEL, MAP_H, ammoLeft, MAP_W, MINE_ARM_TICKS, girderSpot, SNAIL_R, TICK_RATE, WATER_Y, activeSnail, aimVector, isCharged } from '../sim/game';
import { Camera } from './camera';
import { WEAPONS, WEAPON_ROWS, type GameState, type Projectile, type SimEvent, type Snail, type WeaponId } from '../sim/types';

/** Canvas size; the camera shows part of the (bigger) map in it, or all of it zoomed out. */
export const VIEW_W = 1280;
export const VIEW_H = 720;
/** How much sea beside the map and sky above it the camera may show. */
const CAM_MARGIN = 200;
const CAM_SKY = 500;

const HUD_MARGIN = 16;
const WIND_H = 40;
const TILE = 44;
const TILE_GAP = 6;
/** Weapons per row in the drawer, which shows WEAPON_ROWS when they all fit in its height. */
const MENU_ROW_LEN = 3;
/** Space kept free under the drawer (health bars, touch buttons), unscaled px. */
const MENU_FOOT = 110;
/** Pointer this close to the right edge (canvas px) slides the drawer out on a laptop. */
const EDGE_HOVER = 28;
const MENU_PAD = 10;
const MENU_HEAD = 26;
/** Wind box width; the current-weapon box sits under its right end. */
const BAR_W = 172;

const WEAPON_NAMES: Record<WeaponId, string> = {
  bazooka: 'Bazooka',
  homing: 'Homing',
  grenade: 'Grenade',
  cluster: 'Cluster',
  gun: 'Gun',
  uzi: 'Uzi',
  punch: 'Punch',
  poke: 'Poke',
  kamikaze: 'Kamikaze',
  mine: 'Mine',
  dynamite: 'Dynamite',
  drill: 'Drill',
  torch: 'Blowtorch',
  girder: 'Platform',
  rope: 'Rope',
  parachute: 'Parachute',
  hide: 'Hide',
  select: 'Change',
  surrender: 'Surrender',
};

type Rect = { x: number; y: number; size: number };

export const TEAM_COLORS = ['#ff8a3d', '#5ec8ff'];
const TEAM_SHELL = [
  ['#ffb36b', '#c4571c'],
  ['#9fe0ff', '#2a7fb8'],
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Gravity per frame; defaults to 0.15. Negative floats up (smoke). */
  g?: number;
  /** Drawn additively so it glows (sparks, embers). */
  glow?: boolean;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  /** r, g, b; bullets are pale yellow. */
  rgb?: string;
  max?: number;
}

const ROPE_COLOR = '#c8a165';

/** Weapons used without aiming: no crosshair. */
const NO_AIM = new Set<WeaponId>(['mine', 'dynamite', 'drill', 'punch', 'poke', 'parachute', 'hide', 'select', 'surrender']);

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

/** Read-only view of GameState. Owns only presentation state (particles, caches). */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private terrainVersion = -1;
  private sky: CanvasGradient;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private tracers: Tracer[] = [];
  private shake = 0;
  private banner: { text: string; color: string; life: number } | null = null;
  private frame = 0;
  /** Persistent line under the banner, e.g. "Waiting for ..."; set by the app each frame. */
  status: { text: string; color: string } | null = null;
  /** HUD size factor; above 1 when the canvas is shown small (phones). */
  uiScale = 1;
  /** Touch device: hide key hints. */
  touch = false;
  readonly camera = new Camera(VIEW_W, VIEW_H, { x0: -CAM_MARGIN, y0: -CAM_SKY, x1: MAP_W + CAM_MARGIN, y1: MAP_H });
  /** Whole map on screen (M); stays until toggled off. */
  private overview = false;
  private zoomBeforeOverview = 1;
  /** Where the active snail was when the player started looking around; moving it re-follows. */
  private lookFrom: { x: number; y: number } | null = null;
  private snapCamera = true;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d')!;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = MAP_W;
    this.terrainCanvas.height = MAP_H;
    this.sky = this.ctx.createLinearGradient(0, 0, 0, VIEW_H);
    this.sky.addColorStop(0, '#2b2d5c');
    this.sky.addColorStop(0.55, '#7a5d9e');
    this.sky.addColorStop(1, '#f0a37a');
  }

  /** A short message in the banner spot, e.g. "Sound: off". */
  notice(text: string): void {
    this.banner = { text, color: '#fff', life: 40 };
  }

  reset(): void {
    this.particles = [];
    this.texts = [];
    this.tracers = [];
    this.terrainVersion = -1;
    this.banner = null;
    this.snapCamera = true;
  }

  /** Drag the view by canvas pixels. */
  panBy(dx: number, dy: number, state: GameState): void {
    this.lookAround(state);
    this.camera.panBy(dx, dy);
  }

  /** Zoom around a canvas point. */
  zoomAt(x: number, y: number, factor: number, state: GameState): void {
    this.lookAround(state);
    this.overview = false;
    this.camera.zoomAt(x, y, factor);
  }

  /** Toggles between the whole map and following the action. */
  toggleOverview(): void {
    const c = this.camera;
    if (this.overview) {
      this.overview = false;
      c.manual = false;
      c.zoom = this.zoomBeforeOverview;
      c.clamp();
      return;
    }
    this.overview = true;
    this.zoomBeforeOverview = c.zoom;
    c.manual = true;
    c.zoom = c.fitZoom;
    c.clamp();
  }

  /** Back to following the action at the normal zoom. */
  recenter(): void {
    this.overview = false;
    this.lookFrom = null;
    this.camera.manual = false;
    this.camera.zoom = 1;
  }

  private lookAround(state: GameState): void {
    if (this.camera.manual) return;
    const s = activeSnail(state);
    this.lookFrom = s ? { x: s.x, y: s.y } : null;
  }

  /** What the camera should watch: something flying, else the snail whose turn it is. */
  private focus(state: GameState): { x: number; y: number; fast: boolean } | null {
    const shell = state.objects.find((o) => o.kind === 'shell' || o.kind === 'homing');
    if (shell) return { x: shell.x, y: shell.y, fast: true };
    if (state.hook) return { x: state.hook.x, y: state.hook.y, fast: true };
    const thrown = state.objects.find((o) => !o.resting && o.kind !== 'mine');
    if (thrown) return { x: thrown.x, y: thrown.y, fast: true };
    const s = activeSnail(state);
    if (s && s.alive) return { x: s.x, y: s.y, fast: false };
    return null;
  }

  private updateCamera(state: GameState): void {
    const c = this.camera;
    const s = activeSnail(state);
    // Looking around by hand ends once the snail moves (walking, falling, swinging).
    if (c.manual && !this.overview && this.lookFrom && s && Math.hypot(s.x - this.lookFrom.x, s.y - this.lookFrom.y) > 6) {
      c.manual = false;
      this.lookFrom = null;
    }
    if (c.manual) return;
    const f = this.focus(state);
    if (!f) return;
    if (this.snapCamera) {
      c.centerOn(f.x, f.y);
      this.snapCamera = false;
    } else {
      c.follow(f.x, f.y, f.fast ? 0.15 : 0.08);
    }
  }

  handleEvents(state: GameState, events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'explosion':
          this.shake = 10;
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Math.random() * 5 + 1;
            this.particles.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp - 1,
              life: 0,
              max: 30 + Math.random() * 30,
              color: i % 3 === 0 ? '#ffe17a' : i % 3 === 1 ? '#ff7a2d' : '#6b4a2f',
              size: 2 + Math.random() * 3,
            });
          }
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 14, color: 'flash', size: e.r * 1.6 });
          break;
        case 'damage': {
          const s = state.snails[e.snailId];
          this.texts.push({ x: s.x, y: s.y - 30, text: `-${e.amount}`, color: TEAM_COLORS[s.team], life: 0 });
          break;
        }
        case 'death': {
          const s = state.snails[e.snailId];
          this.texts.push({ x: s.x, y: s.y - 40, text: `${s.name} retreats into its shell forever`, color: '#fff', life: 0 });
          break;
        }
        case 'drown': {
          const s = state.snails[e.snailId];
          this.texts.push({ x: s.x, y: WATER_Y - 30, text: `${s.name} went for a swim`, color: '#bfe8ff', life: 0 });
          break;
        }
        case 'splash':
          for (let i = 0; i < 25; i++) {
            this.particles.push({
              x: e.x,
              y: WATER_Y,
              vx: (Math.random() - 0.5) * 3,
              vy: -Math.random() * 5 - 1,
              life: 0,
              max: 40,
              color: '#bfe8ff',
              size: 2 + Math.random() * 2,
            });
          }
          break;
        case 'rope':
          // A miss shows the rope flying out and falling short; a hit kicks up a little dust.
          if (!e.hit) this.tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0, rgb: '200, 161, 101', max: 14 });
          else for (let i = 0; i < 5; i++) this.puff(e.x1, e.y1, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 15, '#8a5f3c', 2);
          break;
        case 'punch':
          this.texts.push({ x: e.x, y: e.y - 16, text: e.poke ? 'poke!' : e.hit ? 'POW!' : 'swish', color: e.hit ? '#ffe17a' : '#ddd', life: 0 });
          if (e.hit && !e.poke) this.shake = Math.max(this.shake, 5);
          break;
        case 'surrender':
          this.banner = { text: `${state.teams[e.team].name} surrender`, color: '#fff', life: 0 };
          break;
        case 'select': {
          if (!this.overview) this.camera.manual = false;
          const s = state.snails[e.snailId];
          this.banner = { text: `${s.name}'s turn`, color: TEAM_COLORS[s.team], life: 40 };
          break;
        }
        case 'selectRefused': {
          const s = state.snails[e.snailId];
          this.texts.push({ x: s.x, y: s.y - 36, text: 'moved: no change', color: '#ddd', life: 0 });
          break;
        }
        case 'hide': {
          const s = state.snails[e.snailId];
          this.texts.push({ x: s.x, y: s.y - 30, text: 'zzz', color: '#bfe8ff', life: 0 });
          break;
        }
        case 'knock':
          this.texts.push({ x: e.x, y: e.y - 14, text: 'bonk!', color: '#ffe17a', life: 0 });
          this.shake = Math.max(this.shake, 4);
          for (let i = 0; i < 8; i++) this.puff(e.x, e.y, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 12, '#fff', 2);
          break;
        case 'bullet':
          this.tracers.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, life: 0 });
          if (e.hit) {
            for (let i = 0; i < 6; i++) {
              this.particles.push({
                x: e.x1,
                y: e.y1,
                vx: (Math.random() - 0.5) * 3,
                vy: -Math.random() * 2.5,
                life: 0,
                max: 18,
                color: i % 2 ? '#ffe17a' : '#6b4a2f',
                size: 2,
              });
            }
          }
          break;
        case 'dig': {
          // The torch melts rock into glowing drips; the drill throws dirt.
          const torch = state.teams[state.activeTeam].weapon === 'torch';
          for (let i = 0; i < 8; i++) {
            this.particles.push({
              x: e.x + (Math.random() - 0.5) * 16,
              y: e.y + (Math.random() - 0.5) * 16,
              vx: (Math.random() - 0.5) * 2.5,
              vy: -Math.random() * 2,
              life: 0,
              max: torch ? 35 : 25,
              color: torch ? (i % 2 ? '#ff7a1a' : '#ffd166') : i % 3 ? '#8a5f3c' : '#ffcf6b',
              size: 2 + Math.random() * 2,
              glow: torch,
            });
          }
          this.shake = Math.max(this.shake, torch ? 1 : 2);
          break;
        }
        case 'mineTriggered':
          this.texts.push({ x: e.x, y: e.y - 16, text: 'beep!', color: '#ff5555', life: 0 });
          break;
        case 'turn': {
          if (!this.overview) this.camera.manual = false;
          this.lookFrom = null;
          const s = state.snails[e.snailId];
          this.banner = { text: `${state.teams[e.team].name}: ${s.name}'s turn`, color: TEAM_COLORS[e.team], life: 0 };
          break;
        }
        default:
          break;
      }
    }
  }

  private rebuildTerrain(state: GameState): void {
    const t = state.terrain;
    const tctx = this.terrainCanvas.getContext('2d')!;
    const img = tctx.createImageData(t.w, t.h);
    const px = img.data;
    const d = t.data;
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const i = y * t.w + x;
        if (!d[i]) continue;
        let depth = 0;
        while (depth < 10 && y - depth - 1 >= 0 && d[i - (depth + 1) * t.w]) depth++;
        const edge = (x > 0 && !d[i - 1]) || (x < t.w - 1 && !d[i + 1]) || (y < t.h - 1 && !d[i + t.w]);
        const n = ((x * 73856093) ^ (y * 19349663)) & 0xff;
        let r: number, g: number, b: number;
        if (d[i] === 2) {
          // Placed platform: riveted steel.
          const rivet = ((x >> 3) + (y >> 2)) % 5 === 0;
          r = rivet ? 200 : 150; g = rivet ? 205 : 158; b = rivet ? 215 : 170;
        } else if (depth < 4) {
          r = 92; g = 196; b = 92;
        } else if (depth < 7) {
          r = 58; g = 140; b = 64;
        } else {
          const stripe = ((x + y * 2) >> 4) & 1;
          r = 120 + (n & 15) - stripe * 10;
          g = 84 + (n & 15) - stripe * 8;
          b = 58 + (n & 7);
          if (((x * 7 + y * 13) & 63) === 0) { r = 170; g = 150; b = 120; }
        }
        if (edge) { r *= 0.6; g *= 0.6; b *= 0.6; }
        const o = i * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    this.terrainVersion = t.version;
  }

  render(state: GameState): void {
    const ctx = this.ctx;
    this.frame++;
    if (this.terrainVersion !== state.terrain.version) this.rebuildTerrain(state);

    this.updateCamera(state);
    const cam = this.camera;

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    this.drawBackdrop(ctx);
    ctx.drawImage(this.terrainCanvas, 0, 0);

    this.drawRope(ctx, state);
    for (const s of state.snails) this.drawSnail(ctx, state, s);
    for (const o of state.objects) this.drawObject(ctx, o);
    this.drawTarget(ctx, state);
    this.drawDigTool(ctx, state);
    this.drawGear(ctx, state);
    this.drawTracers(ctx);
    this.drawAim(ctx, state);
    this.drawParticles(ctx);
    this.drawWater(ctx);
    ctx.restore();

    this.drawHud(ctx, state);
    this.drawWeaponMenu(ctx, state);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const v = this.camera.visible();
    const x0 = -CAM_MARGIN;
    const span = MAP_W + CAM_MARGIN * 2 + 300;
    ctx.fillStyle = '#ffffff14';
    const clouds = Math.ceil(span / 260);
    for (let i = 0; i < clouds; i++) {
      const x = x0 + ((i * 260 + this.frame * 0.15 * (1 + (i % 3))) % span) - 150;
      const y = MAP_H * 0.08 + ((i * 47) % 220);
      ctx.beginPath();
      ctx.ellipse(x, y, 90, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 50, y - 12, 60, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Distant hills, a little past whatever is on screen.
    ctx.fillStyle = '#3d2f5a';
    ctx.beginPath();
    const left = Math.floor(v.x0 / 40) * 40 - 40;
    const right = v.x1 + 40;
    const base = MAP_H * 0.65;
    ctx.moveTo(left, MAP_H);
    for (let x = left; x <= right; x += 40) ctx.lineTo(x, base - 70 * Math.sin(x * 0.006) - 30 * Math.sin(x * 0.019));
    ctx.lineTo(right, MAP_H);
    ctx.fill();
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    const v = this.camera.visible();
    const left = Math.floor(v.x0 / 16) * 16 - 16;
    const right = v.x1 + 16;
    const bottom = Math.max(MAP_H, v.y1) + 20;
    ctx.fillStyle = '#2d6fa8cc';
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right; x += 16) ctx.lineTo(x, WATER_Y + 3 * Math.sin(x * 0.04 + this.frame * 0.06));
    ctx.lineTo(right, bottom);
    ctx.fill();
    ctx.fillStyle = '#1d4f80';
    ctx.fillRect(left, WATER_Y + 14, right - left, bottom - WATER_Y);
  }

  private drawSnail(ctx: CanvasRenderingContext2D, state: GameState, s: Snail): void {
    if (!s.alive) {
      if (s.y < WATER_Y) {
        // Empty shell marker.
        ctx.fillStyle = '#8a8a8a';
        ctx.beginPath();
        ctx.arc(s.x, s.y + 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y + 2, 3, 0, Math.PI * 1.5);
        ctx.stroke();
      }
      return;
    }
    const isActive = state.activeSnailId === s.id && state.phase !== 'gameover';
    const [shellLight, shellDark] = TEAM_SHELL[s.team];
    const f = s.facing;
    const bob = isActive ? Math.sin(this.frame * 0.15) * 0.8 : 0;
    // Holding a running tool makes the snail tremble.
    const tremble = isActive && state.phase === 'digging' ? 1.6 : 0;
    ctx.save();
    const tuck = s.hidden ? 5 : 0;
    ctx.translate(s.x + (Math.random() - 0.5) * tremble, s.y + SNAIL_R - 1 + tuck + (Math.random() - 0.5) * tremble);
    ctx.scale(f, 1);
    // Tucked into its shell: no body, no eyes.
    if (!s.hidden) {
      // Foot / body.
      ctx.fillStyle = '#d9c9a3';
      ctx.strokeStyle = '#6e5f45';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.quadraticCurveTo(-12, -5, -4, -5);
      ctx.lineTo(7, -5);
      ctx.quadraticCurveTo(10, -6, 10, -12 + bob);
      ctx.lineTo(13, -12 + bob);
      ctx.quadraticCurveTo(14, -2, 11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Eye stalks.
      ctx.strokeStyle = '#6e5f45';
      ctx.beginPath();
      ctx.moveTo(11, -11 + bob);
      ctx.lineTo(13, -19 + bob);
      ctx.moveTo(12, -11 + bob);
      ctx.lineTo(17, -17 + bob);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(13, -20 + bob, 2.2, 0, Math.PI * 2);
      ctx.arc(17.5, -18 + bob, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(13.6, -20 + bob, 1, 0, Math.PI * 2);
      ctx.arc(18.1, -18 + bob, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shell with spiral.
    const g = ctx.createRadialGradient(-3, -12, 2, -2, -10, 10);
    g.addColorStop(0, shellLight);
    g.addColorStop(1, shellDark);
    ctx.fillStyle = g;
    ctx.strokeStyle = '#2a1a10';
    ctx.beginPath();
    ctx.arc(-2, -10, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const r = 7.5 * (1 - a / (Math.PI * 5.5));
      const x = -2 + Math.cos(a) * r;
      const y = -10 + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    if (state.teams[s.team]?.surrendered) drawWhiteFlag(ctx, s.x - 4 * f, s.y - 6, this.frame);

    // Label.
    ctx.font = 'bold 12px Verdana, Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    const label = `${s.name} ${Math.max(0, s.hp)}`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000a';
    ctx.strokeText(label, s.x, s.y - 26);
    ctx.fillStyle = TEAM_COLORS[s.team];
    ctx.fillText(label, s.x, s.y - 26);
    if (isActive && state.phase === 'aiming') {
      const y = s.y - 44 + Math.sin(this.frame * 0.1) * 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(s.x - 6, y - 6);
      ctx.lineTo(s.x + 6, y - 6);
      ctx.lineTo(s.x, y + 2);
      ctx.fill();
    }
  }

  private drawObject(ctx: CanvasRenderingContext2D, o: Projectile): void {
    switch (o.kind) {
      case 'shell':
        this.drawProjectile(ctx, o.x, o.y, o.vx, o.vy);
        return;
      case 'homing':
        this.drawMissile(ctx, o);
        return;
      case 'bomblet':
        ctx.fillStyle = '#2a2a2e';
        ctx.beginPath();
        ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
        ctx.fill();
        return;
      case 'cluster':
        ctx.fillStyle = '#7a2a2a';
        ctx.beginPath();
        ctx.arc(o.x, o.y - 4, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf6b';
        for (const a of [0, 2.1, 4.2]) ctx.fillRect(o.x + Math.cos(a) * 3 - 1, o.y - 4 + Math.sin(a) * 3 - 1, 2, 2);
        break;
      case 'grenade':
        ctx.fillStyle = '#3f5a2a';
        ctx.beginPath();
        ctx.arc(o.x, o.y - 4, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa58a';
        ctx.fillRect(o.x - 1.5, o.y - 10, 3, 3);
        break;
      case 'mine': {
        const armed = o.age >= MINE_ARM_TICKS;
        ctx.fillStyle = '#2a2a2e';
        ctx.beginPath();
        ctx.ellipse(o.x, o.y - 3, 6, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        const blink = o.fuse > 0 ? this.frame % 6 < 3 : armed && this.frame % 40 < 6;
        ctx.fillStyle = blink ? '#ff3b3b' : armed ? '#7a1f1f' : '#4f4f55';
        ctx.beginPath();
        ctx.arc(o.x, o.y - 6, 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'dynamite':
        ctx.fillStyle = '#c9302c';
        ctx.fillRect(o.x - 3, o.y - 12, 6, 12);
        ctx.fillStyle = '#f4e3c1';
        ctx.fillRect(o.x - 3, o.y - 9, 6, 2);
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y - 12);
        ctx.quadraticCurveTo(o.x + 3, o.y - 16, o.x + 1, o.y - 18);
        ctx.stroke();
        if (this.frame % 3 === 0) {
          this.particles.push({ x: o.x + 1, y: o.y - 18, vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 1.5, life: 0, max: 10, color: '#ffd166', size: 2 });
        }
        break;
    }
    if (o.fuse > 0 && o.kind !== 'mine') {
      ctx.font = 'bold 12px Verdana, Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      const label = String(Math.ceil(o.fuse / TICK_RATE));
      ctx.strokeText(label, o.x, o.y - 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, o.x, o.y - 22);
    }
  }

  private drawTracers(ctx: CanvasRenderingContext2D): void {
    const next: Tracer[] = [];
    ctx.lineWidth = 1.5;
    for (const t of this.tracers) {
      t.life++;
      const max = t.max ?? 8;
      if (t.life > max) continue;
      ctx.strokeStyle = `rgba(${t.rgb ?? '255, 236, 160'}, ${1 - t.life / max})`;
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
      next.push(t);
    }
    this.tracers = next;
  }

  /** The homing missile: slim and white, a flame and a smoke trail while it has fuel. */
  private drawMissile(ctx: CanvasRenderingContext2D, o: Projectile): void {
    const burning = o.age < HOMING_FUEL;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(Math.atan2(o.vy, o.vx));
    if (burning) {
      const len = 7 + Math.random() * 5;
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.moveTo(-7, -2.5);
      ctx.lineTo(-7 - len, 0);
      ctx.lineTo(-7, 2.5);
      ctx.fill();
    }
    ctx.fillStyle = '#c62f2f';
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(-3, -2);
    ctx.lineTo(-3, 2);
    ctx.lineTo(-8, 5);
    ctx.fill();
    ctx.fillStyle = '#e6e9ee';
    ctx.fillRect(-8, -2.5, 13, 5);
    ctx.fillStyle = '#c62f2f';
    ctx.beginPath();
    ctx.moveTo(5, -2.5);
    ctx.lineTo(10, 0);
    ctx.lineTo(5, 2.5);
    ctx.fill();
    ctx.restore();
    if (burning && this.frame % 2 === 0) {
      this.puff(o.x, o.y, -o.vx * 0.05, -o.vy * 0.05, 30, '#ddd8', 3, -0.01);
    }
  }

  /** The picked target, turning slowly. */
  private drawTarget(ctx: CanvasRenderingContext2D, state: GameState): void {
    const t = state.target;
    if (!t) return;
    const r = 13 + Math.sin(this.frame * 0.1) * 1.5;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(this.frame * 0.02);
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.moveTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
      ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6));
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number): void {
    const a = Math.atan2(vy, vx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#4b5d3a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9e06b';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(3, -3);
    ctx.lineTo(3, 3);
    ctx.fill();
    ctx.restore();
    if (this.frame % 2 === 0) {
      this.particles.push({ x, y, vx: -vx * 0.05, vy: -vy * 0.05, life: 0, max: 25, color: '#ddd8', size: 3 });
    }
  }

  /** The rope from the snail back through every wrapped corner to the hook. */
  private drawRope(ctx: CanvasRenderingContext2D, state: GameState): void {
    const r = state.rope;
    const s = activeSnail(state);
    if (!s) return;
    const h = state.hook;
    if (h) {
      // Hook on its way out, trailing rope.
      ctx.strokeStyle = ROPE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 4);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.atan2(h.dy, h.dx));
      ctx.strokeStyle = '#c4cad4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(3, 0);
      ctx.moveTo(3, 0);
      ctx.quadraticCurveTo(0, -5, -3, -5);
      ctx.moveTo(3, 0);
      ctx.quadraticCurveTo(0, 5, -3, 5);
      ctx.stroke();
      ctx.restore();
    }
    if (!r) return;
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 4);
    for (let i = r.pivots.length - 1; i >= 0; i--) ctx.lineTo(r.pivots[i].x, r.pivots[i].y);
    ctx.stroke();
    // Hook dug into the ground.
    const a = r.pivots[0];
    ctx.fillStyle = '#9aa0aa';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Parachute canopy, kamikaze flames. */
  private drawGear(ctx: CanvasRenderingContext2D, state: GameState): void {
    const s = activeSnail(state);
    if (!s || !s.alive) return;
    if (state.parachute) {
      const sway = Math.sin(this.frame * 0.05) * 0.08;
      ctx.save();
      ctx.translate(s.x, s.y - 4);
      ctx.rotate(sway);
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of [-20, -7, 7, 20]) {
        ctx.moveTo(0, 0);
        ctx.lineTo(x, -34);
      }
      ctx.stroke();
      const colors = [TEAM_COLORS[s.team], '#fff'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = colors[i % 2];
        ctx.beginPath();
        ctx.moveTo(-22 + i * 11, -34);
        ctx.quadraticCurveTo(-16.5 + i * 11, -50 + Math.abs(i - 1.5) * 4, -11 + i * 11, -34);
        ctx.fill();
      }
      ctx.restore();
    }
    if (state.phase === 'kamikaze' && state.kamikaze) {
      const k = state.kamikaze;
      for (let i = 0; i < 3; i++) {
        this.puff(s.x - k.dx * 8, s.y - k.dy * 8, -k.dx * 2 + (Math.random() - 0.5) * 2, -k.dy * 2 + (Math.random() - 0.5) * 2, 14, i ? '#ff7a1a' : '#ffd166', 3, 0, true);
      }
    }
  }

  /** Where a platform would go, drawn as an outline while aiming. */
  private drawGirderGhost(ctx: CanvasRenderingContext2D, s: Snail): void {
    const g = girderSpot(s);
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(Math.atan2(g.uy, g.ux));
    ctx.strokeStyle = '#ffffffaa';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-GIRDER_LEN / 2, -4, GIRDER_LEN, 8);
    ctx.restore();
  }

  private drawAim(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.phase !== 'aiming' && state.phase !== 'firing') return;
    if (state.rope || state.hook) return;
    const s = activeSnail(state);
    if (!s || !s.alive) return;
    const weapon = state.teams[state.activeTeam].weapon;
    // Mines, dynamite and the drill need no aim.
    if (NO_AIM.has(weapon)) return;
    if (weapon === 'girder') {
      this.drawGirderGhost(ctx, s);
      return;
    }
    const [dx, dy] = aimVector(s);
    const cx = s.x + dx * 46;
    const cy = s.y + dy * 46;
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
    ctx.save();
    ctx.translate(s.x, s.y - 2);
    ctx.rotate(Math.atan2(dy, dx));
    if (weapon === 'homing') {
      ctx.fillStyle = '#e6e9ee';
      ctx.fillRect(0, -3, 18, 6);
      ctx.fillStyle = '#c62f2f';
      ctx.fillRect(15, -4, 4, 8);
    } else if (weapon === 'bazooka') {
      ctx.fillStyle = '#55613f';
      ctx.fillRect(0, -3, 18, 6);
      ctx.fillStyle = '#2e3522';
      ctx.fillRect(15, -4, 4, 8);
    } else if (weapon === 'grenade') {
      ctx.fillStyle = '#3f5a2a';
      ctx.beginPath();
      ctx.arc(12, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (weapon === 'cluster') {
      ctx.fillStyle = '#7a2a2a';
      ctx.beginPath();
      ctx.arc(12, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (weapon === 'kamikaze') {
      // Red headband ribbon trailing back.
      ctx.strokeStyle = '#e04040';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -10);
      ctx.quadraticCurveTo(-12, -14, -16, -10);
      ctx.stroke();
    } else if (weapon === 'rope') {
      // Coiled rope with the hook ready to throw.
      ctx.strokeStyle = ROPE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(8, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#9aa0aa';
      ctx.fillRect(12, -1.5, 6, 3);
    } else if (weapon === 'torch') {
      ctx.fillStyle = '#c94f2c';
      ctx.fillRect(2, -3, 10, 6);
      ctx.fillStyle = '#9aa0aa';
      ctx.fillRect(12, -1.5, 8, 3);
    } else {
      // Gun: long thin barrel. Uzi: short barrel with a magazine.
      ctx.fillStyle = '#3a3a40';
      ctx.fillRect(2, -2, weapon === 'gun' ? 20 : 13, 4);
      if (weapon === 'uzi') ctx.fillRect(6, 1, 3, 6);
    }
    ctx.restore();
    if (state.charging && isCharged(weapon)) {
      const n = Math.ceil(state.power * 12);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / 12;
        ctx.fillStyle = `hsl(${60 - t * 60}, 100%, 55%)`;
        ctx.beginPath();
        ctx.arc(s.x + dx * (14 + i * 3.5), s.y + dy * (14 + i * 3.5), 1.5 + t * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private puff(x: number, y: number, vx: number, vy: number, max: number, color: string, size: number, g?: number, glow?: boolean): void {
    this.particles.push({ x, y, vx, vy, life: 0, max, color, size, g, glow });
  }

  /** The drill or blowtorch while it works. */
  private drawDigTool(ctx: CanvasRenderingContext2D, state: GameState): void {
    const d = state.dig;
    const s = activeSnail(state);
    if (state.phase !== 'digging' || !d || !s) return;
    const len = Math.sqrt(d.dx * d.dx + d.dy * d.dy) || 1;
    // Drawn at the snail, which the tool follows while falling.
    if (state.teams[state.activeTeam].weapon === 'torch') this.drawTorch(ctx, s.x, s.y - 2, d.dx / len, d.dy / len);
    else this.drawDrill(ctx, s.x, s.y);
  }

  /** Jackhammer: shaking body, pounding spiral bit, dirt and sparks at the tip. */
  private drawDrill(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const f = this.frame;
    const pound = f % 4 < 2 ? 0 : 3;
    ctx.save();
    ctx.translate(x + (Math.random() - 0.5) * 2, y - 6);
    // Handle bar with grips.
    ctx.fillStyle = '#b4bac4';
    ctx.fillRect(-12, -16, 24, 4);
    ctx.fillStyle = '#2e2e33';
    ctx.fillRect(-14, -17, 6, 6);
    ctx.fillRect(8, -17, 6, 6);
    // Motor body with vents.
    ctx.fillStyle = '#e0b030';
    roundRect(ctx, -7, -12, 14, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#8a6a10';
    ctx.fillRect(-4, -8, 8, 1.5);
    ctx.fillRect(-4, -4, 8, 1.5);
    ctx.fillStyle = '#555';
    ctx.fillRect(-3, 4, 6, 3);
    // Bit: pounds up and down, its spiral runs down while it spins.
    ctx.translate(0, pound);
    ctx.fillStyle = '#9aa0aa';
    ctx.beginPath();
    ctx.moveTo(-3.5, 7);
    ctx.lineTo(3.5, 7);
    ctx.lineTo(0, 21);
    ctx.fill();
    ctx.strokeStyle = '#5d636d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const by = 8 + ((i * 4 + f) % 13);
      const w = 3.5 * (1 - (by - 7) / 14);
      ctx.moveTo(-w, by + 1);
      ctx.lineTo(w, by - 1);
    }
    ctx.stroke();
    ctx.restore();
    if (pound) {
      const ty = y + 16;
      for (let i = 0; i < 2; i++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.puff(x + side * 4, ty, side * (1 + Math.random() * 2), -1 - Math.random() * 2, 20, i ? '#8a5f3c' : '#6b4a2f', 2 + Math.random() * 2);
      }
      if (Math.random() < 0.4) this.puff(x, ty, (Math.random() - 0.5) * 4, -2 - Math.random() * 2, 12, '#ffe17a', 1.5, 0.2, true);
    }
    if (f % 8 === 0) this.puff(x + (Math.random() - 0.5) * 10, y - 20, (Math.random() - 0.5) * 0.4, -0.4, 40, '#9a8a7a88', 4, -0.01);
  }

  /** Blowtorch: flickering two-tone flame with a glow, sparks and smoke. */
  private drawTorch(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number): void {
    const flick = 0.8 + Math.random() * 0.4;
    const flame = 16 * flick;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(uy, ux));
    // Warm light around the flame.
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(28, 0, 0, 28, 0, 34 * flick);
    glow.addColorStop(0, 'rgba(255, 170, 60, 0.5)');
    glow.addColorStop(1, 'rgba(255, 90, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(28, 0, 34 * flick, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // Gas bottle and nozzle.
    ctx.fillStyle = '#c94f2c';
    roundRect(ctx, -2, -4.5, 12, 9, 3);
    ctx.fill();
    ctx.fillStyle = '#9aa0aa';
    ctx.fillRect(10, -1.5, 10, 3);
    // Outer orange flame, blue cone, white core.
    const cone = (l: number, w: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(20, -w);
      ctx.quadraticCurveTo(20 + l * 0.7, -w * 0.9 + (Math.random() - 0.5), 20 + l, 0);
      ctx.quadraticCurveTo(20 + l * 0.7, w * 0.9 + (Math.random() - 0.5), 20, w);
      ctx.fill();
    };
    cone(flame * 1.3, 5, '#ff9f1c');
    cone(flame * 0.75, 3, '#7fd1ff');
    cone(flame * 0.35, 1.5, '#ffffff');
    ctx.restore();
    // Sparks bounce back off the rock at the flame tip; smoke drifts up.
    const tx = x + ux * (20 + flame);
    const ty = y + uy * (20 + flame);
    for (let i = 0; i < 2; i++) {
      const a = Math.atan2(-uy, -ux) + (Math.random() - 0.5) * 3;
      const v = 1 + Math.random() * 1.8;
      this.puff(tx, ty, Math.cos(a) * v, Math.sin(a) * v, 8 + Math.random() * 10, Math.random() < 0.5 ? '#ffd166' : '#ff7a1a', 1.5, 0.12, true);
    }
    if (this.frame % 5 === 0) this.puff(tx, ty - 4, (Math.random() - 0.5) * 0.5, -0.6, 45, '#6a6a7088', 4 + Math.random() * 3, -0.01);
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.life++;
      if (p.life > p.max) continue;
      const t = p.life / p.max;
      if (p.color === 'flash') {
        ctx.fillStyle = `rgba(255, 240, 180, ${0.9 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + t), 0, Math.PI * 2);
        ctx.fill();
      } else {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g ?? 0.15;
        p.vx *= 0.98;
        ctx.globalAlpha = 1 - t;
        if (p.glow) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color;
        // Smoke (rises) grows as it fades.
        const size = p.g !== undefined && p.g < 0 ? p.size * (1 + t * 2) : p.size;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      next.push(p);
    }
    this.particles = next;

    const texts: FloatText[] = [];
    ctx.font = 'bold 16px Verdana, Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.texts) {
      f.life++;
      if (f.life > 120) continue;
      ctx.globalAlpha = Math.min(1, 2 - f.life / 60);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x, f.y - f.life * 0.3);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.life * 0.3);
      ctx.globalAlpha = 1;
      texts.push(f);
    }
    this.texts = texts;
  }

  /** The box showing the current weapon; tapping it opens the weapon menu. */
  private weaponBox(): Rect {
    const k = this.uiScale;
    return { x: VIEW_W - HUD_MARGIN - TILE * k, y: HUD_MARGIN + (WIND_H + TILE_GAP) * k, size: TILE * k };
  }

  /**
   * Top-left of the drawer, right under the weapon box. While sliding it sits further right,
   * partly past the edge; `settled` gives where it ends up fully open (for hit tests).
   */
  private menuOrigin(settled = false): { x: number; y: number } {
    const k = this.uiScale;
    const box = this.weaponBox();
    const w = this.menuLayout().w;
    const hidden = settled ? 0 : (1 - this.slide) * (w * k + HUD_MARGIN);
    return { x: VIEW_W - HUD_MARGIN - w * k + hidden, y: box.y + box.size + TILE_GAP * k };
  }

  /**
   * Drawer grid size (unscaled px). Short screens cannot fit one row per kind of weapon above
   * the bottom HUD, so there the same order runs on through a wider, shorter grid.
   */
  private menuLayout(): { grouped: boolean; cols: number; rows: number; w: number; h: number } {
    const k = this.uiScale;
    const box = this.weaponBox();
    const top = box.y + box.size + TILE_GAP * k;
    const room = (VIEW_H - top) / k - MENU_HEAD - MENU_PAD - MENU_FOOT;
    const fitRows = Math.max(1, Math.floor((room + TILE_GAP) / (TILE + TILE_GAP)));
    const grouped = fitRows >= WEAPON_ROWS.length;
    const cols = grouped ? MENU_ROW_LEN : Math.max(MENU_ROW_LEN, Math.ceil(WEAPONS.length / fitRows));
    const rows = grouped ? WEAPON_ROWS.length : Math.ceil(WEAPONS.length / cols);
    return {
      grouped,
      cols,
      rows,
      w: cols * (TILE + TILE_GAP) - TILE_GAP + MENU_PAD * 2,
      h: MENU_HEAD + rows * (TILE + TILE_GAP) - TILE_GAP + MENU_PAD,
    };
  }

  /** A weapon's tile in the drawer, in canvas pixels. */
  private menuTile(id: WeaponId, settled = false): Rect {
    const k = this.uiScale;
    const o = this.menuOrigin(settled);
    const { grouped, cols } = this.menuLayout();
    const i = WEAPON_ROWS.flat().indexOf(id);
    const row = grouped ? WEAPON_ROWS.findIndex((r) => r.includes(id)) : Math.floor(i / cols);
    const col = grouped ? WEAPON_ROWS[row].indexOf(id) : i % cols;
    return {
      x: o.x + (MENU_PAD + col * (TILE + TILE_GAP)) * k,
      y: o.y + (MENU_HEAD + row * (TILE + TILE_GAP)) * k,
      size: TILE * k,
    };
  }

  /** Weapons can only be switched before using one. */
  private weaponsLocked(state: GameState): boolean {
    return state.phase !== 'aiming' || state.shotsFired > 0 || state.charging;
  }

  /** The weapon drawer is out (hover the right edge, tap the weapon box, or right-click). */
  menuOpen = false;
  /** 0 = drawer hidden past the right edge, 1 = fully out; eases toward menuOpen. */
  private slide = 0;
  /** Opened by hovering, so moving away closes it again. */
  private hoverOpen = false;

  toggleMenu(state: GameState): void {
    this.menuOpen = !this.menuOpen && !this.weaponsLocked(state);
    this.hoverOpen = false;
  }

  /**
   * Mouse moved (no button held): the drawer slides out while the pointer is at the right
   * edge, on the weapon box or on the drawer, and back in once it leaves. Pass null when the
   * mouse leaves the canvas.
   */
  hover(x: number | null, y: number, state: GameState): void {
    const k = this.uiScale;
    const box = this.weaponBox();
    const o = this.menuOrigin(true);
    const panelH = this.menuLayout().h * k;
    const over =
      x !== null &&
      (x >= VIEW_W - EDGE_HOVER ||
        (x >= box.x && y >= box.y && y <= box.y + box.size) ||
        (this.menuOpen && x >= o.x - 12 * k && y >= box.y && y <= o.y + panelH + 12 * k));
    if (over && !this.menuOpen && !this.weaponsLocked(state)) {
      this.menuOpen = true;
      this.hoverOpen = true;
    } else if (!over && this.menuOpen && this.hoverOpen) {
      this.menuOpen = false;
      this.hoverOpen = false;
    }
  }

  /**
   * A tap or click at a canvas point. `used` says the HUD took it (so it does not drag the
   * map); `weapon` is the 1-based weapon picked from the menu, or 0.
   */
  tap(x: number, y: number, state: GameState): { used: boolean; weapon: number } {
    const inside = (r: Rect) => x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size;
    if (inside(this.weaponBox())) {
      this.toggleMenu(state);
      return { used: true, weapon: 0 };
    }
    if (!this.menuOpen) return { used: false, weapon: 0 };
    this.menuOpen = false;
    this.hoverOpen = false;
    const team = state.teams[state.activeTeam];
    for (let i = 0; i < WEAPONS.length; i++) {
      // A used-up weapon cannot be picked; the tap just closes the menu.
      if (inside(this.menuTile(WEAPONS[i], true))) return { used: true, weapon: team && ammoLeft(team, WEAPONS[i]) === 0 ? 0 : i + 1 };
    }
    // A tap anywhere else just closes the menu.
    return { used: true, weapon: 0 };
  }

  /** Draws `fn` with the origin at (x, y), scaled by uiScale around that point. */
  private anchored(ctx: CanvasRenderingContext2D, x: number, y: number, fn: () => void): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(this.uiScale, this.uiScale);
    fn();
    ctx.restore();
  }

  /** The current weapon's box with its name beside it. */
  private drawWeaponBar(ctx: CanvasRenderingContext2D, state: GameState): void {
    const current = state.teams[state.activeTeam]?.weapon;
    if (!current) return;
    const locked = this.weaponsLocked(state);
    if (locked) this.menuOpen = false;
    const t = this.weaponBox();
    const k = t.size / TILE;
    ctx.globalAlpha = locked ? 0.6 : 1;
    ctx.fillStyle = '#000c';
    roundRect(ctx, t.x, t.y, t.size, t.size, 8 * k);
    ctx.fill();
    ctx.strokeStyle = TEAM_COLORS[state.activeTeam];
    ctx.lineWidth = 2.5 * k;
    ctx.stroke();
    drawWeaponIcon(ctx, current, t.x + t.size / 2, t.y + t.size / 2, t.size * 0.8);
    const left = ammoLeft(state.teams[state.activeTeam], current);
    if (left !== Infinity) drawAmmo(ctx, left, t.x + t.size - 3 * k, t.y + 3 * k, k);
    // A small arrow says it opens.
    if (!locked) {
      ctx.fillStyle = '#fffc';
      ctx.beginPath();
      ctx.moveTo(t.x + t.size - 12 * k, t.y + t.size - 8 * k);
      ctx.lineTo(t.x + t.size - 4 * k, t.y + t.size - 8 * k);
      ctx.lineTo(t.x + t.size - 8 * k, t.y + t.size - 3 * k);
      ctx.fill();
    }
    ctx.font = `bold ${Math.round(13 * k)}px Verdana, Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'right';
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = '#000a';
    const label = WEAPON_NAMES[current];
    ctx.strokeText(label, t.x - 8 * k, t.y + t.size / 2 + 5 * k);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, t.x - 8 * k, t.y + t.size / 2 + 5 * k);
    ctx.globalAlpha = 1;
  }

  /** The open weapon menu: every weapon as an icon, tap one to pick it. */
  private drawWeaponMenu(ctx: CanvasRenderingContext2D, state: GameState): void {
    this.slide += ((this.menuOpen ? 1 : 0) - this.slide) * 0.25;
    if (this.slide < 0.01) return;
    const current = state.teams[state.activeTeam]?.weapon;
    const k = this.uiScale;
    const o = this.menuOrigin();
    const { w, h } = this.menuLayout();
    ctx.fillStyle = '#000d';
    roundRect(ctx, o.x, o.y, w * k, h * k, 12 * k);
    ctx.fill();
    ctx.font = `bold ${Math.round(12 * k)}px Verdana, Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ddd';
    ctx.fillText('Pick a weapon', o.x + MENU_PAD * k, o.y + 18 * k);
    const team = state.teams[state.activeTeam];
    WEAPONS.forEach((id) => {
      const t = this.menuTile(id);
      const on = id === current;
      const left = team ? ammoLeft(team, id) : Infinity;
      ctx.globalAlpha = left === 0 ? 0.3 : 1;
      ctx.fillStyle = on ? '#ffffff22' : '#ffffff0d';
      roundRect(ctx, t.x, t.y, t.size, t.size, 8 * k);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = TEAM_COLORS[state.activeTeam];
        ctx.lineWidth = 2.5 * k;
        ctx.stroke();
      }
      drawWeaponIcon(ctx, id, t.x + t.size / 2, t.y + t.size / 2 - 4 * k, t.size * 0.66);
      ctx.font = `${Math.round(8 * k)}px Verdana, Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ddd';
      ctx.fillText(WEAPON_NAMES[id], t.x + t.size / 2, t.y + t.size - 4 * k);
      if (left !== Infinity) drawAmmo(ctx, left, t.x + t.size - 3 * k, t.y + 3 * k, k);
      ctx.globalAlpha = 1;
    });
  }

  private drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
    const secs = Math.ceil(state.turnTicksLeft / TICK_RATE);
    this.anchored(ctx, HUD_MARGIN, HUD_MARGIN, () => {
      // Turn timer.
      ctx.fillStyle = '#000a';
      roundRect(ctx, 0, 0, 74, 52, 10);
      ctx.fill();
      ctx.font = 'bold 30px Verdana, Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      if (state.phase === 'retreat') {
        ctx.fillStyle = '#ffd166';
        ctx.fillText(String(Math.ceil(state.retreatTicks / TICK_RATE)), 37, 37);
      } else {
        ctx.fillStyle = state.phase === 'aiming' ? (secs <= 5 ? '#ff5555' : TEAM_COLORS[state.activeTeam]) : '#888';
        ctx.fillText(state.phase === 'aiming' ? String(secs) : '--', 37, 37);
      }

      ctx.font = '12px Verdana, Arial, Helvetica, sans-serif';
      ctx.fillStyle = '#ffffffaa';
      ctx.textAlign = 'left';
      if (!this.touch) {
        ctx.fillText('←/→ walk   ↑/↓ aim   Enter jump (×2 back)   mouse to right edge: weapons   Space fire   P replay   M map   drag/wheel look   C center   N sound   R new map', 88, 20);
      }
      ctx.fillText(`Turn ${state.turnNumber}`, 88, 40);
    });

    // Wind.
    this.anchored(ctx, VIEW_W - HUD_MARGIN, HUD_MARGIN, () => {
      const w = BAR_W;
      ctx.fillStyle = '#000a';
      roundRect(ctx, -w, 0, w, WIND_H, 10);
      ctx.fill();
      ctx.font = 'bold 12px Verdana, Arial, Helvetica, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ddd';
      ctx.fillText('WIND', -w + 10, 25);
      const barX = -w + 60;
      const barW = w - 76;
      const mid = barX + barW / 2;
      const f = state.wind / 0.035;
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, 14, barW, 12);
      ctx.fillStyle = f >= 0 ? '#7fd1ff' : '#ffb37f';
      if (f >= 0) ctx.fillRect(mid, 14, (barW / 2) * f, 12);
      else ctx.fillRect(mid + (barW / 2) * f, 14, (-barW / 2) * f, 12);
      ctx.fillStyle = '#fff';
      ctx.fillRect(mid - 1, 11, 2, 18);
    });

    this.drawWeaponBar(ctx, state);

    // Team health bars.
    this.anchored(ctx, VIEW_W / 2, VIEW_H - HUD_MARGIN, () => {
      const maxTotal = state.config.startHp * state.config.snailsPerTeam;
      state.teams.forEach((t, i) => {
        const hp = state.snails.filter((s) => s.team === t.id && s.alive).reduce((a, s) => a + Math.max(0, s.hp), 0);
        const y = -42 + i * 22;
        ctx.fillStyle = '#000a';
        roundRect(ctx, -160, y, 320, 18, 6);
        ctx.fill();
        ctx.fillStyle = TEAM_COLORS[i];
        roundRect(ctx, -158, y + 2, 316 * Math.min(1, hp / maxTotal), 14, 5);
        ctx.fill();
        ctx.font = 'bold 12px Verdana, Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.fillText(t.name, -168, y + 13);
      });
    });

    this.anchored(ctx, VIEW_W / 2, 0, () => {
      if (this.banner) {
        this.banner.life++;
        const b = this.banner;
        if (b.life > 120) this.banner = null;
        else {
          ctx.globalAlpha = Math.min(1, (120 - b.life) / 30);
          ctx.font = 'bold 26px Verdana, Arial, Helvetica, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#000';
          ctx.strokeText(b.text, 0, 130);
          ctx.fillStyle = b.color;
          ctx.fillText(b.text, 0, 130);
          ctx.globalAlpha = 1;
        }
      }

      if (this.status) {
        ctx.font = 'bold 16px Verdana, Arial, Helvetica, sans-serif';
        const w = ctx.measureText(this.status.text).width + 32;
        ctx.fillStyle = '#000b';
        roundRect(ctx, -w / 2, 150, w, 30, 15);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = this.status.color;
        ctx.fillText(this.status.text, 0, 171);
      }
    });

    if (state.phase === 'gameover') {
      ctx.fillStyle = '#000b';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      this.anchored(ctx, VIEW_W / 2, VIEW_H / 2, () => {
        ctx.textAlign = 'center';
        ctx.font = 'bold 56px Verdana, Arial, Helvetica, sans-serif';
        const won = state.winner !== null && state.winner >= 0;
        ctx.fillStyle = won ? TEAM_COLORS[state.winner!] : '#fff';
        ctx.fillText(won ? `${state.teams[state.winner!].name} win!` : 'Draw!', 0, -10);
        ctx.font = '20px Verdana, Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#ddd';
        ctx.fillText(this.touch ? 'Tap ⟳ for a new map' : 'Press R for a new map', 0, 34);
      });
    }
  }
}

/** Weapon pictures for the HUD, drawn in a 32-unit box centred on (cx, cy) and scaled to `size`. */
function drawWeaponIcon(ctx: CanvasRenderingContext2D, id: WeaponId, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 32, size / 32);
  switch (id) {
    case 'homing':
      // White missile homing in on a red ring.
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(9, -9, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(-0.75);
      ctx.fillStyle = '#c62f2f';
      ctx.beginPath();
      ctx.moveTo(-13, -6);
      ctx.lineTo(-7, -2.5);
      ctx.lineTo(-7, 2.5);
      ctx.lineTo(-13, 6);
      ctx.fill();
      ctx.fillStyle = '#e6e9ee';
      ctx.fillRect(-12, -3, 15, 6);
      ctx.fillStyle = '#c62f2f';
      ctx.beginPath();
      ctx.moveTo(3, -3);
      ctx.lineTo(8, 0);
      ctx.lineTo(3, 3);
      ctx.fill();
      break;
    case 'bazooka':
      ctx.rotate(-0.5);
      ctx.fillStyle = '#6b7a4f';
      ctx.fillRect(-13, -4, 22, 8);
      ctx.fillStyle = '#2e3522';
      ctx.fillRect(-15, -5, 3, 10);
      ctx.fillStyle = '#c9e06b';
      ctx.beginPath();
      ctx.moveTo(9, -4);
      ctx.lineTo(15, 0);
      ctx.lineTo(9, 4);
      ctx.fill();
      break;
    case 'grenade':
      ctx.fillStyle = '#4b6b30';
      ctx.beginPath();
      ctx.arc(0, 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7f9b5a';
      ctx.beginPath();
      ctx.arc(-3, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa58a';
      ctx.fillRect(-3, -9, 6, 4);
      ctx.strokeStyle = '#c8cdbf';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(6, -10, 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'gun':
      ctx.fillStyle = '#b4bac4';
      ctx.fillRect(-14, -7, 28, 5);
      ctx.fillStyle = '#8a6a48';
      ctx.beginPath();
      ctx.moveTo(-12, -2);
      ctx.lineTo(-5, -2);
      ctx.lineTo(-7, 10);
      ctx.lineTo(-14, 10);
      ctx.fill();
      ctx.strokeStyle = '#b4bac4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-3, 1, 3, 0, Math.PI);
      ctx.stroke();
      break;
    case 'uzi':
      ctx.fillStyle = '#9aa0aa';
      ctx.fillRect(-11, -7, 20, 8);
      ctx.fillRect(9, -5, 6, 3);
      ctx.fillRect(-9, 1, 5, 9);
      ctx.fillStyle = '#d0d4da';
      ctx.fillRect(-1, 1, 5, 13);
      ctx.fillRect(-8, -9, 3, 2);
      break;
    case 'mine':
      ctx.fillStyle = '#767680';
      ctx.beginPath();
      ctx.ellipse(0, 5, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3a3ad';
      ctx.beginPath();
      ctx.ellipse(0, 1, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(0, -2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'drill':
      // Jackhammer: handle bar, body, bit pointing down.
      ctx.fillStyle = '#b4bac4';
      ctx.fillRect(-11, -14, 22, 4);
      ctx.fillStyle = '#e0b030';
      ctx.fillRect(-6, -10, 12, 14);
      ctx.fillStyle = '#9aa0aa';
      ctx.beginPath();
      ctx.moveTo(-3, 4);
      ctx.lineTo(3, 4);
      ctx.lineTo(0, 15);
      ctx.fill();
      break;
    case 'torch':
      // Gas bottle with a nozzle and flame.
      ctx.fillStyle = '#c94f2c';
      roundRect(ctx, -14, -6, 10, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#b4bac4';
      ctx.fillRect(-4, -3, 10, 4);
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.moveTo(6, -6);
      ctx.quadraticCurveTo(18, -1, 6, 4);
      ctx.fill();
      ctx.fillStyle = '#7fd1ff';
      ctx.beginPath();
      ctx.moveTo(6, -3);
      ctx.quadraticCurveTo(12, -1, 6, 1);
      ctx.fill();
      break;
    case 'cluster':
      // Red bomb with little bomblets around it.
      ctx.fillStyle = '#a33a3a';
      ctx.beginPath();
      ctx.arc(-2, 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa58a';
      ctx.fillRect(-4, -9, 5, 4);
      ctx.fillStyle = '#ffcf6b';
      for (const [x, y] of [[10, -8], [12, 2], [7, 11]]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'punch':
      // Red boxing glove.
      ctx.fillStyle = '#d63a3a';
      roundRect(ctx, -6, -9, 18, 16, 7);
      ctx.fill();
      ctx.fillStyle = '#b02a2a';
      roundRect(ctx, -2, -12, 9, 7, 3.5);
      ctx.fill();
      ctx.fillStyle = '#f4e3c1';
      ctx.fillRect(-13, -6, 7, 11);
      break;
    case 'poke':
      // Pointing finger.
      ctx.fillStyle = '#f0c9a0';
      roundRect(ctx, -12, -5, 14, 12, 4);
      ctx.fill();
      roundRect(ctx, 0, -4, 14, 5, 2.5);
      ctx.fill();
      ctx.strokeStyle = '#b08060';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-6, 1);
      ctx.lineTo(1, 1);
      ctx.moveTo(-6, 4);
      ctx.lineTo(1, 4);
      ctx.stroke();
      break;
    case 'kamikaze':
      // Headband with a flame.
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.quadraticCurveTo(-12, -4, 0, -14);
      ctx.quadraticCurveTo(-2, -2, 6, -6);
      ctx.quadraticCurveTo(12, 6, 6, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-13, 8, 26, 6);
      ctx.fillStyle = '#e04040';
      ctx.beginPath();
      ctx.arc(0, 11, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'girder':
      // Steel beam with rivets.
      ctx.rotate(-0.35);
      ctx.fillStyle = '#9aa0aa';
      ctx.fillRect(-15, -4, 30, 8);
      ctx.fillStyle = '#d0d4dc';
      for (const x of [-11, -3, 5, 12]) {
        ctx.beginPath();
        ctx.arc(x, 0, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'parachute':
      ctx.fillStyle = '#5ec8ff';
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.quadraticCurveTo(0, -20, 14, -2);
      ctx.fill();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const x of [-14, -5, 5, 14]) {
        ctx.moveTo(x, -2);
        ctx.lineTo(0, 11);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffb36b';
      ctx.beginPath();
      ctx.arc(0, 12, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'select':
      // Two shells with arrows going round between them.
      for (const [x, c] of [
        [-7, '#ffb36b'],
        [7, '#9fe0ff'],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, 5, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 2, 11, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(10, -9);
      ctx.lineTo(4, -11);
      ctx.lineTo(9, -4);
      ctx.fill();
      break;
    case 'surrender':
      drawWhiteFlag(ctx, -4, 12, 0, 1.4);
      break;
    case 'hide':
      // A shell with "zzz".
      ctx.fillStyle = '#ffb36b';
      ctx.beginPath();
      ctx.arc(-3, 4, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a3a10';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-3, 4, 6, 0, Math.PI * 1.5);
      ctx.arc(-3, 4, 2.5, Math.PI * 1.5, Math.PI * 3);
      ctx.stroke();
      ctx.fillStyle = '#bfe8ff';
      ctx.font = 'bold 9px Verdana, Arial, Helvetica, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('z', 6, -6);
      ctx.fillText('z', 10, -12);
      break;
    case 'rope':
      // Coil of rope with a grappling hook.
      ctx.strokeStyle = '#c8a165';
      ctx.lineWidth = 2.5;
      for (const r of [9, 6, 3]) {
        ctx.beginPath();
        ctx.arc(-3, 3, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#c4cad4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(6, -6);
      ctx.lineTo(12, -12);
      ctx.moveTo(12, -12);
      ctx.quadraticCurveTo(16, -8, 14, -4);
      ctx.moveTo(12, -12);
      ctx.quadraticCurveTo(8, -16, 4, -14);
      ctx.stroke();
      break;
    case 'dynamite':
      ctx.rotate(0.25);
      ctx.fillStyle = '#c9302c';
      ctx.fillRect(-5, -9, 10, 22);
      ctx.fillStyle = '#f4e3c1';
      ctx.fillRect(-5, -3, 10, 3);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.quadraticCurveTo(5, -12, 3, -15);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(3, -15, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** Uses left, as a small number badge with its top-right corner at (x, y). */
function drawAmmo(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, k: number): void {
  const text = String(n);
  ctx.font = `bold ${Math.round(9 * k)}px Verdana, Arial, Helvetica, sans-serif`;
  const w = Math.max(12 * k, ctx.measureText(text).width + 6 * k);
  const h = 12 * k;
  ctx.fillStyle = n === 0 ? '#555' : '#ffd166';
  roundRect(ctx, x - w, y, w, h, 6 * k);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.fillText(text, x - w / 2, y + 9 * k);
}

/** A white flag on a stick, the stick's foot at (x, y). */
function drawWhiteFlag(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -22);
  ctx.stroke();
  const wave = Math.sin(frame * 0.12) * 1.5;
  ctx.fillStyle = '#f4f4f0';
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.quadraticCurveTo(6, -24 + wave, 12, -21);
  ctx.lineTo(12, -13);
  ctx.quadraticCurveTo(6, -16 - wave, 0, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, r);
}
