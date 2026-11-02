import { MAP_H, MAP_W, MINE_ARM_TICKS, SNAIL_R, TICK_RATE, WATER_Y, activeSnail, aimVector, isCharged } from '../sim/game';
import { WEAPONS, type GameState, type Projectile, type SimEvent, type Snail, type WeaponId } from '../sim/types';

const HUD_MARGIN = 16;
const WIND_H = 40;
const TILE = 40;
const TILE_GAP = 4;
/** Weapon icons sit in a grid this many wide, under the wind box of the same width. */
const BAR_COLS = 5;
const BAR_W = BAR_COLS * (TILE + TILE_GAP) - TILE_GAP;

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

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    this.ctx = canvas.getContext('2d')!;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = MAP_W;
    this.terrainCanvas.height = MAP_H;
    this.sky = this.ctx.createLinearGradient(0, 0, 0, MAP_H);
    this.sky.addColorStop(0, '#2b2d5c');
    this.sky.addColorStop(0.55, '#7a5d9e');
    this.sky.addColorStop(1, '#f0a37a');
  }

  reset(): void {
    this.particles = [];
    this.texts = [];
    this.tracers = [];
    this.terrainVersion = -1;
    this.banner = null;
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
        if (depth < 4) {
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

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(-20, -20, MAP_W + 40, MAP_H + 40);
    this.drawBackdrop(ctx);
    ctx.drawImage(this.terrainCanvas, 0, 0);

    this.drawRope(ctx, state);
    for (const s of state.snails) this.drawSnail(ctx, state, s);
    for (const o of state.objects) this.drawObject(ctx, o);
    this.drawDigTool(ctx, state);
    this.drawTracers(ctx);
    this.drawAim(ctx, state);
    this.drawParticles(ctx);
    this.drawWater(ctx);
    ctx.restore();

    this.drawHud(ctx, state);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#ffffff14';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 260 + this.frame * 0.15 * (1 + (i % 3))) % (MAP_W + 300)) - 150;
      const y = 60 + (i * 47) % 160;
      ctx.beginPath();
      ctx.ellipse(x, y, 90, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 50, y - 12, 60, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3d2f5a';
    ctx.beginPath();
    ctx.moveTo(0, MAP_H);
    for (let x = 0; x <= MAP_W; x += 40) ctx.lineTo(x, 470 - 70 * Math.sin(x * 0.006) - 30 * Math.sin(x * 0.019));
    ctx.lineTo(MAP_W, MAP_H);
    ctx.fill();
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2d6fa8cc';
    ctx.beginPath();
    ctx.moveTo(0, MAP_H);
    for (let x = 0; x <= MAP_W; x += 16) ctx.lineTo(x, WATER_Y + 3 * Math.sin(x * 0.04 + this.frame * 0.06));
    ctx.lineTo(MAP_W, MAP_H);
    ctx.fill();
    ctx.fillStyle = '#1d4f80';
    ctx.fillRect(0, WATER_Y + 14, MAP_W, MAP_H);
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
    ctx.translate(s.x + (Math.random() - 0.5) * tremble, s.y + SNAIL_R - 1 + (Math.random() - 0.5) * tremble);
    ctx.scale(f, 1);
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

  private drawAim(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.phase !== 'aiming' && state.phase !== 'firing') return;
    if (state.rope || state.hook) return;
    const s = activeSnail(state);
    if (!s || !s.alive) return;
    const weapon = state.teams[state.activeTeam].weapon;
    // Mines, dynamite and the drill need no aim.
    if (weapon === 'mine' || weapon === 'dynamite' || weapon === 'drill') return;
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
    if (weapon === 'bazooka') {
      ctx.fillStyle = '#55613f';
      ctx.fillRect(0, -3, 18, 6);
      ctx.fillStyle = '#2e3522';
      ctx.fillRect(15, -4, 4, 8);
    } else if (weapon === 'grenade') {
      ctx.fillStyle = '#3f5a2a';
      ctx.beginPath();
      ctx.arc(12, 0, 4, 0, Math.PI * 2);
      ctx.fill();
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

  /** Corner of weapon tile i (0-based) in canvas pixels, after uiScale. */
  private weaponTile(i: number): { x: number; y: number; size: number } {
    const k = this.uiScale;
    const col = i % BAR_COLS;
    const row = Math.floor(i / BAR_COLS);
    return {
      x: MAP_W - HUD_MARGIN - BAR_W * k + col * (TILE + TILE_GAP) * k,
      y: HUD_MARGIN + (WIND_H + TILE_GAP * 2 + row * (TILE + TILE_GAP)) * k,
      size: TILE * k,
    };
  }

  /** 1-based weapon index under a point in canvas pixels, or 0. */
  weaponAt(x: number, y: number): number {
    for (let i = 0; i < WEAPONS.length; i++) {
      const t = this.weaponTile(i);
      if (x >= t.x && x <= t.x + t.size && y >= t.y && y <= t.y + t.size) return i + 1;
    }
    return 0;
  }

  /** Draws `fn` with the origin at (x, y), scaled by uiScale around that point. */
  private anchored(ctx: CanvasRenderingContext2D, x: number, y: number, fn: () => void): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(this.uiScale, this.uiScale);
    fn();
    ctx.restore();
  }

  private drawWeaponBar(ctx: CanvasRenderingContext2D, state: GameState): void {
    const current = state.teams[state.activeTeam]?.weapon;
    // Dim the bar while switching is not possible.
    const locked = state.phase !== 'aiming' || state.shotsFired > 0 || state.charging;
    WEAPONS.forEach((id, i) => {
      const t = this.weaponTile(i);
      const k = t.size / TILE;
      const on = id === current;
      ctx.globalAlpha = locked && !on ? 0.45 : 1;
      ctx.fillStyle = on ? '#000c' : '#0007';
      roundRect(ctx, t.x, t.y, t.size, t.size, 8 * k);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = TEAM_COLORS[state.activeTeam];
        ctx.lineWidth = 2.5 * k;
        ctx.stroke();
      }
      if (!on) ctx.globalAlpha *= 0.7;
      drawWeaponIcon(ctx, id, t.x + t.size / 2, t.y + t.size / 2, t.size * 0.8);
      ctx.globalAlpha = 1;
      if (!this.touch) {
        ctx.font = `bold ${Math.round(10 * k)}px Verdana, Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fffa';
        ctx.fillText(String(i + 1), t.x + 4 * k, t.y + 11 * k);
      }
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
        ctx.fillText('←/→ walk   ↑/↓ aim   Enter jump (×2 back)   1-9 weapon   Space fire   P replay last move   R new map', 88, 20);
      }
      ctx.fillText(`Turn ${state.turnNumber}`, 88, 40);
    });

    // Wind.
    this.anchored(ctx, MAP_W - HUD_MARGIN, HUD_MARGIN, () => {
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
    this.anchored(ctx, MAP_W / 2, MAP_H - HUD_MARGIN, () => {
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

    this.anchored(ctx, MAP_W / 2, 0, () => {
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
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      this.anchored(ctx, MAP_W / 2, MAP_H / 2, () => {
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, r);
}
