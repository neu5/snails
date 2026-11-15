import type { MatchRecord, TurnRecord } from '../sim/turnlog';
import type { GameConfig } from '../sim/types';
import { listenToRoom } from './live';
import type { MatchStore } from './store';

/** An online room's match on the lobby server. The server creates matches; it also checks every turn. */
export class ServerMatchStore implements MatchStore {
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

  watch(_id: string, onChange: (match: MatchRecord | null) => void): () => void {
    return listenToRoom(this.roomId, () => {
      void this.load().then((m) => m && onChange(m));
    });
  }
}
