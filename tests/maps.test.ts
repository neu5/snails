import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, SNAIL_R, WATER_Y, createGame, step } from '../src/sim/game';
import { Rng } from '../src/sim/math';
import { MAP_STYLES, generateTerrain, isSolid, type MapStyle, type Terrain } from '../src/sim/terrain';
import { EMPTY_INPUT } from '../src/sim/types';

const SEEDS = [1, 9, 21, 77, 1234];
const make = (style: MapStyle, seed: number) => generateTerrain(MAP_W, MAP_H, WATER_Y, new Rng(seed), style);

/** Top of the ground in a column (MAP_H when there is none). */
function surface(t: Terrain, x: number): number {
  for (let y = 0; y < t.h; y++) if (isSolid(t, x, y)) return y;
  return t.h;
}

describe('maps', () => {
  for (const style of MAP_STYLES) {
    it(`${style}: same seed, same map; every snail starts on dry ground`, () => {
      expect(make(style, 5).data).toEqual(make(style, 5).data);
      for (const seed of SEEDS.slice(0, 3)) {
        const state = createGame({ seed, map: style, snailsPerTeam: 4 });
        for (let i = 0; i < 180; i++) step(state, EMPTY_INPUT);
        for (const s of state.snails) {
          expect(s.alive).toBe(true);
          expect(s.y).toBeLessThan(WATER_Y - 60);
          expect(s.grounded).toBe(true);
        }
      }
    });
  }

  it('islands: three or four islands with open sea between them', () => {
    for (const seed of SEEDS) {
      const t = make('islands', seed);
      let groups = 0;
      let land = false;
      for (let x = 0; x < t.w; x++) {
        const dry = surface(t, x) < WATER_Y;
        if (dry && !land) groups++;
        land = dry;
      }
      // Stepping-stone ledges over the sea can add short "groups"; count only wide ones below.
      const wide = [];
      let run = 0;
      for (let x = 0; x <= t.w; x++) {
        const ground = x < t.w && surface(t, x) < WATER_Y && surface(t, x) > MAP_H * 0.35;
        if (ground) run++;
        else {
          if (run > 200) wide.push(run);
          run = 0;
        }
      }
      expect(wide.length).toBeGreaterThanOrEqual(3);
      expect(wide.length).toBeLessThanOrEqual(4);
      expect(groups).toBeGreaterThanOrEqual(3);
      expect(surface(t, 5)).toBeGreaterThan(WATER_Y);
      expect(surface(t, t.w - 5)).toBeGreaterThan(WATER_Y);
    }
  });

  it('cavern: closed roof and walls, room inside, and pits down to the water', () => {
    for (const seed of SEEDS) {
      const t = make('cavern', seed);
      for (let y = 0; y < t.h; y++) {
        expect(isSolid(t, 5, y)).toBe(true);
        expect(isSolid(t, t.w - 6, y)).toBe(true);
      }
      let pitColumns = 0;
      for (let x = 0; x < t.w; x += 4) {
        expect(isSolid(t, x, 2)).toBe(true);
        // An open column all the way from the cave down past the water line is a pit.
        let y = 0;
        while (y < t.h && isSolid(t, x, y)) y++;
        let open = y;
        while (open < t.h && !isSolid(t, x, open)) open++;
        if (open >= WATER_Y + 10) pitColumns++;
      }
      expect(pitColumns).toBeGreaterThan(5);
      // Plenty of open cave across the middle (a pillar may fill a column or two).
      let tallest = 0;
      for (let x = t.w * 0.3; x < t.w * 0.7; x += 50) {
        let air = 0;
        for (let y = 0; y < WATER_Y; y++) if (!isSolid(t, x, y)) air++;
        tallest = Math.max(tallest, air);
      }
      expect(tallest).toBeGreaterThan(300);
    }
  });

  it('canyon: high cliffs, a gorge down to the sea, and an arch across it', () => {
    for (const seed of SEEDS) {
      const t = make('canyon', seed);
      let gorge = -1;
      for (let x = Math.floor(t.w * 0.35); x < t.w * 0.65; x++) {
        // Under the arch the column is open from below the arch down to the water.
        let y = 0;
        while (y < t.h && !isSolid(t, x, y)) y++;
        let below = y;
        while (below < t.h && isSolid(t, x, below)) below++;
        let air = below;
        while (air < t.h && !isSolid(t, x, air)) air++;
        if (y < WATER_Y - 200 && air >= WATER_Y) {
          gorge = x;
          break;
        }
      }
      expect(gorge).toBeGreaterThan(0);
      // Cliffs either side stand well above the island's usual height.
      expect(surface(t, Math.floor(t.w * 0.25))).toBeLessThan(MAP_H * 0.55);
      expect(surface(t, Math.floor(t.w * 0.75))).toBeLessThan(MAP_H * 0.55);
    }
  });

  it('cavern snails start inside the cave, with rock above them', () => {
    const state = createGame({ seed: 9, map: 'cavern' });
    for (let i = 0; i < 120; i++) step(state, EMPTY_INPUT);
    for (const s of state.snails) {
      expect(isSolid(state.terrain, s.x, 1)).toBe(true);
      expect(isSolid(state.terrain, s.x, s.y - SNAIL_R - 2)).toBe(false);
    }
  });
});
