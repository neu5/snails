import { MAP_H, MAP_W, SNAIL_R, TICK_RATE, WATER_Y, activeSnail, aimVector } from '../sim/game';
import type { GameState, SimEvent, Snail } from '../sim/types';

const TEAM_COLORS = ['#ff8a3d', '#5ec8ff'];
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
}

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
  private shake = 0;
  private banner: { text: string; color: string; life: number } | null = null;
  private frame = 0;

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

    for (const s of state.snails) this.drawSnail(ctx, state, s);
    if (state.projectile) this.drawProjectile(ctx, state.projectile.x, state.projectile.y, state.projectile.vx, state.projectile.vy);
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
    ctx.save();
    ctx.translate(s.x, s.y + SNAIL_R - 1);
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
    ctx.font = 'bold 12px system-ui, sans-serif';
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

  private drawAim(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.phase !== 'aiming') return;
    const s = activeSnail(state);
    if (!s || !s.alive) return;
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
    // Bazooka tube.
    ctx.save();
    ctx.translate(s.x, s.y - 2);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = '#55613f';
    ctx.fillRect(0, -3, 18, 6);
    ctx.fillStyle = '#2e3522';
    ctx.fillRect(15, -4, 4, 8);
    ctx.restore();
    if (state.charging) {
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
        p.vy += 0.15;
        p.vx *= 0.98;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      }
      next.push(p);
    }
    this.particles = next;

    const texts: FloatText[] = [];
    ctx.font = 'bold 16px system-ui, sans-serif';
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

  private drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
    // Turn timer.
    const secs = Math.ceil(state.turnTicksLeft / TICK_RATE);
    ctx.fillStyle = '#000a';
    roundRect(ctx, 16, 16, 74, 52, 10);
    ctx.fill();
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.phase === 'aiming' ? (secs <= 5 ? '#ff5555' : TEAM_COLORS[state.activeTeam]) : '#888';
    ctx.fillText(state.phase === 'aiming' ? String(secs) : '--', 53, 53);

    // Team health bars.
    const maxTotal = state.config.startHp * state.config.snailsPerTeam;
    state.teams.forEach((t, i) => {
      const hp = state.snails.filter((s) => s.team === t.id && s.alive).reduce((a, s) => a + Math.max(0, s.hp), 0);
      const y = MAP_H - 58 + i * 22;
      ctx.fillStyle = '#000a';
      roundRect(ctx, MAP_W / 2 - 160, y, 320, 18, 6);
      ctx.fill();
      ctx.fillStyle = TEAM_COLORS[i];
      roundRect(ctx, MAP_W / 2 - 158, y + 2, 316 * Math.min(1, hp / maxTotal), 14, 5);
      ctx.fill();
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(t.name, MAP_W / 2 - 168, y + 13);
    });

    // Wind.
    ctx.fillStyle = '#000a';
    roundRect(ctx, MAP_W - 196, 16, 180, 40, 10);
    ctx.fill();
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ddd';
    ctx.fillText('WIND', MAP_W - 186, 41);
    const w = state.wind / 0.035;
    ctx.fillStyle = '#333';
    ctx.fillRect(MAP_W - 140, 30, 112, 12);
    ctx.fillStyle = w >= 0 ? '#7fd1ff' : '#ffb37f';
    const half = 56;
    if (w >= 0) ctx.fillRect(MAP_W - 84, 30, half * w, 12);
    else ctx.fillRect(MAP_W - 84 + half * w, 30, -half * w, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(MAP_W - 85, 27, 2, 18);

    // Controls hint.
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#ffffffaa';
    ctx.textAlign = 'left';
    ctx.fillText('←/→ walk   ↑/↓ aim   Enter jump   hold Space to fire   R restart', 104, 36);
    ctx.fillText(`Turn ${state.turnNumber}`, 104, 56);

    if (this.banner) {
      this.banner.life++;
      const b = this.banner;
      if (b.life > 120) this.banner = null;
      else {
        const a = Math.min(1, (120 - b.life) / 30);
        ctx.globalAlpha = a;
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#000';
        ctx.strokeText(b.text, MAP_W / 2, 110);
        ctx.fillStyle = b.color;
        ctx.fillText(b.text, MAP_W / 2, 110);
        ctx.globalAlpha = 1;
      }
    }

    if (state.phase === 'gameover') {
      ctx.fillStyle = '#000b';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      ctx.textAlign = 'center';
      ctx.font = 'bold 56px system-ui, sans-serif';
      const won = state.winner !== null && state.winner >= 0;
      ctx.fillStyle = won ? TEAM_COLORS[state.winner!] : '#fff';
      ctx.fillText(won ? `${state.teams[state.winner!].name} win!` : 'Draw!', MAP_W / 2, MAP_H / 2 - 10);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText('Press R for a new map', MAP_W / 2, MAP_H / 2 + 34);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, r);
}
