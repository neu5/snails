import { advanceProjectile, launchProjectile, activeSnail, POWER_TICKS, SNAIL_R } from '../sim/game';
import { Rng } from '../sim/math';
import { EMPTY_INPUT, type GameState, type InputFrame, type Snail } from '../sim/types';

type Stage =
  | { kind: 'walk'; dir: 1 | -1; ticks: number; jumpAt: number }
  | { kind: 'think' }
  | { kind: 'face'; dir: 1 | -1 }
  | { kind: 'aim'; aim: number; powerTicks: number }
  | { kind: 'charge'; powerTicks: number; held: number }
  | { kind: 'done' };

interface Shot {
  facing: 1 | -1;
  aim: number;
  powerTicks: number;
  score: number;
}

/**
 * A simple bot that produces InputFrames from GameState, exactly like a human would.
 * It searches shots by running the real projectile code against the current terrain.
 */
export class Bot {
  private rng: Rng;
  private turn = -1;
  private stage: Stage = { kind: 'done' };
  private wait = 0;

  constructor(seed: number, private accuracy = 0.75) {
    this.rng = new Rng(seed >>> 0);
  }

  input(state: GameState): InputFrame {
    if (state.phase !== 'aiming') return EMPTY_INPUT;
    const me = activeSnail(state);
    if (!me) return EMPTY_INPUT;
    if (state.turnNumber !== this.turn) {
      this.turn = state.turnNumber;
      this.wait = 40;
      const walk = this.rng.next() < 0.7;
      this.stage = walk
        ? {
            kind: 'walk',
            dir: this.rng.next() < 0.5 ? -1 : 1,
            ticks: this.rng.int(30, 110),
            jumpAt: this.rng.next() < 0.4 ? this.rng.int(10, 30) : -1,
          }
        : { kind: 'think' };
    }
    if (this.wait > 0) {
      this.wait--;
      return EMPTY_INPUT;
    }
    const out: InputFrame = { ...EMPTY_INPUT };
    const st = this.stage;
    switch (st.kind) {
      case 'walk':
        if (!me.grounded) return out;
        st.ticks--;
        if (st.ticks === st.jumpAt) out.jump = true;
        else if (st.dir < 0) out.left = true;
        else out.right = true;
        if (st.ticks <= 0) {
          this.stage = { kind: 'think' };
          this.wait = 20;
        }
        return out;
      case 'think': {
        if (!me.grounded) return out;
        const shot = this.plan(state, me);
        this.stage = shot.facing !== me.facing ? { kind: 'face', dir: shot.facing } : { kind: 'aim', aim: shot.aim, powerTicks: shot.powerTicks };
        if (shot.facing !== me.facing) this.pending = shot;
        return out;
      }
      case 'face': {
        if (me.facing === st.dir) {
          const shot = this.pending!;
          // Re-plan: the turn step moved us slightly.
          const re = this.plan(state, me, shot.facing);
          this.stage = { kind: 'aim', aim: re.aim, powerTicks: re.powerTicks };
          return out;
        }
        if (st.dir < 0) out.left = true;
        else out.right = true;
        return out;
      }
      case 'aim':
        if (me.aim < st.aim) out.up = true;
        else if (me.aim > st.aim) out.down = true;
        else {
          this.stage = { kind: 'charge', powerTicks: st.powerTicks, held: 0 };
          this.wait = 15;
        }
        return out;
      case 'charge':
        if (st.held < st.powerTicks) {
          st.held++;
          out.fire = true;
        } else {
          this.stage = { kind: 'done' };
        }
        return out;
      case 'done':
        return out;
    }
  }

  private pending: Shot | null = null;

  private plan(state: GameState, me: Snail, forceFacing?: 1 | -1): Shot {
    const enemies = state.snails.filter((s) => s.alive && s.team !== me.team);
    const friends = state.snails.filter((s) => s.alive && s.team === me.team);
    let best: Shot = { facing: me.facing, aim: 45, powerTicks: 50, score: -Infinity };
    const facings: (1 | -1)[] = forceFacing ? [forceFacing] : [1, -1];
    for (const facing of facings) {
      const probe: Snail = { ...me, facing };
      for (let aim = -30; aim <= 85; aim += 3) {
        probe.aim = aim;
        for (let pt = 18; pt <= POWER_TICKS; pt += 3) {
          const impact = this.simulate(state, probe, pt / POWER_TICKS);
          if (!impact) continue;
          let score = 0;
          for (const e of enemies) {
            const d = dist(e.x - impact.x, e.y - impact.y);
            score += Math.max(0, 70 - d) * (e.hp > 0 ? 1 : 0.2);
          }
          for (const f of friends) {
            const d = dist(f.x - impact.x, f.y - impact.y);
            if (d < 60) score -= (60 - d) * 2.5;
          }
          let nearest = Infinity;
          for (const e of enemies) nearest = Math.min(nearest, dist(e.x - impact.x, e.y - impact.y));
          score -= nearest * 0.05;
          score += (facing === me.facing ? 0.5 : 0) + this.rng.next() * 0.01;
          if (score > best.score) best = { facing, aim, powerTicks: pt, score };
        }
      }
    }
    if (this.rng.next() > this.accuracy) {
      best.aim += this.rng.int(-4, 5);
      best.powerTicks = Math.max(10, Math.min(POWER_TICKS, best.powerTicks + this.rng.int(-3, 4)));
    }
    return best;
  }

  private simulate(state: GameState, s: Snail, power: number): { x: number; y: number } | null {
    const p = launchProjectile(s, power);
    for (let i = 0; i < 600; i++) {
      const r = advanceProjectile(p, state.terrain, state.snails, state.wind);
      if (r) {
        if (r.type === 'explode') {
          const self = dist(s.x - r.x, s.y - r.y);
          if (self < SNAIL_R * 6) return null;
          return r;
        }
        return null;
      }
    }
    return null;
  }
}

function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}
