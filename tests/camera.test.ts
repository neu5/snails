import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM } from '../src/render/camera';

const bounds = { x0: -200, y0: -500, x1: 2760, y1: 1080 };
const make = () => new Camera(1280, 720, bounds);

describe('camera', () => {
  it('zoomed all the way out, the whole map and its edges are on screen', () => {
    const c = make();
    c.zoom = 0.01;
    c.clamp();
    expect(c.zoom).toBe(c.fitZoom);
    const v = c.visible();
    expect(v.x0).toBeLessThanOrEqual(bounds.x0 + 1e-6);
    expect(v.x1).toBeGreaterThanOrEqual(bounds.x1 - 1e-6);
    // Taller than needed: the water stays at the bottom of the screen.
    expect(v.y1).toBeCloseTo(bounds.y1);
    expect(v.y0).toBeLessThanOrEqual(bounds.y0);
  });

  it('never looks past the bounds or zooms in too far', () => {
    const c = make();
    c.zoom = 5;
    c.x = -10000;
    c.y = 10000;
    c.clamp();
    expect(c.zoom).toBe(MAX_ZOOM);
    const v = c.visible();
    expect(v.x0).toBeCloseTo(bounds.x0);
    expect(v.y1).toBeCloseTo(bounds.y1);
  });

  it('zooming keeps the point under the cursor in place', () => {
    const c = make();
    c.centerOn(1200, 600);
    const before = c.toWorld(900, 300);
    c.zoomAt(900, 300, 1.3);
    const after = c.toWorld(900, 300);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(c.manual).toBe(true);
  });

  it('dragging moves the world with the finger', () => {
    const c = make();
    c.centerOn(1200, 600);
    c.panBy(100, 0);
    expect(c.x).toBeCloseTo(1100);
  });

  it('follows a target only once it leaves the middle of the view', () => {
    const c = make();
    c.centerOn(1200, 600);
    c.follow(1250, 600);
    expect(c.x).toBe(1200);
    for (let i = 0; i < 200; i++) c.follow(2000, 600);
    const v = c.visible();
    expect(2000).toBeLessThan(v.x1);
    expect(2000).toBeGreaterThan(v.x0);
  });
});
