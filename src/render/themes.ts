import type { GameConfig } from '../sim/types';

/**
 * How a map looks: ground textures, sky, hills and water. Looks only; the sim never reads it.
 * Every pixel of ground is painted by `ground`, from its position, how deep it is under the
 * surface (0 = the top pixel) and a little per-pixel noise.
 */
export type ThemeId = 'meadow' | 'desert' | 'snow' | 'stone' | 'volcano' | 'jungle';

export interface Theme {
  id: ThemeId;
  name: string;
  /** Sky gradient, top to bottom. */
  sky: [string, string, string];
  hills: string;
  clouds: string;
  /** Water surface (see-through) and the deep part. */
  water: [string, string];
  /** A cavern's back wall, top to bottom, and the rock around the cave. */
  cave: [string, string];
  outside: string;
  /** Packed 0xRRGGBB for a ground pixel. */
  ground(x: number, y: number, depth: number, n: number): number;
}

const rgb = (r: number, g: number, b: number) =>
  (Math.max(0, Math.min(255, r | 0)) << 16) | (Math.max(0, Math.min(255, g | 0)) << 8) | Math.max(0, Math.min(255, b | 0));

/** A stable 0..1 value for a grid cell. */
function cellHash(cx: number, cy: number): number {
  let h = Math.imul(cx, 374761393) + Math.imul(cy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Round pebbles (or crystals, embers...) scattered through the ground: returns 0 outside one,
 * else 1 near its middle and 2 at its rim, so callers can shade it.
 */
function pebble(x: number, y: number, size: number, chance: number): number {
  const cx = Math.floor(x / size);
  const cy = Math.floor(y / size);
  const h = cellHash(cx, cy);
  if (h > chance) return 0;
  const r = 3 + h * (size * 0.2 / chance);
  const px = (cx + 0.3 + 0.4 * cellHash(cy, cx)) * size;
  const py = (cy + 0.3 + 0.4 * h) * size;
  const d2 = (x - px) ** 2 + ((y - py) * 1.3) ** 2;
  if (d2 > r * r) return 0;
  return d2 > (r - 1.5) ** 2 ? 2 : 1;
}

const meadow: Theme = {
  id: 'meadow',
  name: 'Meadow',
  sky: ['#2b2d5c', '#7a5d9e', '#f0a37a'],
  hills: '#3d2f5a',
  clouds: '#ffffff14',
  water: ['#2d6fa8cc', '#1d4f80'],
  cave: ['#120e1a', '#2a1f33'],
  outside: '#76533a',
  ground(x, y, depth, n) {
    if (depth < 4) return rgb(92 + (n & 7), 196, 92);
    if (depth < 7) return rgb(58, 140, 64);
    const p = pebble(x, y, 46, 0.05);
    if (p) return p === 2 ? rgb(95, 85, 75) : rgb(160 + (n & 15), 150, 135);
    const stripe = ((x + y * 2) >> 4) & 1;
    if (((x * 7 + y * 13) & 63) === 0) return rgb(170, 150, 120);
    return rgb(120 + (n & 15) - stripe * 10, 84 + (n & 15) - stripe * 8, 58 + (n & 7));
  },
};

/** Sandstone in wavy layers, a sandy top, the odd bleached stone. */
const SAND = [
  [205, 150, 95],
  [190, 130, 80],
  [218, 172, 112],
  [176, 116, 72],
  [198, 142, 98],
];
const desert: Theme = {
  id: 'desert',
  name: 'Desert',
  sky: ['#3a2a5e', '#e58f5a', '#ffd99a'],
  hills: '#9a5f3e',
  clouds: '#fff3d014',
  water: ['#2aa3a8cc', '#14707a'],
  cave: ['#1f140e', '#3d2818'],
  outside: '#b0784a',
  ground(x, y, depth, n) {
    if (depth < 3) return rgb(240, 214, 150 + (n & 7));
    if (depth < 6) return rgb(222, 186, 120);
    const p = pebble(x, y, 52, 0.04);
    if (p) return p === 2 ? rgb(150, 120, 90) : rgb(235, 225, 205);
    const band = Math.floor((y + 9 * Math.sin(x * 0.011) + 4 * Math.sin(x * 0.037)) / 9);
    const c = SAND[((band % 5) + 5) % 5];
    const grain = (n & 15) - 7;
    return rgb(c[0] + grain, c[1] + grain, c[2] + (grain >> 1));
  },
};

/** Packed snow on top, blue-grey rock with pale ice cracks and crystals below. */
const snow: Theme = {
  id: 'snow',
  name: 'Snow',
  sky: ['#1c2a52', '#6f93c4', '#e3eeff'],
  hills: '#4f6690',
  clouds: '#ffffff22',
  water: ['#6fb6e0cc', '#2e6f9e'],
  cave: ['#0c1424', '#1c2c48'],
  outside: '#6c7f9c',
  ground(x, y, depth, n) {
    if (depth < 5) return rgb(238 + (n & 7), 245, 255);
    if (depth < 8) return rgb(196, 218, 240);
    const p = pebble(x, y, 44, 0.05);
    if (p) return p === 2 ? rgb(150, 205, 240) : rgb(215, 240, 255);
    const crack = Math.abs(Math.sin(x * 0.031 + y * 0.047 + Math.sin(y * 0.02) * 2));
    if (crack < 0.035) return rgb(185, 212, 238);
    return rgb(104 + (n & 15), 122 + (n & 15), 152 + (n & 7));
  },
};

/** Grey cobbles with dark mortar under a thin moss top: good for caves. */
const stone: Theme = {
  id: 'stone',
  name: 'Stone',
  sky: ['#262a38', '#5d6478', '#b8b4c4'],
  hills: '#3a3d4c',
  clouds: '#ffffff12',
  water: ['#3e7f8fcc', '#21505e'],
  cave: ['#101016', '#24232e'],
  outside: '#5a5866',
  ground(x, y, depth, n) {
    if (depth < 3) return rgb(96, 128, 84);
    if (depth < 5) return rgb(72, 96, 68);
    // Rows of uneven stones: each row has its own stone width and offset.
    const row = Math.floor(y / 15);
    const width = 16 + Math.floor(cellHash(row, 7) * 18);
    const off = Math.floor(cellHash(row, 3) * width);
    const col = Math.floor((x + off) / width);
    const lx = (x + off) % width;
    const ly = y % 15;
    const h = cellHash(col, row);
    // Mortar, with a few stones run together.
    if ((lx < 2 && h > 0.15) || ly < 2) return rgb(48, 46, 54);
    const shade = h * 44 - 22 - (ly > 11 ? 12 : 0) + (ly < 4 ? 8 : 0);
    const grain = (n & 15) - 7;
    return rgb(116 + shade + grain, 114 + shade + grain, 124 + shade + grain);
  },
};

/** Dark basalt under ash, with glowing lava veins and ember stones. */
const volcano: Theme = {
  id: 'volcano',
  name: 'Volcano',
  sky: ['#140910', '#4a1416', '#c7462a'],
  hills: '#2a1216',
  clouds: '#30202018',
  water: ['#ff6a1add', '#a3290f'],
  cave: ['#0c0507', '#2a0e0c'],
  outside: '#3a2a2c',
  ground(x, y, depth, n) {
    if (depth < 3) return rgb(96 + (n & 7), 86, 86);
    if (depth < 6) return rgb(64, 56, 58);
    const p = pebble(x, y, 50, 0.04);
    if (p) return p === 2 ? rgb(180, 50, 20) : rgb(255, 150 + (n & 31), 60);
    // Veins wander (sine of a sine) and only run through some patches, so they do not tile.
    const v = Math.abs(Math.sin(x * 0.013 + Math.sin(y * 0.021 + Math.sin(x * 0.007) * 2) * 2.5));
    if (cellHash(x >> 7, y >> 7) < 0.45) {
      if (v < 0.025) return rgb(255, 150 + (n & 31), 50);
      if (v < 0.06) return rgb(160, 52, 24);
    }
    // Basalt with faint cooling cracks.
    const crack = ((x + (y >> 1)) % 31 === 0 || (y + (x >> 2)) % 43 === 0) && cellHash(x >> 4, y >> 4) < 0.5;
    if (crack) return rgb(32, 26, 30);
    return rgb(52 + (n & 15), 44 + (n & 7), 50 + (n & 7));
  },
};

/** Lush moss over dark loam, with wandering roots and stones. */
const jungle: Theme = {
  id: 'jungle',
  name: 'Jungle',
  sky: ['#12302e', '#3f7d63', '#c9e2a0'],
  hills: '#1d4438',
  clouds: '#ffffff12',
  water: ['#3f8f6acc', '#1f5a40'],
  cave: ['#08140e', '#16301f'],
  outside: '#4a3424',
  ground(x, y, depth, n) {
    if (depth < 4) return rgb(70 + (n & 31), 176 + (n & 15), 72);
    if (depth < 8) return (n & 3) === 0 ? rgb(70, 140, 60) : rgb(38, 112, 48);
    const p = pebble(x, y, 48, 0.05);
    if (p) return p === 2 ? rgb(70, 70, 64) : rgb(130 + (n & 15), 130, 118);
    const root = Math.abs(Math.sin(x * 0.045 + y * 0.013 + Math.sin(x * 0.011) * 3));
    if (root < 0.05 && cellHash(x >> 6, y >> 6) < 0.6) return rgb(128, 92, 56);
    return rgb(72 + (n & 15), 50 + (n & 7), 34 + (n & 7));
  },
};

export const THEMES: readonly Theme[] = [meadow, desert, snow, stone, volcano, jungle];

/** What each map kind may look like when the config does not say. */
const FOR_MAP: Record<string, ThemeId[]> = {
  island: ['meadow', 'desert', 'snow', 'jungle', 'volcano'],
  islands: ['meadow', 'jungle', 'snow', 'desert'],
  cavern: ['stone', 'volcano', 'snow'],
  canyon: ['desert', 'volcano', 'meadow', 'snow'],
};

/** The theme a config asks for, or one picked from its seed to suit the map kind. */
export function themeFor(config: Pick<GameConfig, 'seed' | 'map' | 'theme'>): Theme {
  const asked = THEMES.find((t) => t.id === config.theme);
  if (asked) return asked;
  const options = FOR_MAP[config.map ?? 'island'] ?? FOR_MAP.island;
  const id = options[(config.seed >>> 0) % options.length];
  return THEMES.find((t) => t.id === id)!;
}
