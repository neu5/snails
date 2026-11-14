import type { GameConfig } from '../sim/types';

/** default: the usual weapon limits. infinite: every weapon unlimited, for trying things out. */
export type GameMode = 'default' | 'infinite';

export const GAME_MODES: { id: GameMode; name: string; note: string }[] = [
  { id: 'default', name: 'Default', note: 'Weapon limits' },
  { id: 'infinite', name: 'Infinite', note: 'No weapon limits' },
];

export const MAX_SNAILS_PER_TEAM = 4;

/** Starting HP choices in the lobby. */
export const START_HP = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** What a mode changes in the game config (`?mode=` in the URL). */
export function modeConfig(mode: string | null): Partial<GameConfig> {
  return mode === 'infinite' ? { ammo: {} } : {};
}

const STORAGE_KEY = 'snails.testLobby';

const CSS = `
.lobby {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #eee; font: 15px Verdana, Arial, Helvetica, sans-serif; user-select: none;
}
.lobby-card { background: #1b2030; border-radius: 16px; padding: 24px 28px; box-shadow: 0 10px 40px #0008; min-width: 300px; }
.lobby h1 { margin: 0 0 4px; font-size: 22px; }
.lobby .sub { margin: 0 0 18px; color: #9aa3b5; font-size: 12px; }
.lobby h2 { margin: 16px 0 8px; font-size: 13px; color: #c8cfdc; font-weight: normal; }
.lobby .row { display: flex; flex-wrap: wrap; gap: 8px; max-width: 440px; }
.lobby button {
  font: inherit; color: inherit; background: #2a3145; border: 2px solid transparent; border-radius: 10px;
  padding: 10px 14px; cursor: pointer; touch-action: manipulation;
}
.lobby button small { display: block; color: #9aa3b5; font-size: 11px; margin-top: 2px; }
.lobby button.on { border-color: #ff8a3d; background: #343c55; }
.lobby .snails button, .lobby .hp button { width: 48px; font-weight: bold; padding: 10px 0; }
/* Two even rows of five. */
.lobby .hp { max-width: 272px; }
.lobby .start { margin-top: 22px; width: 100%; background: #c4571c; font-weight: bold; font-size: 17px; }
`;

/**
 * Test lobby (`?test=1`): pick snails per team, starting HP and a game mode, then start a hot-seat game
 * with those settings in the URL. Choices are remembered for next time.
 */
export function showTestLobby(): void {
  let choice = { snails: 3, hp: 100, mode: 'default' as GameMode };
  try {
    choice = { ...choice, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    // Defaults.
  }

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'lobby';
  document.body.append(root);

  const start = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // Not remembered; fine.
    }
    const url = new URLSearchParams({ snails: String(choice.snails), hp: String(choice.hp), mode: choice.mode, lobby: 'test' });
    location.search = url.toString();
  };

  const draw = () => {
    root.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'lobby-card';
    card.innerHTML = '<h1>Test game</h1><p class="sub">Hot-seat on this screen. L in the game comes back here.</p>';

    const pick = (title: string, cls: string, items: { label: string; note?: string; on: boolean; set: () => void }[]) => {
      const h = document.createElement('h2');
      h.textContent = title;
      const row = document.createElement('div');
      row.className = `row ${cls}`;
      for (const it of items) {
        const b = document.createElement('button');
        b.className = it.on ? 'on' : '';
        b.textContent = it.label;
        if (it.note) {
          const n = document.createElement('small');
          n.textContent = it.note;
          b.append(n);
        }
        b.addEventListener('click', () => {
          it.set();
          draw();
        });
        row.append(b);
      }
      card.append(h, row);
    };

    pick(
      'Snails per team',
      'snails',
      Array.from({ length: MAX_SNAILS_PER_TEAM }, (_, i) => ({
        label: String(i + 1),
        on: choice.snails === i + 1,
        set: () => (choice.snails = i + 1),
      })),
    );
    pick(
      'Starting HP',
      'hp',
      START_HP.map((hp) => ({ label: String(hp), on: choice.hp === hp, set: () => (choice.hp = hp) })),
    );
    pick(
      'Game',
      'modes',
      GAME_MODES.map((m) => ({ label: m.name, note: m.note, on: choice.mode === m.id, set: () => (choice.mode = m.id) })),
    );

    const go = document.createElement('button');
    go.className = 'start';
    go.textContent = 'Start';
    go.addEventListener('click', start);
    card.append(go);
    root.append(card);
  };

  draw();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') start();
  });
}
