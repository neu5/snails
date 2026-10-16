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

## How to play (hot-seat)

| Key | Action |
| --- | --- |
| ← / → (A / D) | Walk |
| ↑ / ↓ (W / S) | Aim |
| Enter (J) | Jump |
| Space (hold, release) | Charge and fire the bazooka |
| R | New random map |

Each turn lasts 30 seconds. Explosions carve the terrain, damage snails by distance and
knock them back. Falls hurt, and the water is fatal. The last team with snails left wins.

URL options: `?seed=123` (fixed map), `?hp=60`, `?snails=2` (per team, 1-4),
`?turn=20` (seconds), `?bots=1` (team 2 is a bot) or `?bots=0,1` (bot vs bot).

## Architecture

```
src/sim/     deterministic simulation (no DOM, no Math.random, no wall-clock time)
  game.ts    createGame(config) / step(state, input) -> events / hashState(state)
  terrain.ts bitmask terrain, generation, carving
  math.ts    seeded RNG + engine-independent sin/cos
src/input/   keyboard -> InputFrame
src/ai/      bot that produces InputFrames from GameState
src/render/  Canvas 2D renderer; reads state, consumes events for particles
src/main.ts  fixed 60 Hz loop wiring input -> step -> render
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
