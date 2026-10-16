import { Rng, dsin } from './math';

export interface Terrain {
  w: number;
  h: number;
  /** 1 = solid, 0 = air. Row-major. */
  data: Uint8Array;
  /** Bumped on every modification so renderers can cache. */
  version: number;
}

export function isSolid(t: Terrain, x: number, y: number): boolean {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= t.w || iy >= t.h) return false;
  return t.data[iy * t.w + ix] === 1;
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

export function generateTerrain(w: number, h: number, waterY: number, rng: Rng): Terrain {
  const data = new Uint8Array(w * h);
  const waves: { amp: number; freq: number; phase: number }[] = [];
  for (let i = 0; i < 5; i++) {
    waves.push({
      amp: rng.range(14, 70) / (i + 1),
      freq: rng.range(0.8, 1.6) * (i + 1) * 0.004,
      phase: rng.range(0, 6.283),
    });
  }
  const base = h * 0.55;
  const heights = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let y = base;
    for (const wv of waves) y += wv.amp * dsin(x * wv.freq + wv.phase);
    // Raise the middle a bit and sink the edges so the map reads as an island.
    const edge = Math.min(x, w - 1 - x) / w;
    if (edge < 0.08) y += (0.08 - edge) * 1400;
    heights[x] = y;
  }
  for (let x = 0; x < w; x++) {
    const top = Math.floor(heights[x]);
    for (let y = Math.max(0, top); y < h; y++) data[y * w + x] = 1;
  }
  const t: Terrain = { w, h, data, version: 0 };

  // Caves and pockmarks.
  const caves = rng.int(3, 6);
  for (let i = 0; i < caves; i++) {
    const cx = rng.range(w * 0.15, w * 0.85);
    const cy = rng.range(h * 0.62, waterY - 40);
    const len = rng.int(3, 7);
    let x = cx;
    let y = cy;
    for (let j = 0; j < len; j++) {
      carveCircle(t, x, y, rng.range(18, 34));
      x += rng.range(-30, 30);
      y += rng.range(-14, 14);
    }
  }
  // A couple of floating ledges.
  const ledges = rng.int(1, 3);
  for (let i = 0; i < ledges; i++) {
    const lx = rng.range(w * 0.2, w * 0.8);
    const ly = rng.range(h * 0.2, h * 0.35);
    const lw = rng.range(60, 120);
    for (let y = Math.floor(ly); y < ly + 26; y++) {
      const shrink = ((y - ly) / 26) * lw * 0.4;
      for (let x = Math.floor(lx - lw / 2 + shrink); x < lx + lw / 2 - shrink; x++) {
        if (x >= 0 && x < w) data[y * w + x] = 1;
      }
    }
  }
  t.version++;
  return t;
}
