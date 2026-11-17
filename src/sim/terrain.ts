import { Rng, dsin } from './math';

export interface Terrain {
  w: number;
  h: number;
  /** 0 = air, 1 = ground, 2 = a placed platform (solid too). Row-major. */
  data: Uint8Array;
  /** Bumped on every modification so renderers can cache. */
  version: number;
}

export function isSolid(t: Terrain, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= t.w || iy >= t.h) return false;
  return t.data[iy * t.w + ix] !== 0;
}

export function carveCircle(t: Terrain, cx: number, cy: number, r: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(t.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(t.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) t.data[y * t.w + x] = 0;
    }
  }
  t.version++;
}

/**
 * Lays a solid bar (a platform) centred on (cx, cy) along the unit direction (ux, uy).
 * Pixels for which `keepClear` is true stay empty, so it never traps a snail.
 */
export function fillBar(
  t: Terrain,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  len: number,
  thick: number,
  keepClear: (x: number, y: number) => boolean,
): void {
  const reach = Math.ceil(len / 2 + thick);
  for (let y = Math.floor(cy - reach); y <= cy + reach; y++) {
    for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
      if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const along = dx * ux + dy * uy;
      const across = -dx * uy + dy * ux;
      if (Math.abs(along) > len / 2 || Math.abs(across) > thick / 2) continue;
      if (keepClear(x + 0.5, y + 0.5)) continue;
      t.data[y * t.w + x] = 2;
    }
  }
  t.version++;
}

/**
 * Map styles. island: one big island (the classic). islands: three or four islands with sea
 * between them. cavern: a closed cave with a rock roof and walls, pits down to the water.
 * canyon: two high cliffs either side of a deep gorge with a rock arch across it.
 */
export type MapStyle = 'island' | 'islands' | 'cavern' | 'canyon';
export const MAP_STYLES: readonly MapStyle[] = ['island', 'islands', 'cavern', 'canyon'];

export function generateTerrain(w: number, h: number, waterY: number, rng: Rng, style: MapStyle = 'island'): Terrain {
  switch (style) {
    case 'islands':
      return islands(w, h, waterY, rng);
    case 'cavern':
      return cavern(w, h, waterY, rng);
    case 'canyon':
      return canyon(w, h, waterY, rng);
    default:
      return island(w, h, waterY, rng);
  }
}

type Wave = { amp: number; freq: number; phase: number };

/** Rolling hills: a few sine waves of falling size. */
function makeWaves(rng: Rng, scale = 1): Wave[] {
  const waves: Wave[] = [];
  for (let i = 0; i < 5; i++) {
    waves.push({
      amp: (rng.range(14, 70) / (i + 1)) * scale,
      freq: rng.range(0.8, 1.6) * (i + 1) * 0.004,
      phase: rng.range(0, 6.283),
    });
  }
  return waves;
}

/** `base` plus the waves at x (added one by one, so the classic island keeps its exact shape). */
function waveAt(waves: Wave[], x: number, base = 0): number {
  let y = base;
  for (const wv of waves) y += wv.amp * dsin(x * wv.freq + wv.phase);
  return y;
}

/** Each coast is its own shape: from a gentle beach (0) to a cliff at the waterline (1). */
function shore(t: number, cliff: number): number {
  const smooth = t * t * (3 - 2 * t);
  return smooth * (1 - cliff) + Math.sqrt(t) * cliff;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Ground from each column's height down to the bottom. */
function fromHeights(w: number, h: number, heights: Float64Array): Terrain {
  const data = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = Math.max(0, Math.floor(heights[x])); y < h; y++) data[y * w + x] = 1;
  }
  return { w, h, data, version: 0 };
}

/** Caves and pockmarks: short chains of round holes. */
function carveCaves(t: Terrain, rng: Rng, count: number, yMin: number, yMax: number): void {
  for (let i = 0; i < count; i++) {
    let x = rng.range(t.w * 0.15, t.w * 0.85);
    let y = rng.range(yMin, yMax);
    const len = rng.int(3, 7);
    for (let j = 0; j < len; j++) {
      carveCircle(t, x, y, rng.range(18, 34));
      x += rng.range(-30, 30);
      y += rng.range(-14, 14);
    }
  }
}

/** A floating ledge: flat on top, tapering underneath. */
function ledge(t: Terrain, lx: number, ly: number, lw: number, depth = 26): void {
  for (let y = Math.floor(ly); y < ly + depth; y++) {
    if (y < 0 || y >= t.h) continue;
    const shrink = ((y - ly) / depth) * lw * 0.4;
    for (let x = Math.floor(lx - lw / 2 + shrink); x < lx + lw / 2 - shrink; x++) {
      if (x >= 0 && x < t.w) t.data[y * t.w + x] = 1;
    }
  }
}

/** Fills a cone of rock: a stalactite (pointing down) or a stalagmite (up). */
function spike(t: Terrain, x0: number, base: number, width: number, length: number, down: boolean): void {
  for (let k = 0; k < length; k++) {
    const half = (width / 2) * (1 - k / length);
    const y = Math.floor(down ? base + k : base - k);
    if (y < 0 || y >= t.h) continue;
    for (let x = Math.floor(x0 - half); x <= x0 + half; x++) if (x >= 0 && x < t.w) t.data[y * t.w + x] = 1;
  }
}

function island(w: number, h: number, waterY: number, rng: Rng): Terrain {
  const waves = makeWaves(rng);
  const base = h * 0.55;
  // Each coast: how much open sea before it, how long the slope down is, beach or cliff.
  const coast = () => ({
    sea: rng.range(0.04, 0.08) * w,
    len: rng.range(0.07, 0.15) * w,
    cliff: rng.range(0, 1),
    phase: rng.range(0, 6.283),
  });
  const coasts = [coast(), coast()];
  const seabed = waterY + 60;
  const heights = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let y = waveAt(waves, x, base);
    const c = x < w / 2 ? coasts[0] : coasts[1];
    const d = Math.min(x, w - 1 - x) - c.sea;
    if (d <= 0) {
      y = seabed;
    } else if (d < c.len) {
      const t = d / c.len;
      // Rocky bumps on the slope, fading out inland.
      const rocks = (dsin(x * 0.045 + c.phase) * 6 + dsin(x * 0.13 + c.phase) * 3) * (1 - t);
      y = seabed + (y - seabed) * shore(t, c.cliff) + rocks;
    }
    heights[x] = y;
  }
  const t = fromHeights(w, h, heights);
  // Counts scale with the map's width (tuned on a 1280 px wide one).
  const per = w / 1280;
  carveCaves(t, rng, Math.round(rng.int(3, 6) * per), h * 0.62, waterY - 40);
  const ledges = Math.round(rng.int(1, 3) * per);
  for (let i = 0; i < ledges; i++) ledge(t, rng.range(w * 0.2, w * 0.8), rng.range(h * 0.2, h * 0.35), rng.range(60, 120));
  t.version++;
  return t;
}

/** Three or four islands with sea between them; small ledges over the gaps help to cross. */
function islands(w: number, h: number, waterY: number, rng: Rng): Terrain {
  const waves = makeWaves(rng, 0.8);
  const count = rng.int(3, 5);
  const seabed = waterY + 60;
  const left = w * 0.05;
  const span = w * 0.9;
  const gaps = Array.from({ length: count - 1 }, () => rng.range(110, 210));
  const weights = Array.from({ length: count }, () => rng.range(0.75, 1.25));
  const land = span - gaps.reduce((a, b) => a + b, 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  const isles: { x0: number; x1: number; lift: number; len: number; cliff: number }[] = [];
  let x = left;
  for (let i = 0; i < count; i++) {
    const width = (land * weights[i]) / sum;
    isles.push({
      x0: x,
      x1: x + width,
      lift: rng.range(-70, 40),
      len: Math.min(width * 0.25, rng.range(80, 140)),
      cliff: rng.range(0, 1),
    });
    x += width + (gaps[i] ?? 0);
  }
  const heights = new Float64Array(w).fill(seabed);
  for (const isle of isles) {
    for (let px = Math.max(0, Math.floor(isle.x0)); px < Math.min(w, isle.x1); px++) {
      const d = Math.min(px - isle.x0, isle.x1 - px);
      const y = waveAt(waves, px, h * 0.66 + isle.lift);
      heights[px] = d < isle.len ? seabed + (y - seabed) * shore(d / isle.len, isle.cliff) : y;
    }
  }
  const t = fromHeights(w, h, heights);
  const per = w / 1280;
  carveCaves(t, rng, Math.round(rng.int(2, 4) * per), h * 0.66, waterY - 40);
  // A stepping stone over every stretch of sea, plus a couple up high.
  for (let i = 0; i < count - 1; i++) {
    const gx = (isles[i].x1 + isles[i + 1].x0) / 2;
    ledge(t, gx + rng.range(-20, 20), rng.range(h * 0.4, h * 0.5), rng.range(46, 70), 20);
  }
  for (let i = 0; i < 2; i++) ledge(t, rng.range(w * 0.2, w * 0.8), rng.range(h * 0.18, h * 0.3), rng.range(60, 110));
  t.version++;
  return t;
}

/**
 * A closed cave: rock roof and walls (shots stop at the roof), a bumpy floor with pits down to
 * the water, stalactites, stalagmites and a pillar or two holding the roof up.
 */
function cavern(w: number, h: number, _waterY: number, rng: Rng): Terrain {
  const roofWaves = makeWaves(rng, 0.7);
  const floorWaves = makeWaves(rng, 0.8);
  const data = new Uint8Array(w * h).fill(1);
  const t: Terrain = { w, h, data, version: 0 };
  const wall = rng.range(40, 70);
  // Near the walls the cave closes up in a round end.
  const end = rng.range(140, 220);
  const roof = new Float64Array(w);
  const floor = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const inside = Math.min(x, w - 1 - x) - wall;
    const close = inside <= 0 ? 0 : inside >= end ? 1 : Math.sqrt(smoothstep(inside / end));
    const r = h * 0.15 + waveAt(roofWaves, x);
    const f = h * 0.66 + waveAt(floorWaves, x);
    const mid = (r + f) / 2;
    roof[x] = mid + (r - mid) * close;
    floor[x] = mid + (f - mid) * close;
    for (let y = Math.max(0, Math.ceil(roof[x])); y < Math.min(h, floor[x]); y++) data[y * w + x] = 0;
  }
  // Pits through the floor, down to the water.
  const pits = rng.int(2, 4);
  for (let i = 0; i < pits; i++) {
    const px = rng.range(w * 0.15, w * 0.85);
    const pw = rng.range(50, 90);
    for (let x = Math.floor(px - pw / 2); x < px + pw / 2; x++) {
      const narrow = Math.abs(x - px) / (pw / 2);
      for (let y = Math.floor(floor[x] - 4); y < h; y++) {
        // Slightly funnel-shaped: wider at the top.
        if (narrow < 1 - Math.max(0, y - floor[x]) / 600) data[y * w + x] = 0;
      }
    }
  }
  const per = w / 1280;
  const stalactites = Math.round(rng.int(5, 9) * per);
  for (let i = 0; i < stalactites; i++) {
    const x = Math.floor(rng.range(w * 0.08, w * 0.92));
    spike(t, x, roof[x] - 4, rng.range(26, 56), rng.range(50, 140), true);
  }
  const stalagmites = Math.round(rng.int(2, 5) * per);
  for (let i = 0; i < stalagmites; i++) {
    const x = Math.floor(rng.range(w * 0.1, w * 0.9));
    spike(t, x, floor[x] + 4, rng.range(30, 60), rng.range(30, 80), false);
  }
  // Pillars: roof to floor, narrow in the middle.
  const pillars = rng.int(1, 3);
  for (let i = 0; i < pillars; i++) {
    const px = rng.range(w * 0.25, w * 0.75);
    const pw = rng.range(40, 70);
    const top = roof[Math.floor(px)];
    const bottom = floor[Math.floor(px)];
    for (let y = Math.floor(top); y < bottom; y++) {
      const k = (y - top) / (bottom - top);
      const half = (pw / 2) * (0.55 + 0.45 * Math.abs(k * 2 - 1));
      for (let x = Math.floor(px - half); x <= px + half; x++) data[y * w + x] = 1;
    }
  }
  const ledges = Math.round(rng.int(1, 3) * per);
  for (let i = 0; i < ledges; i++) {
    const lx = rng.range(w * 0.2, w * 0.8);
    const lxi = Math.floor(lx);
    ledge(t, lx, roof[lxi] + (floor[lxi] - roof[lxi]) * rng.range(0.35, 0.6), rng.range(60, 110));
  }
  t.version++;
  return t;
}

/** Two high cliffs with a deep gorge between them, crossed by a thin rock arch. */
function canyon(w: number, h: number, waterY: number, rng: Rng): Terrain {
  const waves = makeWaves(rng, 0.6);
  const seabed = waterY + 60;
  const base = h * 0.4;
  const coast = () => ({ sea: rng.range(0.04, 0.07) * w, len: rng.range(0.06, 0.1) * w, cliff: rng.range(0.4, 1) });
  const coasts = [coast(), coast()];
  const gx = w * rng.range(0.44, 0.56);
  const half = rng.range(110, 180);
  const wallW = rng.range(30, 70);
  // The two sides are not the same height.
  const sideLift = [rng.range(-40, 40), rng.range(-40, 40)];
  const heights = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const side = x < gx ? 0 : 1;
    let y = base + sideLift[side] + waveAt(waves, x);
    const c = coasts[side];
    const d = Math.min(x, w - 1 - x) - c.sea;
    if (d <= 0) y = seabed;
    else if (d < c.len) y = seabed + (y - seabed) * shore(d / c.len, c.cliff);
    const g = Math.abs(x - gx);
    if (g < half) y = seabed;
    else if (g < half + wallW) y = seabed + (y - seabed) * smoothstep((g - half) / wallW);
    heights[x] = y;
  }
  const t = fromHeights(w, h, heights);
  // The arch: highest in the middle, joining both walls below their tops.
  const span = half + wallW + 10;
  const archTop = base + rng.range(70, 150);
  const thick = rng.range(18, 28);
  for (let x = Math.floor(gx - span); x < gx + span; x++) {
    const k = (x - gx) / span;
    const top = archTop + k * k * 60;
    for (let y = Math.floor(top); y < top + thick + k * k * 20; y++) t.data[y * w + x] = 1;
  }
  const per = w / 1280;
  carveCaves(t, rng, Math.round(rng.int(3, 6) * per), h * 0.55, waterY - 40);
  // Ledges down in the gorge, under the arch.
  const low = rng.int(1, 3);
  for (let i = 0; i < low; i++) ledge(t, gx + rng.range(-half * 0.6, half * 0.6), rng.range(archTop + 120, waterY - 140), rng.range(50, 80), 20);
  ledge(t, rng.range(w * 0.2, w * 0.8), rng.range(h * 0.12, h * 0.22), rng.range(60, 110));
  t.version++;
  return t;
}
