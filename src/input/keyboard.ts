import type { InputFrame } from '../sim/types';

const BINDINGS: Record<string, keyof InputFrame> = {
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

/** Tracks held keys and samples them into an InputFrame once per simulation tick. */
export class KeyboardInput {
  private held = new Set<keyof InputFrame>();
  private onKey = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const b = BINDINGS[e.code];
      if (b) {
        this.held.add(b);
        e.preventDefault();
      }
      if (!e.repeat) this.onKey.get(e.code)?.();
    });
    target.addEventListener('keyup', (e) => {
      const b = BINDINGS[e.code];
      if (b) this.held.delete(b);
    });
    target.addEventListener('blur', () => this.held.clear());
  }

  bind(code: string, fn: () => void): void {
    this.onKey.set(code, fn);
  }

  sample(): InputFrame {
    const h = this.held;
    return {
      left: h.has('left'),
      right: h.has('right'),
      up: h.has('up'),
      down: h.has('down'),
      jump: h.has('jump'),
      fire: h.has('fire'),
    };
  }
}
