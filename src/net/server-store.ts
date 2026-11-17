import type { LiveChunk, MatchRecord, TurnRecord } from '../sim/turnlog';
import type { GameConfig } from '../sim/types';
import { connectRoom, type RoomLink } from './live';
import type { MatchStore } from './store';

/**
 * An online room's match on the lobby server. The server creates matches and checks every turn.
 * Besides finished turns, the socket carries who is online and the turn being played right now.
 */
export class ServerMatchStore implements MatchStore {
  private link: RoomLink | null = null;
  /** Called with each piece of someone else's turn in progress. */
  onLive: (chunk: LiveChunk) => void = () => {};
  /** Called with the game teams whose player has the room open. */
  onPresence: (teams: number[]) => void = () => {};
  /** Called after the socket (re)connects. */
  onConnect: () => void = () => {};

  constructor(
    private roomId: string,
    private token: string,
  ) {}

  private url(path = ''): string {
    return `/api/rooms/${encodeURIComponent(this.roomId)}${path}`;
  }

  async load(): Promise<MatchRecord | null> {
    const res = await fetch(this.url('/match'));
    if (!res.ok) return null;
    return (await res.json()) as MatchRecord;
  }

  async create(_id: string, _config: GameConfig): Promise<MatchRecord> {
    throw new Error('online matches are started from the lobby');
  }

  async appendTurn(_id: string, turn: TurnRecord): Promise<void> {
    const res = await fetch(this.url('/turns'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(turn),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  }

  /** Streams a piece of our own turn to whoever is watching. */
  sendLive(chunk: LiveChunk): void {
    this.link?.send({ type: 'live', chunk });
  }

  watch(_id: string, onChange: (match: MatchRecord | null) => void): () => void {
    this.link = connectRoom(
      this.roomId,
      this.token,
      (e) => {
        if (e.type === 'live') this.onLive(e.chunk);
        else if (e.type === 'presence') this.onPresence(e.teams);
        else void this.load().then((m) => m && onChange(m));
      },
      () => this.onConnect(),
    );
    return () => this.link?.stop();
  }
}
