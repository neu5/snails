import { Bot } from './ai/bot';
import { KeyboardInput } from './input/keyboard';
import { Renderer } from './render/renderer';
import { TICK_RATE, createGame, step } from './sim/game';
import type { GameConfig, GameState, InputFrame } from './sim/types';

const params = new URLSearchParams(location.search);
const num = (k: string): number | undefined => (params.has(k) ? Number(params.get(k)) : undefined);
/** ?bots=1 makes team 1 a bot, ?bots=0,1 makes both bots (attract/demo mode). */
const botTeams = new Set((params.get('bots') ?? '').split(',').filter(Boolean).map(Number));

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const keyboard = new KeyboardInput();

let state: GameState;
let bots: Map<number, Bot>;

function newGame(seed = num('seed') ?? Math.floor(Math.random() * 1e9)): void {
  const cfg: Partial<GameConfig> = { seed };
  const hp = num('hp');
  const per = num('snails');
  const turn = num('turn');
  if (hp) cfg.startHp = hp;
  if (per) cfg.snailsPerTeam = Math.max(1, Math.min(4, per));
  if (turn) cfg.turnSeconds = turn;
  state = createGame(cfg);
  bots = new Map([...botTeams].map((t) => [t, new Bot(seed * 31 + t)]));
  renderer.reset();
  (window as unknown as { snails: unknown }).snails = { state, newGame };
}

keyboard.bind('KeyR', () => newGame(Math.floor(Math.random() * 1e9)));
newGame();

function inputFor(s: GameState): InputFrame {
  const bot = bots.get(s.activeTeam);
  return bot ? bot.input(s) : keyboard.sample();
}

const dt = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= dt) {
    const events = step(state, inputFor(state));
    renderer.handleEvents(state, events);
    acc -= dt;
  }
  renderer.render(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
