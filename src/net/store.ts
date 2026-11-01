import type { MatchRecord, TurnRecord } from '../sim/turnlog';
import type { GameConfig } from '../sim/types';

/**
 * Where matches live. Today memory (hot-seat) or localStorage (async between tabs); later
 * a server with the same shape, which should also replay each appended turn to validate it.
 */
export interface MatchStore {
  load(id: string): Promise<MatchRecord | null>;
  /** Starts a fresh match under `id`, replacing any match stored there. */
  create(id: string, config: GameConfig): Promise<MatchRecord>;
  /** Rejects unless `turn` is the next turn of the stored match. */
  appendTurn(id: string, turn: TurnRecord): Promise<void>;
  /** Calls back when someone else changes the match. Returns an unsubscribe function. */
  watch(id: string, onChange: (match: MatchRecord | null) => void): () => void;
}

/** Keeps matches as JSON so callers never share objects with the store. */
abstract class JsonMatchStore implements MatchStore {
  protected abstract read(id: string): string | null;
  protected abstract write(id: string, json: string): void;
  abstract watch(id: string, onChange: (match: MatchRecord | null) => void): () => void;

  async load(id: string): Promise<MatchRecord | null> {
    const json = this.read(id);
    return json ? (JSON.parse(json) as MatchRecord) : null;
  }

  async create(id: string, config: GameConfig): Promise<MatchRecord> {
    const match: MatchRecord = { config: { ...config }, turns: [] };
    this.write(id, JSON.stringify(match));
    return structuredClone(match);
  }

  async appendTurn(id: string, turn: TurnRecord): Promise<void> {
    const match = await this.load(id);
    if (!match) throw new Error(`match ${id} not found`);
    if (turn.turn !== match.turns.length + 1) {
      throw new Error(`match ${id}: got turn ${turn.turn}, expected ${match.turns.length + 1}`);
    }
    match.turns.push(turn);
    this.write(id, JSON.stringify(match));
  }
}

export class MemoryMatchStore extends JsonMatchStore {
  private data = new Map<string, string>();

  protected read(id: string): string | null {
    return this.data.get(id) ?? null;
  }

  protected write(id: string, json: string): void {
    this.data.set(id, json);
  }

  watch(): () => void {
    return () => {};
  }
}

/** Shares matches between tabs of one browser: each tab is a player, `storage` events are the push. */
export class LocalMatchStore extends JsonMatchStore {
  private key(id: string): string {
    return `snails.match.${id}`;
  }

  protected read(id: string): string | null {
    return localStorage.getItem(this.key(id));
  }

  protected write(id: string, json: string): void {
    localStorage.setItem(this.key(id), json);
  }

  watch(id: string, onChange: (match: MatchRecord | null) => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key === this.key(id)) onChange(e.newValue ? (JSON.parse(e.newValue) as MatchRecord) : null);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
