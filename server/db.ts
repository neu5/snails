/**
 * Postgres access. Production talks to a real server through `pg` (DATABASE_URL); tests and
 * local dev without one use PGlite, a Postgres that runs in memory inside this process.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  host_player_id TEXT,
  status TEXT NOT NULL DEFAULT 'lobby',
  snails_per_team INT NOT NULL,
  start_hp INT NOT NULL,
  turn_seconds INT NOT NULL,
  config_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  seat INT NOT NULL,
  team_index INT,
  team_name TEXT NOT NULL,
  color INT NOT NULL,
  snail_names_json TEXT NOT NULL,
  email TEXT,
  email_verified_at TIMESTAMPTZ,
  verify_hash TEXT,
  verify_expires TIMESTAMPTZ,
  verify_sent_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, seat)
);
CREATE TABLE IF NOT EXISTS turns (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  turn INT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (room_id, turn)
);
`;

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: url,
      // Hosted Postgres (Neon, Render) wants TLS; a local server usually does not.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
    await pool.query(SCHEMA);
    return {
      async query<T>(sql: string, params: unknown[] = []) {
        return (await pool.query(sql, params)).rows as T[];
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite();
  await lite.exec(SCHEMA);
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await lite.query<T>(sql, params)).rows;
    },
    close: () => lite.close(),
  };
}
