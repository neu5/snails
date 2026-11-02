import type { InputFrame } from '../sim/types';

export type Held = Exclude<keyof InputFrame, 'weapon'>;

const BINDINGS: Record<string, Held> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Enter: 'jump',
  KeyJ: 'jump',
  Space: 'fire',
};

/**
 * Tracks held keys and samples them into an InputFrame once per simulation tick. On-screen
 * controls (touch, the weapon menu) feed the same state through setHeld/pickWeapon/trigger.
 */
export class KeyboardInput {
  private held = new Set<Held>();
  /**
   * Presses not yet sampled, per control. A tap shorter than a tick still shows up, and two
   * quick taps (double Enter) show up as two presses with a released tick between them.
   */
  private taps = new Map<Held, number>();
  /** Controls that were on in the last sample. */
  private lastOn = new Set<Held>();
  /** Weapon picked from the menu; kept until sampled once. */
  private weapon = 0;
  private onKey = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const b = BINDINGS[e.code];
      if (b) {
        if (!e.repeat) this.setHeld(b, true);
        e.preventDefault();
      }
      if (!e.repeat) this.onKey.get(e.code)?.();
    });
    target.addEventListener('keyup', (e) => {
      const b = BINDINGS[e.code];
      if (b) this.held.delete(b);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
      this.taps.clear();
    });
  }

  bind(code: string, fn: () => void): void {
    this.onKey.set(code, fn);
  }

  /** Runs the action bound to a key code, as if it was pressed. */
  trigger(code: string): void {
    this.onKey.get(code)?.();
  }

  setHeld(control: Held, on: boolean): void {
    if (on) {
      this.held.add(control);
      // Capped so presses made while nothing samples (replays) do not pile up.
      this.taps.set(control, Math.min(2, (this.taps.get(control) ?? 0) + 1));
    } else {
      this.held.delete(control);
    }
  }

  /** Selects a weapon (1-based index into WEAPONS) on the next tick. */
  pickWeapon(n: number): void {
    this.weapon = n;
  }

  sample(): InputFrame {
    const on = (c: Held): boolean => {
      const n = this.taps.get(c) ?? 0;
      let out = this.held.has(c);
      if (n > 0) {
        // A new press right after one still on: let it go for a tick first, so it counts.
        out = !this.lastOn.has(c);
        if (out) this.taps.set(c, n - 1);
      }
      if (out) this.lastOn.add(c);
      else this.lastOn.delete(c);
      return out;
    };
    const frame: InputFrame = {
      left: on('left'),
      right: on('right'),
      up: on('up'),
      down: on('down'),
      jump: on('jump'),
      fire: on('fire'),
      weapon: this.weapon,
    };
    this.weapon = 0;
    return frame;
  }
}
