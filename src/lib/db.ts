import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres connection pool.
 *
 * Cached on globalThis so Next's dev-mode module reloading doesn't open a new
 * pool on every edit. On Vercel each serverless instance keeps its own small
 * pool, so point DATABASE_URL at a *pooled* connection string (Neon's
 * `-pooler` host, or Supabase's pgBouncer port 6543).
 */
const globalForDb = globalThis as unknown as { __wsPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.'
    );
  }

  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');

  return new Pool({
    connectionString,
    // Hosted Postgres (Neon/Supabase) requires TLS but serves certs that the
    // default CA bundle won't verify from a serverless runtime.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
}

export function getPool(): Pool {
  if (!globalForDb.__wsPool) {
    globalForDb.__wsPool = createPool();
  }
  return globalForDb.__wsPool;
}

/** Run a parameterised query and return all rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Run a query expected to return at most one row. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
