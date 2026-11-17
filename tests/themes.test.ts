import { describe, expect, it } from 'vitest';
import { THEMES, themeFor } from '../src/render/themes';

describe('map themes', () => {
  it('a config can ask for a theme; otherwise the seed picks one that suits the map', () => {
    expect(themeFor({ seed: 3, theme: 'volcano' }).id).toBe('volcano');
    expect(themeFor({ seed: 3, theme: 'nope' }).id).toBe(themeFor({ seed: 3 }).id);
    const caves = new Set([0, 1, 2, 3, 4, 5].map((seed) => themeFor({ seed, map: 'cavern' }).id));
    expect([...caves].sort()).toEqual(['snow', 'stone', 'volcano']);
    const islands = new Set(Array.from({ length: 20 }, (_, seed) => themeFor({ seed }).id));
    expect(islands.size).toBeGreaterThanOrEqual(4);
  });

  it('every theme paints a top layer different from the ground under it', () => {
    for (const t of THEMES) {
      const top = t.ground(100, 100, 0, 0);
      let differs = 0;
      for (let x = 0; x < 200; x += 7) for (let y = 300; y < 500; y += 11) if (t.ground(x, y, 20, (x * y) & 255) !== top) differs++;
      expect(differs).toBeGreaterThan(400);
      for (let x = 0; x < 50; x++) {
        const c = t.ground(x * 13, x * 17, x % 12, x * 5);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
