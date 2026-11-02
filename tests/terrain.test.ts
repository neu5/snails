import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, WATER_Y } from '../src/sim/game';
import { Rng } from '../src/sim/math';
import { generateTerrain, isSolid } from '../src/sim/terrain';

/** Top of the ground in a column (MAP_H when there is none). */
function surface(t: ReturnType<typeof generateTerrain>, x: number): number {
  for (let y = 0; y < t.h; y++) if (isSolid(t, x, y)) return y;
  return t.h;
}

describe('terrain', () => {
  for (const seed of [1, 9, 21, 77, 1234]) {
    it(`seed ${seed}: coasts slope into the sea instead of ending in a wall`, () => {
      const t = generateTerrain(MAP_W, MAP_H, WATER_Y, new Rng(seed));
      const tops: number[] = [];
      for (let x = 0; x < t.w; x++) tops.push(surface(t, x));
      // Open sea at both edges of the map.
      for (let x = 0; x < MAP_W * 0.04; x++) {
        expect(tops[x]).toBeGreaterThan(WATER_Y);
        expect(tops[MAP_W - 1 - x]).toBeGreaterThan(WATER_Y);
      }
      // Land in the middle, well above the water.
      expect(tops[MAP_W / 2]).toBeLessThan(WATER_Y - 150);
      // No sheer drop at the coast: neighbouring columns stay close.
      // (Floating ledges start at 20% of the width, so stay short of them.)
      const coast = MAP_W * 0.17;
      for (let x = 1; x < t.w; x++) {
        if (x > coast && x < MAP_W - coast) continue;
        expect(Math.abs(tops[x] - tops[x - 1])).toBeLessThan(60);
      }
    });
  }
});
