import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import {
  SNAIL_NAME_MAX,
  TEAM_NAME_MAX,
  type RoomEvent,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
  type TeamEdit,
  type TeamView,
} from '../src/net/api';
import { DEFAULT_CONFIG, DEFAULT_SNAIL_NAMES, defaultTeams } from '../src/sim/game';
import { DesyncError, applyTurn, rebuild, type MatchRecord, type TurnRecord } from '../src/sim/turnlog';
import { MAX_SNAILS_PER_TEAM, MAX_TEAMS, TEAM_COLOR_COUNT, type GameConfig, type GameState } from '../src/sim/types';
import type { Db } from './db';
import type { Mailer } from './mail';

export interface AppOptions {
  db: Db;
  mailer: Mailer;
  /** Base for links in emails, e.g. https://snails.onrender.com. */
  publicUrl: string;
  /** Exposes GET /api/dev/outbox (DevMailer only). */
  dev?: boolean;
  /** Built client (dist/) to serve, in production. */
  staticDir?: string;
  /** For tests: what "now" is. */
  now?: () => Date;
}

interface RoomRow {
  id: string;
  host_player_id: string | null;
  status: RoomStatus;
  snails_per_team: number;
  start_hp: number;
  turn_seconds: number;
  config_json: string | null;
}

interface PlayerRow {
  id: string;
  room_id: string;
  seat: number;
  team_index: number | null;
  team_name: string;
  color: number;
  snail_names_json: string;
  email: string | null;
  email_verified_at: Date | null;
  verify_sent_at: Date | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const newRoomId = () => Array.from({ length: 8 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');

function intIn(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `${what} must be ${lo}-${hi}`);
  return v;
}

function cleanName(v: unknown, max: number, what: string): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < 1 || s.length > max) throw new HttpError(400, `${what} must be 1-${max} characters`);
  return s;
}

/** Snail names for a seat, cut or padded with defaults to `count`. */
function fitSnails(names: string[], seat: number, count: number): string[] {
  const defaults = DEFAULT_SNAIL_NAMES[seat % DEFAULT_SNAIL_NAMES.length];
  return Array.from({ length: count }, (_, i) => names[i] ?? defaults[i % defaults.length]);
}

export async function buildApp(opts: AppOptions) {
  const { db, mailer } = opts;
  const now = opts.now ?? (() => new Date());
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  // Live updates: everyone with the room open gets a nudge when it changes.
  const sockets = new Map<string, Set<WebSocket>>();
  function broadcast(roomId: string, event: RoomEvent): void {
    const msg = JSON.stringify(event);
    for (const ws of sockets.get(roomId) ?? []) ws.send(msg);
  }
  app.get('/ws', { websocket: true }, (socket, req) => {
    const roomId = String((req.query as { room?: string }).room ?? '');
    if (!roomId) return socket.close();
    let set = sockets.get(roomId);
    if (!set) sockets.set(roomId, (set = new Set()));
    set.add(socket);
    socket.on('close', () => {
      set!.delete(socket);
      if (set!.size === 0) sockets.delete(roomId);
    });
  });

  // The last rebuilt state per room, so a new turn does not replay the whole match.
  const states = new Map<string, { state: GameState; turns: number }>();

  async function getRoom(id: string): Promise<RoomRow> {
    const [room] = await db.query<RoomRow>('SELECT * FROM rooms WHERE id = $1', [id]);
    if (!room) throw new HttpError(404, 'room not found');
    return room;
  }

  async function players(roomId: string): Promise<PlayerRow[]> {
    return db.query<PlayerRow>('SELECT * FROM players WHERE room_id = $1 ORDER BY seat', [roomId]);
  }

  /** The player behind the request's bearer token in this room, or null. */
  async function viewer(req: FastifyRequest, roomId: string): Promise<PlayerRow | null> {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const [p] = await db.query<PlayerRow>('SELECT * FROM players WHERE token_hash = $1 AND room_id = $2', [sha256(token), roomId]);
    return p ?? null;
  }

  async function me(req: FastifyRequest, roomId: string): Promise<PlayerRow> {
    const p = await viewer(req, roomId);
    if (!p) throw new HttpError(401, 'not in this room');
    return p;
  }

  async function view(roomId: string, req: FastifyRequest): Promise<RoomView> {
    const room = await getRoom(roomId);
    const list = await players(roomId);
    const you = await viewer(req, roomId);
    const teams: TeamView[] = list.map((p) => ({
      playerId: p.id,
      seat: p.seat,
      name: p.team_name,
      color: p.color,
      snailNames: JSON.parse(p.snail_names_json) as string[],
      isHost: p.id === room.host_player_id,
      hasEmail: !!p.email,
      verified: !!p.email_verified_at,
      teamIndex: p.team_index,
    }));
    return {
      id: room.id,
      status: room.status,
      snailsPerTeam: room.snails_per_team,
      startHp: room.start_hp,
      turnSeconds: room.turn_seconds,
      teams,
      you: you && {
        playerId: you.id,
        isHost: you.id === room.host_player_id,
        email: you.email,
        verified: !!you.email_verified_at,
      },
    };
  }

  /** Adds a team for a new player in the first free seat, with a free color and default names. */
  async function seatPlayer(room: RoomRow): Promise<{ id: string; token: string }> {
    const list = await players(room.id);
    if (list.length >= MAX_TEAMS) throw new HttpError(409, `room is full (${MAX_TEAMS} teams)`);
    const seat = list.length === 0 ? 0 : Math.max(...list.map((p) => p.seat)) + 1;
    const taken = new Set(list.map((p) => p.color));
    const color = [...Array(TEAM_COLOR_COUNT).keys()].find((c) => !taken.has(c))!;
    const used = new Set(list.map((p) => p.team_name));
    const name = defaultTeams(MAX_TEAMS).map((t) => t.name).find((n) => !used.has(n)) ?? `Team ${seat + 1}`;
    const id = randomUUID();
    const token = newToken();
    await db.query(
      `INSERT INTO players (id, room_id, token_hash, seat, team_name, color, snail_names_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, room.id, sha256(token), seat, name, color, JSON.stringify(fitSnails([], seat, room.snails_per_team))],
    );
    return { id, token };
  }

  /** Sends (or re-sends) the verify link for a player's email. */
  async function sendVerify(p: PlayerRow, email: string): Promise<void> {
    const token = newToken();
    const t = now();
    await db.query(
      'UPDATE players SET verify_hash = $1, verify_expires = $2, verify_sent_at = $3 WHERE id = $4',
      [sha256(token), new Date(t.getTime() + VERIFY_TTL_MS), t, p.id],
    );
    const link = `${opts.publicUrl}/api/verify?token=${token}`;
    await mailer.send({
      to: email,
      subject: 'Snails: confirm your email',
      text:
        `Click to confirm this is your email for team "${p.team_name}":\n${link}\n\n` +
        `We will only use it to tell you when it is your move. The link works for 24 hours.\n` +
        `If you did not ask for this, ignore this email.`,
    });
  }

  function lobbyOnly(room: RoomRow): void {
    if (room.status !== 'lobby') throw new HttpError(409, 'the game has already started');
  }

  const handle =
    <T>(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(req, reply);
      } catch (e) {
        if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message });
        if (e instanceof DesyncError) return reply.code(422).send({ error: e.message });
        throw e;
      }
    };
  type P = { Params: { id: string } };
  const rid = (req: FastifyRequest) => (req.params as { id: string }).id;
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  app.post(
    '/api/rooms',
    handle(async (req) => {
      const b = body(req);
      const room: RoomRow = {
        id: newRoomId(),
        host_player_id: null,
        status: 'lobby',
        snails_per_team: intIn(b.snailsPerTeam ?? DEFAULT_CONFIG.snailsPerTeam, 1, MAX_SNAILS_PER_TEAM, 'snails per team'),
        start_hp: intIn(b.startHp ?? DEFAULT_CONFIG.startHp, 25, 200, 'start HP'),
        turn_seconds: intIn(b.turnSeconds ?? DEFAULT_CONFIG.turnSeconds, 10, 90, 'turn seconds'),
        config_json: null,
      };
      await db.query('INSERT INTO rooms (id, status, snails_per_team, start_hp, turn_seconds) VALUES ($1, $2, $3, $4, $5)', [
        room.id,
        room.status,
        room.snails_per_team,
        room.start_hp,
        room.turn_seconds,
      ]);
      const host = await seatPlayer(room);
      await db.query('UPDATE rooms SET host_player_id = $1 WHERE id = $2', [host.id, room.id]);
      return { roomId: room.id, token: host.token, playerId: host.id };
    }),
  );

  app.get<P>('/api/rooms/:id', handle(async (req) => view(rid(req), req)));

  app.post<P>(
    '/api/rooms/:id/join',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      lobbyOnly(room);
      const p = await seatPlayer(room);
      broadcast(room.id, { type: 'room' });
      return { token: p.token, playerId: p.id };
    }),
  );

  app.patch<P>(
    '/api/rooms/:id/me',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      lobbyOnly(room);
      const p = await me(req, room.id);
      const b = body(req) as Partial<TeamEdit>;
      const teamName = cleanName(b.teamName, TEAM_NAME_MAX, 'team name');
      const color = intIn(b.color, 0, TEAM_COLOR_COUNT - 1, 'color');
      const others = (await players(room.id)).filter((o) => o.id !== p.id);
      if (others.some((o) => o.color === color)) throw new HttpError(409, 'that color is taken');
      if (others.some((o) => o.team_name.toLowerCase() === teamName.toLowerCase())) throw new HttpError(409, 'that team name is taken');
      if (!Array.isArray(b.snailNames) || b.snailNames.length !== room.snails_per_team) {
        throw new HttpError(400, `give ${room.snails_per_team} snail names`);
      }
      const snailNames = b.snailNames.map((n, i) => cleanName(n, SNAIL_NAME_MAX, `snail ${i + 1} name`));
      await db.query('UPDATE players SET team_name = $1, color = $2, snail_names_json = $3 WHERE id = $4', [
        teamName,
        color,
        JSON.stringify(snailNames),
        p.id,
      ]);
      if (b.email !== undefined) {
        const email = String(b.email).trim().toLowerCase();
        if (email && (email.length > 254 || !EMAIL_RE.test(email))) throw new HttpError(400, 'that email does not look right');
        if (email !== (p.email ?? '')) {
          // A new address starts unverified, and the old link stops working.
          await db.query(
            'UPDATE players SET email = $1, email_verified_at = NULL, verify_hash = NULL, verify_expires = NULL WHERE id = $2',
            [email || null, p.id],
          );
          if (email) await sendVerify({ ...p, team_name: teamName }, email);
        }
      }
      broadcast(room.id, { type: 'room' });
      return view(room.id, req);
    }),
  );

  app.post<P>(
    '/api/rooms/:id/me/verify',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      const p = await me(req, room.id);
      if (!p.email) throw new HttpError(400, 'add an email first');
      if (p.email_verified_at) return { ok: true, verified: true };
      if (p.verify_sent_at && now().getTime() - new Date(p.verify_sent_at).getTime() < RESEND_GAP_MS) {
        throw new HttpError(429, 'wait a minute before asking again');
      }
      await sendVerify(p, p.email);
      return { ok: true, verified: false };
    }),
  );

  app.get(
    '/api/verify',
    handle(async (req, reply) => {
      const token = String((req.query as { token?: string }).token ?? '');
      const [p] = token
        ? await db.query<PlayerRow & { verify_expires: Date }>('SELECT * FROM players WHERE verify_hash = $1', [sha256(token)])
        : [];
      if (!p || new Date(p.verify_expires).getTime() < now().getTime()) {
        return reply
          .code(400)
          .type('text/html')
          .send('<p style="font:16px system-ui">This link has expired or was already used. Ask for a new one in the room.</p>');
      }
      await db.query('UPDATE players SET email_verified_at = $1, verify_hash = NULL, verify_expires = NULL WHERE id = $2', [now(), p.id]);
      broadcast(p.room_id, { type: 'room' });
      return reply.redirect(`/?room=${p.room_id}&verified=1`);
    }),
  );

  app.patch<P>(
    '/api/rooms/:id',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      lobbyOnly(room);
      const p = await me(req, room.id);
      if (p.id !== room.host_player_id) throw new HttpError(403, 'only the host can change the settings');
      const b = body(req) as RoomSettings;
      const snails = b.snailsPerTeam === undefined ? room.snails_per_team : intIn(b.snailsPerTeam, 1, MAX_SNAILS_PER_TEAM, 'snails per team');
      const hp = b.startHp === undefined ? room.start_hp : intIn(b.startHp, 25, 200, 'start HP');
      const secs = b.turnSeconds === undefined ? room.turn_seconds : intIn(b.turnSeconds, 10, 90, 'turn seconds');
      await db.query('UPDATE rooms SET snails_per_team = $1, start_hp = $2, turn_seconds = $3 WHERE id = $4', [snails, hp, secs, room.id]);
      if (snails !== room.snails_per_team) {
        for (const o of await players(room.id)) {
          const names = fitSnails(JSON.parse(o.snail_names_json) as string[], o.seat, snails);
          await db.query('UPDATE players SET snail_names_json = $1 WHERE id = $2', [JSON.stringify(names), o.id]);
        }
      }
      broadcast(room.id, { type: 'room' });
      return view(room.id, req);
    }),
  );

  app.post<P>(
    '/api/rooms/:id/start',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      lobbyOnly(room);
      const p = await me(req, room.id);
      if (p.id !== room.host_player_id) throw new HttpError(403, 'only the host can start');
      const list = await players(room.id);
      if (list.length < 2) throw new HttpError(409, 'need at least 2 teams');
      const config: GameConfig = {
        ...DEFAULT_CONFIG,
        seed: randomInt(1, 2 ** 31),
        snailsPerTeam: room.snails_per_team,
        startHp: room.start_hp,
        turnSeconds: room.turn_seconds,
        teams: list.map((o) => ({ name: o.team_name, color: o.color, snailNames: JSON.parse(o.snail_names_json) as string[] })),
      };
      for (const [i, o] of list.entries()) await db.query('UPDATE players SET team_index = $1 WHERE id = $2', [i, o.id]);
      await db.query("UPDATE rooms SET status = 'playing', config_json = $1 WHERE id = $2 AND status = 'lobby'", [
        JSON.stringify(config),
        room.id,
      ]);
      broadcast(room.id, { type: 'room' });
      return view(room.id, req);
    }),
  );

  async function loadMatch(room: RoomRow): Promise<MatchRecord> {
    if (!room.config_json) throw new HttpError(409, 'the game has not started yet');
    const rows = await db.query<{ record_json: string }>('SELECT record_json FROM turns WHERE room_id = $1 ORDER BY turn', [room.id]);
    return { config: JSON.parse(room.config_json) as GameConfig, turns: rows.map((r) => JSON.parse(r.record_json) as TurnRecord) };
  }

  app.get<P>('/api/rooms/:id/match', handle(async (req) => loadMatch(await getRoom(rid(req)))));

  app.post<P>(
    '/api/rooms/:id/turns',
    handle(async (req) => {
      const room = await getRoom(rid(req));
      if (room.status !== 'playing') throw new HttpError(409, room.status === 'over' ? 'the game is over' : 'the game has not started yet');
      const p = await me(req, room.id);
      const turn = body(req) as unknown as TurnRecord;
      if (!turn || typeof turn.turn !== 'number' || !Array.isArray(turn.frames)) throw new HttpError(400, 'bad turn');
      const match = await loadMatch(room);
      if (turn.turn !== match.turns.length + 1) throw new HttpError(409, `expected turn ${match.turns.length + 1}`);
      if (turn.team !== p.team_index) throw new HttpError(403, 'it is not your team’s move');
      // Replay it on the server's own copy: a turn only counts if it ends where the sender says.
      let cached = states.get(room.id);
      if (!cached || cached.turns !== match.turns.length) cached = { state: rebuild(match), turns: match.turns.length };
      states.delete(room.id);
      applyTurn(cached.state, turn);
      try {
        await db.query('INSERT INTO turns (room_id, turn, record_json) VALUES ($1, $2, $3)', [room.id, turn.turn, JSON.stringify(turn)]);
      } catch {
        throw new HttpError(409, 'someone else sent that turn first');
      }
      states.set(room.id, { state: cached.state, turns: turn.turn });
      const state = cached.state;
      if (state.phase === 'gameover') await db.query("UPDATE rooms SET status = 'over' WHERE id = $1", [room.id]);
      broadcast(room.id, { type: 'turn', turn: turn.turn });
      if (state.phase !== 'gameover') await notifyNext(room, state);
      return { ok: true };
    }),
  );

  /** Emails the team whose move it is now, if its player verified an address. */
  async function notifyNext(room: RoomRow, state: GameState): Promise<void> {
    const [next] = await db.query<PlayerRow>('SELECT * FROM players WHERE room_id = $1 AND team_index = $2', [room.id, state.activeTeam]);
    if (!next?.email || !next.email_verified_at) return;
    const snail = state.snails[state.activeSnailId]?.name ?? 'your snail';
    try {
      await mailer.send({
        to: next.email,
        subject: `Snails: your move (${next.team_name})`,
        text: `It is ${snail}'s turn for ${next.team_name}. Watch the last moves and play yours:\n${opts.publicUrl}/?room=${room.id}`,
      });
    } catch (e) {
      // A failed email must not lose the turn; it is already stored.
      console.error(e);
    }
  }

  if (opts.dev && 'outbox' in mailer) {
    app.get('/api/dev/outbox', async () => (mailer as unknown as { outbox: unknown[] }).outbox);
  }

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
  }

  return app;
}
