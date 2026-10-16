// Deterministic math helpers. Math.sin/cos are not guaranteed to be bit-identical
// across JS engines, so the simulation uses its own trig built only from + - * /,
// which IEEE-754 does guarantee. Math.sqrt is also correctly rounded per spec.

const PI = 3.141592653589793;
const HALF_PI = PI / 2;

export function dsin(rad: number): number {
  let x = rad % (2 * PI);
  if (x > PI) x -= 2 * PI;
  if (x < -PI) x += 2 * PI;
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 8; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

export function dcos(rad: number): number {
  return dsin(rad + HALF_PI);
}

export function degToRad(deg: number): number {
  return (deg * PI) / 180;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** mulberry32 step. Returns [value in [0,1), nextState]. State is a uint32 kept in GameState. */
export function rngNext(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, s] = rngNext(this.state);
    this.state = s;
    return v;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hiExclusive: number): number {
    return lo + Math.floor((hiExclusive - lo) * this.next());
  }
}
