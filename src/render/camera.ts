/**
 * What part of the world the canvas shows. Presentation only: the sim never sees it.
 * (x, y) is the world point at the middle of the view; zoom is screen px per world px.
 */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MAX_ZOOM = 1.6;

export class Camera {
  x: number;
  y: number;
  zoom = 1;
  /** True while the player looks around by hand; the camera stops following. */
  manual = false;

  constructor(
    readonly viewW: number,
    readonly viewH: number,
    /** The world the camera may look at, map edges plus some sea and sky around them. */
    readonly bounds: Bounds,
  ) {
    this.x = (bounds.x0 + bounds.x1) / 2;
    this.y = (bounds.y0 + bounds.y1) / 2;
  }

  /** The zoom that fits all of `bounds` in the view. */
  get fitZoom(): number {
    const b = this.bounds;
    return Math.min(this.viewW / (b.x1 - b.x0), this.viewH / (b.y1 - b.y0));
  }

  /** Keeps zoom in range and the view inside the bounds (bottom-aligned if it is taller). */
  clamp(): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(this.fitZoom, this.zoom));
    const b = this.bounds;
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    this.x = b.x1 - b.x0 <= hw * 2 ? (b.x0 + b.x1) / 2 : Math.min(b.x1 - hw, Math.max(b.x0 + hw, this.x));
    this.y = b.y1 - b.y0 <= hh * 2 ? b.y1 - hh : Math.min(b.y1 - hh, Math.max(b.y0 + hh, this.y));
  }

  /** World rectangle currently on screen. */
  visible(): Bounds {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.viewW / 2) / this.zoom, this.y + (sy - this.viewH / 2) / this.zoom];
  }

  /** Drags the view by a screen-pixel offset (the world moves with the finger). */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.manual = true;
    this.clamp();
  }

  /** Zooms by `factor`, keeping the world point under (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom *= factor;
    this.clamp();
    this.x = wx - (sx - this.viewW / 2) / this.zoom;
    this.y = wy - (sy - this.viewH / 2) / this.zoom;
    this.manual = true;
    this.clamp();
  }

  /**
   * Eases toward a world point, but only once it leaves the middle part of the view, so
   * walking a few steps does not drag the whole picture along.
   */
  follow(tx: number, ty: number, ease = 0.08): void {
    const v = this.visible();
    const padX = (v.x1 - v.x0) * 0.3;
    const padY = (v.y1 - v.y0) * 0.3;
    let gx = this.x;
    let gy = this.y;
    if (tx < v.x0 + padX) gx = tx + (v.x1 - v.x0) / 2 - padX;
    else if (tx > v.x1 - padX) gx = tx - (v.x1 - v.x0) / 2 + padX;
    if (ty < v.y0 + padY) gy = ty + (v.y1 - v.y0) / 2 - padY;
    else if (ty > v.y1 - padY) gy = ty - (v.y1 - v.y0) / 2 + padY;
    this.x += (gx - this.x) * ease;
    this.y += (gy - this.y) * ease;
    this.clamp();
  }

  /** Jumps straight to a point (new turn, reset). */
  centerOn(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clamp();
  }
}
