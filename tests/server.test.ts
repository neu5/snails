import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import { openDb, type Db } from '../server/db';
import { DevMailer } from '../server/mail';
import type { RoomView } from '../src/net/api';
import { TurnRecorder, rebuild, type LiveChunk, type MatchRecord, type TurnRecord } from '../src/sim/turnlog';
import type { RoomEvent } from '../src/net/api';
import { EMPTY_INPUT } from '../src/sim/types';

let db: Db | null = null;
afterEach(async () => {
  await db?.close();
  db = null;
});

async function setup(now = () => new Date()) {
  db = await openDb('');
  const mailer = new DevMailer(false);
  const app = await buildApp({ db, mailer, publicUrl: 'http://test', now });
  const call = async <T = Record<string, unknown>>(method: string, url: string, token?: string, payload?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: payload as Record<string, unknown>,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.statusCode, body: (res.headers['content-type']?.includes('json') ? res.json() : res.body) as T, headers: res.headers };
  };
  return { app, mailer, call };
}

type Call = Awaited<ReturnType<typeof setup>>['call'];

async function room(call: Call, snailsPerTeam = 2) {
  const host = await call<{ roomId: string; token: string }>('POST', '/api/rooms', undefined, { snailsPerTeam, turnSeconds: 10 });
  expect(host.status).toBe(200);
  return host.body;
}

async function join(call: Call, roomId: string) {
  const r = await call<{ token: string }>('POST', `/api/rooms/${roomId}/join`);
  expect(r.status).toBe(200);
  return r.body.token;
}

const linkToken = (text: string) => /token=([\w-]+)/.exec(text)![1];

/** Plays the next turn locally (nobody touches anything) and returns its record. */
function idleTurn(match: MatchRecord): TurnRecord {
  const state = rebuild(match);
  const recorder = new TurnRecorder(state);
  for (let i = 0; i < 60 * 120; i++) {
    const { turn } = recorder.step(EMPTY_INPUT);
    if (turn) return turn;
  }
  throw new Error('turn never ended');
}

describe('lobby server', () => {
  it('creates a room, lets up to 4 teams in and gives each a free color', async () => {
    const { call } = await setup();
    const { roomId, token } = await room(call);
    for (let i = 0; i < 3; i++) await join(call, roomId);
    const full = await call('POST', `/api/rooms/${roomId}/join`);
    expect(full.status).toBe(409);
    const v = await call<RoomView>('GET', `/api/rooms/${roomId}`, token);
    expect(v.body.teams).toHaveLength(4);
    expect(new Set(v.body.teams.map((t) => t.color)).size).toBe(4);
    expect(v.body.teams.every((t) => t.snailNames.length === 2)).toBe(true);
    expect(v.body.you?.isHost).toBe(true);
    // Other players' emails are never sent out.
    expect(JSON.stringify(v.body)).not.toContain('@');
  });

  it('checks team edits: taken colors, snail count, name length', async () => {
    const { call } = await setup();
    const { roomId, token } = await room(call);
    const other = await join(call, roomId);
    const edit = { teamName: 'Speedy', color: 0, snailNames: ['A', 'B'] };
    expect((await call('PATCH', `/api/rooms/${roomId}/me`, other, edit)).status).toBe(409);
    expect((await call('PATCH', `/api/rooms/${roomId}/me`, other, { ...edit, color: 5, snailNames: ['A'] })).status).toBe(400);
    expect((await call('PATCH', `/api/rooms/${roomId}/me`, other, { ...edit, color: 5, teamName: 'x'.repeat(21) })).status).toBe(400);
    const ok = await call<RoomView>('PATCH', `/api/rooms/${roomId}/me`, other, { ...edit, color: 5 });
    expect(ok.status).toBe(200);
    expect(ok.body.teams[1]).toMatchObject({ name: 'Speedy', color: 5, snailNames: ['A', 'B'] });
    // Without a token you cannot edit anyone.
    expect((await call('PATCH', `/api/rooms/${roomId}/me`, undefined, edit)).status).toBe(401);
    // Only the host changes settings; snail lists follow the new count.
    expect((await call('PATCH', `/api/rooms/${roomId}`, other, { snailsPerTeam: 3 })).status).toBe(403);
    const s = await call<RoomView>('PATCH', `/api/rooms/${roomId}`, token, { snailsPerTeam: 3 });
    expect(s.body.teams[1].snailNames).toEqual(['A', 'B', expect.any(String)]);
  });

  it('verifies an email with a single-use link that expires', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const { call, mailer } = await setup(() => clock);
    const { roomId, token } = await room(call);
    const edit = { teamName: 'Hosts', color: 0, snailNames: ['A', 'B'], email: 'Me@Example.com' };
    await call('PATCH', `/api/rooms/${roomId}/me`, token, edit);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].to).toBe('me@example.com');
    const first = linkToken(mailer.outbox[0].text);
    // Asking again right away is refused; a minute later a new link goes out.
    expect((await call('POST', `/api/rooms/${roomId}/me/verify`, token)).status).toBe(429);
    clock = new Date(clock.getTime() + 61_000);
    expect((await call('POST', `/api/rooms/${roomId}/me/verify`, token)).status).toBe(200);
    const second = linkToken(mailer.outbox[1].text);
    // The newest link wins.
    expect((await call('GET', `/api/verify?token=${first}`)).status).toBe(400);
    const ok = await call('GET', `/api/verify?token=${second}`);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe(`/?room=${roomId}&verified=1`);
    expect((await call('GET', `/api/verify?token=${second}`)).status).toBe(400);
    const v = await call<RoomView>('GET', `/api/rooms/${roomId}`, token);
    expect(v.body.you).toMatchObject({ email: 'me@example.com', verified: true });
    expect(v.body.teams[0].verified).toBe(true);
    // A link older than a day does not work.
    await call('PATCH', `/api/rooms/${roomId}/me`, token, { ...edit, email: 'new@example.com' });
    const late = linkToken(mailer.outbox[2].text);
    clock = new Date(clock.getTime() + 25 * 3600_000);
    expect((await call('GET', `/api/verify?token=${late}`)).status).toBe(400);
  });

  it('starts with 2+ teams and checks every turn by replaying it', async () => {
    const { call, mailer } = await setup();
    const { roomId, token } = await room(call);
    expect((await call('POST', `/api/rooms/${roomId}/start`, token)).status).toBe(409);
    const other = await join(call, roomId);
    expect((await call('POST', `/api/rooms/${roomId}/start`, other)).status).toBe(403);
    // Team 2 verifies an email, so it hears about its move.
    await call('PATCH', `/api/rooms/${roomId}/me`, other, { teamName: 'Others', color: 3, snailNames: ['X', 'Y'], email: 'o@example.com' });
    await call('GET', `/api/verify?token=${linkToken(mailer.outbox[0].text)}`);
    const started = await call<RoomView>('POST', `/api/rooms/${roomId}/start`, token);
    expect(started.body.status).toBe('playing');
    expect((await call('POST', `/api/rooms/${roomId}/join`)).status).toBe(409);

    const match = (await call<MatchRecord>('GET', `/api/rooms/${roomId}/match`)).body;
    expect(match.config.teams?.map((t) => t.name)).toEqual(['Garden Gliders', 'Others']);
    const turn = idleTurn(match);
    // Wrong player, a tampered hash, or a skipped turn number are all refused.
    expect((await call('POST', `/api/rooms/${roomId}/turns`, other, turn)).status).toBe(403);
    expect((await call('POST', `/api/rooms/${roomId}/turns`, token, { ...turn, hash: turn.hash ^ 1 })).status).toBe(422);
    expect((await call('POST', `/api/rooms/${roomId}/turns`, token, { ...turn, turn: 2 })).status).toBe(409);
    expect((await call('POST', `/api/rooms/${roomId}/turns`, token, turn)).status).toBe(200);
    expect((await call('POST', `/api/rooms/${roomId}/turns`, token, turn)).status).toBe(409);
    const yourMove = mailer.outbox.at(-1)!;
    expect(yourMove).toMatchObject({ to: 'o@example.com', subject: 'Snails: your move (Others)' });
    expect(yourMove.text).toContain(`http://test/?room=${roomId}`);

    // Team 2's move goes back to the host, who has no verified email: no mail.
    const sent = mailer.outbox.length;
    match.turns.push(turn);
    expect((await call('POST', `/api/rooms/${roomId}/turns`, other, idleTurn(match))).status).toBe(200);
    expect(mailer.outbox).toHaveLength(sent);
    expect((await call<MatchRecord>('GET', `/api/rooms/${roomId}/match`)).body.turns).toHaveLength(2);
  });

  it('knows who is online and streams the turn in progress to everyone else', async () => {
    const { app, call } = await setup();
    const { roomId, token } = await room(call);
    const other = await join(call, roomId);
    await call('POST', `/api/rooms/${roomId}/start`, token);

    /** A socket that says hello and keeps what the server sends it. */
    const open = async (who: string | null) => {
      const ws = await app.injectWS(`/ws?room=${roomId}`);
      const got: RoomEvent[] = [];
      ws.on('message', (m) => got.push(JSON.parse(String(m)) as RoomEvent));
      ws.send(JSON.stringify({ type: 'hello', token: who }));
      return { ws, got };
    };
    const settle = () => new Promise((r) => setTimeout(r, 150));
    const host = await open(token);
    const b = await open(other);
    await settle();
    const presence = b.got.filter((e) => e.type === 'presence').at(-1);
    expect(presence && presence.type === 'presence' && presence.teams.sort()).toEqual([0, 1]);

    // The host (team 0) plays; chunks go to b, not back to the host.
    const match = (await call<MatchRecord>('GET', `/api/rooms/${roomId}/match`)).body;
    const recorder = new TurnRecorder(rebuild(match));
    const chunks: LiveChunk[] = [];
    let turn: TurnRecord | null = null;
    for (let t = 1; !turn; t++) {
      turn = recorder.step({ ...EMPTY_INPUT, left: t % 90 < 30 }).turn;
      if (!turn && t % 15 === 0) chunks.push(recorder.takeLive()!);
    }
    for (const chunk of chunks.slice(0, 3)) host.ws.send(JSON.stringify({ type: 'live', chunk }));
    // Team 1 cannot stream a move that is not theirs.
    b.ws.send(JSON.stringify({ type: 'live', chunk: chunks[3] }));
    await settle();
    const live = (got: RoomEvent[]) => got.filter((e) => e.type === 'live').map((e) => (e.type === 'live' ? e.chunk : null));
    expect(live(b.got)).toEqual(chunks.slice(0, 3));
    expect(live(host.got)).toEqual([]);

    // Someone opening the room mid-turn gets everything so far in one piece, from tick 0.
    const late = await open(null);
    await settle();
    const caughtUp = live(late.got);
    expect(caughtUp).toHaveLength(1);
    expect(caughtUp[0]).toMatchObject({ turn: 1, from: 0 });

    // Once the turn is stored, the buffer is gone.
    expect((await call('POST', `/api/rooms/${roomId}/turns`, token, turn)).status).toBe(200);
    const after = await open(null);
    await settle();
    expect(live(after.got)).toEqual([]);

    // Leaving shows up as well.
    b.ws.terminate();
    await settle();
    const last = host.got.filter((e) => e.type === 'presence').at(-1);
    expect(last && last.type === 'presence' && last.teams).toEqual([0]);
    for (const s of [host, late, after]) s.ws.terminate();
  });
});
