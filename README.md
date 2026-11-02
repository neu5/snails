# Snails

A turn-based artillery game for the browser: two teams of snails take turns blasting each
other across a destructible island with bazookas, grenades, guns, uzis, mines and dynamite,
or dig through it with a drill and a blowtorch. Original art (drawn in code) and names.

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
| Enter (J) | Jump forward; press twice quickly for a high back jump |
| 1-8 (or click the icon) | Pick a weapon (see below) |
| Space | Use the weapon (hold and release to charge the bazooka and grenade; press again to stop the drill or blowtorch) |
| P | Replay the last finished move |
| Esc | Skip a replay |
| R | New random map (async: only after the game ends) |

Each turn lasts 30 seconds. After using a weapon the snail gets 3 seconds to walk away.
Explosions carve the terrain, damage snails by distance and knock them back. Falls hurt (and a
painful fall ends your move), and
the water is fatal. The last team with snails left wins.

| Key | Weapon | How it works |
| --- | --- | --- |
| 1 | Bazooka | Charged shot, wind bends it, explodes on impact |
| 2 | Grenade | Charged throw, bounces, no wind, explodes after 3 s |
| 3 | Gun | Two instant shots (25 damage each); you may re-aim between them |
| 4 | Uzi | Burst of ten bullets (5 each), aim while it fires |
| 5 | Mine | Dropped at your feet, arms after 2 s, stays between turns, goes off when a snail comes close |
| 6 | Dynamite | Dropped at your feet, 5 s fuse, the biggest blast |
| 7 | Drill | Digs straight down for 2.5 s, taking the snail with it (into the water, if deep enough); hurts snails in the way (never below 1 HP) |
| 8 | Blowtorch | Cuts a tunnel along the aim (at most 60° up or down) for 3 s, taking the snail with it; burns snails in the way (never below 1 HP); it cannot cut out into open air or start mid-jump: out over a gap the snail falls and keeps cutting; a painful fall stops it and ends the move |

Each team keeps its last weapon between turns. Ammo is unlimited for now.

On a phone, hold it sideways: on-screen buttons appear for walking, aiming, jumping and
firing; tap a weapon icon to pick it. The top row has replay last move, skip replay, new map
and full screen. `?touch=1` shows the buttons on a desktop too.

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
  game.ts    createGame(config) / step(state, input) -> events / hashState(state); weapons
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
