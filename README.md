# Snails

A turn-based artillery game for the browser: two teams of snails take turns lobbing
bazooka shells across a destructible island. Original art (drawn in code) and names.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm test           # simulation/determinism tests
```

Requires Node 18+ and npm 9+. If the build fails with
`Cannot find module @rollup/rollup-<platform>` (or a missing `@esbuild/<platform>`), the
installed `node_modules` is stale or came from another machine
([npm/cli#4828](https://github.com/npm/cli/issues/4828)); reinstall cleanly with
`rm -rf node_modules && npm ci`. The lockfile lists the native packages for every platform.

## How to play (hot-seat)

| Key | Action |
| --- | --- |
| ← / → (A / D) | Walk |
| ↑ / ↓ (W / S) | Aim |
| Enter (J) | Jump |
| Space (hold, release) | Charge and fire the bazooka |
| P | Replay the last finished move |
| Esc | Skip a replay |
| R | New random map (async: only after the game ends) |

Each turn lasts 30 seconds. Explosions carve the terrain, damage snails by distance and
knock them back. Falls hurt, and the water is fatal. The last team with snails left wins.

URL options: `?seed=123` (fixed map), `?hp=60`, `?snails=2` (per team, 1-4),
`?turn=20` (seconds), `?bots=1` (team 2 is a bot) or `?bots=0,1` (bot vs bot).

## Async play (local prototype)

Open two tabs on the same match, one per team:

```
http://localhost:5173/?team=0&match=demo
http://localhost:5173/?team=1&match=demo
```

Each tab controls only its team. A finished turn is saved as a `TurnRecord` (run-length
encoded inputs plus the state hash after it) into `localStorage`; the other tab gets a
`storage` event, plays that move back at normal speed and then hands over control. Opening or
reloading a tab replays the moves made since that player last watched. Add `&bots=N` to let a
bot play team N inside that tab (e.g. `?team=0&bots=0` and `?team=1&bots=1` for bot vs bot).

`MatchStore` (`src/net/store.ts`) is the seam for a real backend: swap `LocalMatchStore` for
one that talks to a server, which should run `applyTurn` on each submitted turn to reject
desyncs and cheats.

## Architecture

```
src/sim/     deterministic simulation (no DOM, no Math.random, no wall-clock time)
  game.ts    createGame(config) / step(state, input) -> events / hashState(state)
  terrain.ts bitmask terrain, generation, carving
  math.ts    seeded RNG + engine-independent sin/cos
  turnlog.ts TurnRecorder / TurnPlayback / applyTurn / rebuild: per-turn input logs
src/net/     MatchStore: memory (hot-seat) and localStorage (async between tabs)
src/input/   keyboard -> InputFrame
src/ai/      bot that produces InputFrames from GameState
src/render/  Canvas 2D renderer; reads state, consumes events for particles
src/main.ts  fixed 60 Hz loop: live (record) / replay / waiting modes
```

The simulation advances only via `step(state, InputFrame)` at a fixed tick rate. All
randomness comes from a seeded RNG stored in the state, and trig uses a polynomial
implementation built from IEEE-754 basic operations, so the same seed plus the same input
sequence produces bit-identical results. `hashState` lets peers detect desyncs.

This makes online multiplayer a matter of sending the active player's `InputFrame` per tick
(lockstep) or per-turn input logs; the test suite checks that replaying a recorded input log
reproduces the exact final state.

## Demo recording

With the dev server running, `npm run record-demo` captures a bot-vs-bot match to
`snails-demo.mp4` (needs Google Chrome at `CHROME_PATH` and `ffmpeg`).
