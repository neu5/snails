# Snails

A turn-based artillery game for the browser: two teams of snails take turns blasting each
other across a destructible island with bazookas, grenades, cluster bombs, guns, uzis, punches, mines and dynamite,
or dig through it with a drill and a blowtorch, or swing across it on a rope. Original art (drawn in code) and names.

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
| Move the mouse to the right edge (or click the weapon box, or right-click) | Slide out the weapon drawer, then click a weapon (see below) |
| Space | Use the weapon (hold and release to charge the bazooka and grenade; press again to stop the drill or blowtorch) |
| P | Replay the last finished move |
| M | Whole map on screen (press again to go back) |
| Drag / mouse wheel | Look around the map / zoom (two-finger pinch on a phone) |
| C | Camera back on the action |
| N | Sound: music and effects, effects only, or off (remembered) |
| Esc | Skip a replay |
| R | New random map (async: only after the game ends) |

Each turn lasts 30 seconds. After using a weapon the snail gets 3 seconds to walk away.
Explosions carve the terrain, damage snails by distance and knock them back. Falls hurt (and a
painful fall ends your move), and
the water is fatal. The last team with snails left wins.

| Weapon | How it works |
| --- | --- |
| Bazooka | Charged shot, wind bends it, explodes on impact |
| Grenade | Charged throw, bounces, no wind, explodes after 3 s |
| Cluster | Like the grenade, but bursts into five bomblets that go off where they land |
| Gun | Two instant shots (25 damage each); you may re-aim between them |
| Uzi | Burst of ten bullets (5 each), aim while it fires |
| Punch | Hits the snail right in front for 30 and sends it flying |
| Poke | Nudges the snail in front; no damage (good for pushing it off a ledge) |
| Kamikaze | Your snail flies along the aim and blows up on the first thing it hits (it does not survive) |
| Mine | Dropped at your feet, arms after 2 s, stays between turns, goes off when a snail comes close |
| Dynamite | Dropped at your feet, 5 s fuse, the biggest blast |
| Drill | Digs straight down for 2.5 s, taking the snail with it (into the water, if deep enough); hurts snails in the way (never below 1 HP) |
| Blowtorch | Cuts a tunnel along the aim (at most 60° up or down) for 3 s, taking the snail with it; burns snails in the way (never below 1 HP); it cannot cut out into open air or start mid-jump: out over a gap the snail falls and keeps cutting; a painful fall stops it and ends the move |
| Platform | Puts a steel platform in front of you along the aim (tilts up to 60°); handy as a bridge or a ramp |
| Rope | Throws a hook along the aim (reach 260 px, about half a second to fly out); see below |
| Parachute | Opens in the air (jump off a ledge, then fire): slow, safe fall, ←/→ steer, wind drifts it; not a shot, the turn goes on |
| Hide | Tuck into the shell and skip your move |

**Rope.** Space shoots the hook; it sticks to the first ground it hits. On the rope, ↑ / ↓
reel in and out, ← / → push the swing, and Space or Enter lets go, keeping the speed. With a
mine or dynamite picked, Enter drops it instead and you keep swinging through the
3 s retreat. Space
again, even in mid-air, shoots a new rope. The rope bends around corners. Roping is not a
shot: the turn goes on, so you can swing somewhere and then pick a weapon. Swing fast into
another snail to knock it away (into the water, or off a cliff for a painful fall).

Each team keeps its last weapon between turns. Ammo is unlimited for now.

On a phone, hold it sideways: on-screen buttons appear for walking, aiming, jumping and
firing; tap the weapon box to slide out the weapon drawer, then tap a weapon. The top row has replay last move, skip replay, new map,
whole map (🗺) and full screen. Drag the map with one finger, pinch to zoom. `?touch=1` shows the buttons on a desktop too.

URL options: `?seed=123` (fixed map), `?hp=60`, `?snails=2` (per team, 1-4),
`?turn=20` (seconds), `?bots=1` (team 2 is a bot) or `?bots=0,1` (bot vs bot).

## Online play

Run the lobby server next to Vite:

```bash
npm run server
```

```bash
npm run dev
```

Open http://localhost:5173/?online (or press O / tap 🌐 in the game) and create a room.

- **Room link:** copy it and send it to the other players. Up to 4 teams can join.
- **Your team:** each player sets a team name, one of 8 colors (colors already taken are greyed
  out), and a name for every snail.
- **Host settings:** the host picks the snails per team and the time per turn, then starts the
  game once 2–4 teams are in.
- **Email (optional):** a player can add an email to hear when it is their move. Nothing is sent
  to it until its owner clicks the confirm link the server emails them; the link works once, for
  24 hours.
- **Taking turns:** the server replays every turn it gets (`applyTurn`) and refuses turns from the
  wrong player or with a wrong state hash. It then tells everyone with the room open, and emails
  the next team if its address is confirmed.

Without `DATABASE_URL` the server uses an in-memory Postgres (PGlite), so rooms are gone on
restart. Without `RESEND_API_KEY`, emails are printed in the server console and listed at
http://localhost:5173/api/dev/outbox. To be two players in one browser, add `&seat=b` to the
second tab's URL.

### Deploying on Render (free)

`render.yaml` describes a free web service. Set these environment variables:

- `DATABASE_URL`: any Postgres. Render's free Postgres is deleted after a while, so a free
  [Neon](https://neon.tech) database is the better fit.
- `PUBLIC_URL`: e.g. `https://snails.onrender.com`; links in emails point here.
- `RESEND_API_KEY` and `MAIL_FROM`: from [Resend](https://resend.com), with a verified sender domain.

Things to know about the free plan:

- **It sleeps.** After about 15 minutes with no visitors the service goes to sleep, and the next
  visit (or confirm-link click) takes about a minute to wake it. Open rooms reconnect on their
  own. Async play is fine with this: the "your move" email is what brings players back.
- **Its disk is wiped** on every deploy and restart, so all data lives in Postgres.

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

`MatchStore` (`src/net/store.ts`) is the seam between the game and where matches live; online
rooms use `ServerMatchStore` (`src/net/server-store.ts`).

## Architecture

```
src/sim/     deterministic simulation (no DOM, no Math.random, no wall-clock time)
  game.ts    createGame(config) / step(state, input) -> events / hashState(state); weapons
  terrain.ts bitmask terrain, generation, carving
  math.ts    seeded RNG + engine-independent sin/cos
  turnlog.ts TurnRecorder / TurnPlayback / applyTurn / rebuild: per-turn input logs
src/net/     MatchStore: memory (hot-seat), localStorage (async between tabs), server (online)
src/lobby/   online lobby page (DOM): rooms, teams, colors, snail names, email
server/      Fastify + Postgres lobby server: rooms, verified emails, turn checking, WebSocket
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
