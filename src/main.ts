import { Bot } from './ai/bot';
import { Sound } from './audio/sound';
import { KeyboardInput } from './input/keyboard';
import { addTouchControls } from './input/touch';
import { showLobby } from './lobby/lobby';
import { ServerMatchStore } from './net/server-store';
import { MAX_SNAILS_PER_TEAM, gravesFromUrl, modeConfig, showTestLobby } from './lobby/test-lobby';
import { LocalMatchStore, MemoryMatchStore, type MatchStore } from './net/store';
import { teamColor } from './render/palette';
import { Renderer, VIEW_H, VIEW_W } from './render/renderer';
import { DEFAULT_CONFIG, TICK_RATE, createGame } from './sim/game';
import {
  LiveTurn,
  TurnPlayback,
  TurnRecorder,
  applyTurn,
  rebuild,
  type LiveChunk,
  type MatchRecord,
  type TurnRecord,
} from './sim/turnlog';
import type { GameConfig, GameState } from './sim/types';

const params = new URLSearchParams(location.search);
const num = (k: string): number | undefined => (params.has(k) ? Number(params.get(k)) : undefined);
/** ?bots=1 makes team 1 a bot, ?bots=0,1 makes both bots (attract/demo mode). */
const botTeams = new Set((params.get('bots') ?? '').split(',').filter(Boolean).map(Number));
/**
 * How this page plays. ?room=<id> is an online room (lobby first, then the match on the server).
 * ?team=N plays only team N against a match kept in localStorage (?match=id picks which), so a
 * second tab with the other team is the opponent. Without either, every team is local (hot-seat).
 */
let myTeam = num('team');
let asyncPlay = myTeam !== undefined;
let online = false;
let matchId = params.get('match') ?? 'default';
let store: MatchStore = asyncPlay ? new LocalMatchStore() : new MemoryMatchStore();
const isLocal = (team: number): boolean => !asyncPlay || team === myTeam || botTeams.has(team);

/** ?test=1 shows the test lobby instead of a game. */
const inLobby = params.has('test');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const keyboard = new KeyboardInput();
/** Phones and tablets get on-screen buttons; ?touch=1 forces them on a desktop. */
const touch = params.get('touch') === '1' || matchMedia('(pointer: coarse)').matches;
renderer.touch = touch;

// Grow the HUD when the canvas is drawn small so its text stays readable.
function fitUi(): void {
  renderer.uiScale = Math.min(1.8, Math.max(1, (0.75 * VIEW_W) / (canvas.clientWidth || VIEW_W)));
}
window.addEventListener('resize', fitUi);
fitUi();

/** Pointer position in canvas pixels. */
function canvasPoint(e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) * VIEW_W) / r.width, ((e.clientY - r.top) * VIEW_H) / r.height];
}

// Tapping the weapon box opens the weapon menu, tapping a weapon there picks it. Dragging
// elsewhere looks around the map, two fingers pinch to zoom. Right-click also opens the menu.
const pointers = new Map<number, [number, number]>();
/** Where a press began, until it turns into a drag or a second finger comes down. */
let press: [number, number] | null = null;
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = canvasPoint(e);
  if (e.button !== 0) return;
  const { used, weapon } = renderer.tap(x, y, state);
  if (weapon) keyboard.pickWeapon(weapon);
  if (used) return;
  press = pointers.size === 0 ? [x, y] : null;
  pointers.set(e.pointerId, [x, y]);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  // A mouse at the right edge slides the weapon drawer out.
  if (e.pointerType === 'mouse' && e.buttons === 0) renderer.hover(...canvasPoint(e), state);
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const [x, y] = canvasPoint(e);
  if (press && Math.hypot(x - press[0], y - press[1]) > 10) press = null;
  if (pointers.size === 1) {
    renderer.panBy(x - prev[0], y - prev[1], state);
  } else if (pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
    const before = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
    const after = Math.hypot(x - other[0], y - other[1]);
    if (before > 10) renderer.zoomAt((x + other[0]) / 2, (y + other[1]) / 2, after / before, state);
  }
  pointers.set(e.pointerId, [x, y]);
});
const lift = (e: PointerEvent) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') renderer.hover(null, 0, state);
});
canvas.addEventListener('pointerup', (e) => {
  lift(e);
  // A click on the map (not a drag) picks the homing missile's target.
  if (press && pickingTarget()) {
    const [x, y] = renderer.camera.toWorld(...canvasPoint(e));
    keyboard.pickTarget({ x, y });
  }
  press = null;
});
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  renderer.toggleMenu(state);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [x, y] = canvasPoint(e);
    renderer.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015), state);
  },
  { passive: false },
);
const baseTitle = document.title;

type Mode =
  /** A local player (or bot) drives the sim; finished turns go to the store. */
  | { kind: 'live'; recorder: TurnRecorder }
  /** Stored turns play back at normal speed. `resume` is set when only re-watching (P). */
  | {
      kind: 'replay';
      playback: TurnPlayback;
      queue: TurnRecord[];
      resume: { state: GameState; mode: Mode } | null;
      /** The end of a turn that was being watched live. */
      wasLive?: boolean;
    }
  /**
   * Online: someone else's move while they are still making it, played from a buffer a couple
   * of seconds behind them so it runs smoothly. `stalled` while the buffer refills.
   */
  | { kind: 'watch'; live: LiveTurn; stalled: boolean }
  /** Someone else's move; the sim is frozen until it arrives. */
  | { kind: 'waiting'; error?: string };

let match: MatchRecord;
let state: GameState;
/** Number of match turns applied to the canonical `state` (not to a P re-watch view). */
let applied = 0;
let mode: Mode = { kind: 'waiting' };
let bots = new Map<number, Bot>();

/** Online: our own turn goes out in a chunk this often (ticks)... */
const LIVE_SEND_EVERY = 15;
/** ...and a turn being watched starts once this much of it (2.5 s) is buffered... */
const LIVE_PLAYOUT_TICKS = 150;
/** ...or, after running dry, once this much has come in again. */
const LIVE_REFILL_TICKS = 60;
/** Online only: the socket, and the turn being played elsewhere as it arrives. */
let serverStore: ServerMatchStore | null = null;
let incoming: LiveChunk[] = [];
let incomingTicks = 0;
let liveSendTick = 0;

function configFromUrl(seed: number): Partial<GameConfig> {
  // ?mode=infinite: no weapon limits.
  const cfg: Partial<GameConfig> = { seed, ...modeConfig(params.get('mode')) };
  const hp = num('hp');
  const per = num('snails');
  const turn = num('turn');
  if (hp) cfg.startHp = hp;
  if (per) cfg.snailsPerTeam = Math.max(1, Math.min(MAX_SNAILS_PER_TEAM, per));
  if (turn) cfg.turnSeconds = turn;
  if (params.has('graves')) cfg.graves = gravesFromUrl(params.get('graves'));
  return cfg;
}

// How far this viewer has watched, so a reload does not replay the same moves again.
const seenKey = () => `snails.seen.${matchId}.${myTeam}`;
function getSeen(m: MatchRecord): number {
  if (!asyncPlay) return m.turns.length;
  try {
    const saved = JSON.parse(localStorage.getItem(seenKey()) ?? 'null') as { seed: number; n: number } | null;
    if (saved && saved.seed === m.config.seed && saved.n <= m.turns.length) return saved.n;
  } catch {
    // Fall through to the default.
  }
  // Never watched this match here: show everything since our own last move.
  let i = m.turns.length;
  while (i > 0 && !isLocal(m.turns[i - 1].team)) i--;
  return i;
}
function markApplied(): void {
  applied++;
  if (!asyncPlay) return;
  try {
    localStorage.setItem(seenKey(), JSON.stringify({ seed: match.config.seed, n: applied }));
  } catch {
    // Watching again after a reload is harmless.
  }
}

async function newMatch(seed = num('seed') ?? Math.floor(Math.random() * 1e9)): Promise<void> {
  // Store the full config so every client builds the same map even if defaults change.
  open(await store.create(matchId, { ...DEFAULT_CONFIG, ...configFromUrl(seed) }));
}

function open(m: MatchRecord): void {
  match = m;
  applied = getSeen(m);
  try {
    state = rebuild(m, applied);
  } catch (e) {
    state = createGame(m.config);
    fail(e);
    return;
  }
  bots = new Map([...botTeams].map((t) => [t, new Bot(m.config.seed * 31 + t)]));
  renderer.reset();
  playQueue(m.turns.slice(applied), null);
}

function playQueue(queue: TurnRecord[], resume: { state: GameState; mode: Mode } | null): void {
  const next = queue.shift();
  if (next) {
    try {
      mode = { kind: 'replay', playback: new TurnPlayback(state, next), queue, resume };
    } catch (e) {
      fail(e);
    }
    return;
  }
  if (resume) {
    state = resume.state;
    mode = resume.mode;
    renderer.reset();
    return;
  }
  settle();
}

/** Nothing left to watch: play if the active team is ours, otherwise wait for the move. */
function settle(): void {
  if (state.phase !== 'gameover' && isLocal(state.activeTeam)) {
    mode = { kind: 'live', recorder: new TurnRecorder(state) };
    if (asyncPlay && document.hidden) document.title = `▶ Your move – ${baseTitle}`;
  } else {
    mode = { kind: 'waiting' };
  }
}

function fail(e: unknown): void {
  console.error(e);
  mode = { kind: 'waiting', error: e instanceof Error ? e.message : String(e) };
}

function commit(turn: TurnRecord): void {
  match.turns.push(turn);
  markApplied();
  store.appendTurn(matchId, turn).catch(async (e) => {
    // Another tab moved for the same team first; its version of the match wins.
    console.error(e);
    const m = await store.load(matchId);
    if (m) open(m);
  });
  if (state.phase === 'gameover' || !isLocal(state.activeTeam)) mode = { kind: 'waiting' };
}

/** Jumps to the end of whatever is replaying. */
function skipReplay(): void {
  if (mode.kind !== 'replay') return;
  const { playback, queue, resume } = mode;
  try {
    while (!playback.done) playback.step();
    if (!resume) markApplied();
    for (const t of queue.splice(0)) {
      applyTurn(state, t);
      if (!resume) markApplied();
    }
  } catch (e) {
    fail(e);
    return;
  }
  renderer.reset();
  playQueue([], resume);
}

/** Re-watches the last finished turn, then returns to where we were. */
function watchLastTurn(): void {
  if (mode.kind === 'replay' || applied === 0) return;
  const resume = { state, mode };
  try {
    state = rebuild(match, applied - 1);
  } catch (e) {
    fail(e);
    return;
  }
  renderer.reset();
  playQueue([match.turns[applied - 1]], resume);
}

const watchStore = () =>
  store.watch(matchId, (m) => {
    if (!m) return;
    const known = match.turns.length;
    const samePrefix =
      m.config.seed === match.config.seed &&
      m.turns.length >= known &&
      (known === 0 || m.turns[known - 1].hash === match.turns[known - 1].hash);
    const midTurn = mode.kind === 'live' || (mode.kind === 'replay' && mode.resume?.mode.kind === 'live');
    if (!samePrefix || midTurn) {
      // A new match, or a move we did not expect while it is our turn: start over from the store.
      open(m);
      return;
    }
    const fresh = m.turns.slice(known);
    if (fresh.length === 0) return;
    match = m;
    if (mode.kind === 'replay' && !mode.resume) {
      mode.queue.push(...fresh);
      return;
    }
    if (mode.kind === 'replay' && mode.resume) {
      state = mode.resume.state;
      mode = mode.resume.mode;
      renderer.reset();
    }
    clearIncoming();
    if (mode.kind === 'watch') {
      // Watched live: carry on from where we are with the finished turn, or replay it whole
      // if what we saw does not match it.
      const rest = mode.live.finish(fresh[0]);
      if (rest) {
        mode = { kind: 'replay', playback: rest, queue: fresh.slice(1), resume: null, wasLive: true };
        return;
      }
      state = rebuild(match, applied);
      renderer.reset();
    }
    playQueue(fresh, null);
  });

function clearIncoming(): void {
  incoming = [];
  incomingTicks = 0;
}

/** The turn being watched live, also while re-watching an older one with P. */
function watching(): LiveTurn | null {
  if (mode.kind === 'watch') return mode.live;
  if (mode.kind === 'replay' && mode.resume?.mode.kind === 'watch') return mode.resume.mode.live;
  return null;
}

/** A piece of the turn someone else is playing right now. */
function onLive(chunk: LiveChunk): void {
  if (chunk.from === 0 || chunk.turn !== incoming[0]?.turn) {
    // A new turn, or the same one started over (its player reconnected).
    if (watching()) {
      if (mode.kind === 'replay') mode = mode.resume!.mode;
      state = rebuild(match, applied);
      mode = { kind: 'waiting' };
      renderer.reset();
    }
    clearIncoming();
  }
  if (chunk.from !== incomingTicks) return;
  incoming.push(chunk);
  for (let i = 1; i < chunk.frames.length; i += 2) incomingTicks += chunk.frames[i];
  watching()?.add(chunk);
}

/** Starts watching someone else's turn once enough of it is buffered to play smoothly. */
function maybeWatch(): void {
  if (mode.kind !== 'waiting' || mode.error || !incoming.length || state.phase === 'gameover') return;
  if (incoming[0].turn !== state.turnNumber || isLocal(state.activeTeam) || incomingTicks < LIVE_PLAYOUT_TICKS) return;
  try {
    const live = new LiveTurn(state, incoming[0].turn);
    for (const c of incoming) live.add(c);
    mode = { kind: 'watch', live, stalled: false };
  } catch (e) {
    fail(e);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) document.title = baseTitle;
});

const sound = new Sound(() => ({ x: renderer.camera.x, halfW: VIEW_W / 2 / renderer.camera.zoom }));
const SOUND_LABELS = { all: 'Music and sound on', sfx: 'Music off, sound on', off: 'Sound off' };
keyboard.bind('KeyN', () => renderer.notice(SOUND_LABELS[sound.cycle()]));

keyboard.bind('KeyR', () => {
  // In async play a new map would end the match for the other player too; online, only the
  // lobby makes matches.
  if (online) return;
  if (!asyncPlay || state.phase === 'gameover') void newMatch(Math.floor(Math.random() * 1e9));
});
keyboard.bind('KeyO', () => {
  if (!online) location.href = '/?online';
});
keyboard.bind('KeyP', watchLastTurn);
// Back to the test lobby from a game it started.
keyboard.bind('KeyL', () => {
  if (params.get('lobby') === 'test') location.search = '?test=1';
});
keyboard.bind('KeyM', () => renderer.toggleOverview());
keyboard.bind('KeyC', () => renderer.recenter());
keyboard.bind('Escape', () => {
  if (renderer.menuOpen) renderer.menuOpen = false;
  else skipReplay();
});

function teamName(team: number): string {
  return state.teams[team]?.name ?? `Team ${team + 1}`;
}

function pickingTarget(): boolean {
  if (mode.kind !== 'live' || bots.has(state.activeTeam)) return false;
  return state.phase === 'aiming' && state.shotsFired === 0 && state.teams[state.activeTeam].weapon === 'homing';
}

function statusLine(): Renderer['status'] {
  switch (mode.kind) {
    case 'live':
      if (pickingTarget() && !state.target) return { text: `${touch ? 'Tap' : 'Click'} the map to pick a target`, color: '#fff' };
      return null;
    case 'replay': {
      const t = mode.playback.record;
      if (mode.wasLive) return { text: `${teamName(t.team)} is playing now`, color: teamColor(state, t.team) };
      const what = mode.resume ? `Replay of turn ${t.turn}` : `${teamName(t.team)}'s move (turn ${t.turn})`;
      return { text: `${what}  ·  ${touch ? 'tap ⏭' : 'Esc'} to skip`, color: teamColor(state, t.team) };
    }
    case 'watch': {
      const who = teamName(state.activeTeam);
      return { text: `${who} is playing now${mode.stalled ? '  ·  catching up…' : ''}`, color: teamColor(state, state.activeTeam) };
    }
    case 'waiting':
      if (mode.error) return { text: `Replay failed: ${mode.error}`, color: '#ff6b6b' };
      if (state.phase === 'gameover') return null;
      return { text: `Waiting for ${teamName(state.activeTeam)} to move…`, color: teamColor(state, state.activeTeam) };
  }
}

function tick(): void {
  switch (mode.kind) {
    case 'live': {
      const bot = bots.get(state.activeTeam);
      const { recorder } = mode;
      const { events, turn } = recorder.step(bot ? bot.input(state) : keyboard.sample());
      renderer.handleEvents(state, events);
      sound.handleEvents(state, events);
      // Online: let the others watch this turn as it happens.
      if (serverStore && !turn && ++liveSendTick % LIVE_SEND_EVERY === 0) {
        const chunk = recorder.takeLive();
        if (chunk) serverStore.sendLive(chunk);
      }
      if (turn) commit(turn);
      break;
    }
    case 'watch': {
      const w = mode;
      if (w.live.buffered === 0 || (w.stalled && w.live.buffered < LIVE_REFILL_TICKS)) {
        w.stalled = true;
        break;
      }
      w.stalled = false;
      try {
        const events = w.live.step();
        renderer.handleEvents(state, events);
        sound.handleEvents(state, events);
      } catch (e) {
        fail(e);
      }
      break;
    }
    case 'replay': {
      const { playback, queue, resume } = mode;
      try {
        const events = playback.step();
        renderer.handleEvents(state, events);
        sound.handleEvents(state, events);
      } catch (e) {
        fail(e);
        break;
      }
      if (playback.done) {
        if (!resume) markApplied();
        playQueue(queue, resume);
      }
      break;
    }
    case 'waiting':
      maybeWatch();
      break;
  }
}

const dt = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= dt) {
    tick();
    acc -= dt;
  }
  renderer.status = statusLine();
  renderer.render(state);
  sound.update(state);
  requestAnimationFrame(frame);
}

(window as unknown as { snails: unknown }).snails = {
  get state() {
    return state;
  },
  get match() {
    return match;
  },
  newMatch,
  sound,
};

async function startGame(): Promise<void> {
  document.body.classList.add('playing');
  canvas.hidden = false;
  if (touch) addTouchControls(keyboard);
  fitUi();
  watchStore();
  const saved = asyncPlay ? await store.load(matchId) : null;
  if (saved) open(saved);
  else await newMatch();
  requestAnimationFrame(frame);
}

const roomId = params.get('room');
if (inLobby) {
  canvas.style.display = 'none';
  // The lobby works upright too.
  document.getElementById('rotate')?.remove();
  showTestLobby();
} else if (roomId || params.has('online')) {
  canvas.hidden = true;
  showLobby(document.getElementById('lobby')!, roomId, (seat) => {
    online = true;
    asyncPlay = true;
    myTeam = seat.teamIndex;
    matchId = seat.roomId;
    serverStore = new ServerMatchStore(seat.roomId, seat.token);
    serverStore.onLive = onLive;
    serverStore.onPresence = (teams) => (renderer.online = new Set(teams));
    // Back after a dropped connection: send the turn in progress again from its start.
    serverStore.onConnect = () => {
      if (mode.kind === 'live') mode.recorder.resendLive();
    };
    store = serverStore;
    void startGame();
  });
} else {
  void startGame();
}
