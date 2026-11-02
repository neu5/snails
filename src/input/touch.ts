import type { Held, KeyboardInput } from './keyboard';

const CSS = `
.touch { position: fixed; z-index: 2; display: flex; gap: 8px; pointer-events: none; }
.touch button {
  pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  width: 56px; height: 56px; border-radius: 50%; border: 2px solid #fff6;
  background: #0007; color: #fff; font: bold 20px system-ui, sans-serif; padding: 0;
}
.touch button.on { background: #fff4; border-color: #fff; }
.touch-pad {
  left: max(10px, env(safe-area-inset-left)); bottom: max(10px, env(safe-area-inset-bottom));
  display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(3, 56px); gap: 2px;
}
.touch-pad [data-c=up] { grid-area: 1 / 2; }
.touch-pad [data-c=left] { grid-area: 2 / 1; }
.touch-pad [data-c=right] { grid-area: 2 / 3; }
.touch-pad [data-c=down] { grid-area: 3 / 2; }
.touch-act {
  right: max(10px, env(safe-area-inset-right)); bottom: max(10px, env(safe-area-inset-bottom));
  align-items: flex-end;
}
.touch-act [data-c=fire] { width: 84px; height: 84px; background: #c4571caa; font-size: 16px; }
.touch-act [data-c=jump] { font-size: 14px; }
.touch-top { top: 6px; left: 50%; transform: translateX(-50%); }
.touch-top button { width: 40px; height: 40px; font-size: 18px; }
`;

const HELD: [Held, string, string][] = [
  ['up', '▲', 'touch-pad'],
  ['left', '◀', 'touch-pad'],
  ['right', '▶', 'touch-pad'],
  ['down', '▼', 'touch-pad'],
  ['jump', 'JUMP', 'touch-act'],
  ['fire', 'FIRE', 'touch-act'],
];

/** Buttons that run a key's action: [key code, label, accessible name]. */
const ACTIONS: [string, string, string][] = [
  ['KeyP', '⟲', 'Replay last move'],
  ['Escape', '⏭', 'Skip replay'],
  ['KeyR', '⟳', 'New map'],
];

/** On-screen buttons for phones. They press the same virtual keys as the keyboard. */
export function addTouchControls(keyboard: KeyboardInput): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const groups = new Map<string, HTMLElement>();
  const group = (cls: string) => {
    let el = groups.get(cls);
    if (!el) {
      el = document.createElement('div');
      el.className = `touch ${cls}`;
      document.body.append(el);
      groups.set(cls, el);
    }
    return el;
  };

  for (const [control, label, cls] of HELD) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.c = control;
    b.setAttribute('aria-label', control);
    const set = (on: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      if (on) b.setPointerCapture(e.pointerId);
      b.classList.toggle('on', on);
      keyboard.setHeld(control, on);
    };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    group(cls).append(b);
  }

  const top = group('touch-top');
  for (const [code, label, name] of ACTIONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => keyboard.trigger(code));
    top.append(b);
  }
  if (document.fullscreenEnabled) {
    const b = document.createElement('button');
    b.textContent = '⛶';
    b.setAttribute('aria-label', 'Full screen');
    b.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else {
        void document.documentElement
          .requestFullscreen()
          .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
          .catch(() => {});
      }
    });
    top.append(b);
  }
}
