import fs from 'node:fs';
import pg from 'pg';
import type { Db, QueryResult } from './types';

// Server-side connection to Postgres (Supabase). This connection bypasses Row Level Security,
// so every query in the pipeline must filter by workspace_id explicitly.

type Runner = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

function wrap(runner: Runner, tx: Db['transaction'], close: () => Promise<void>): Db {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const res = await runner.query(text, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await runner.query(sql);
    },
    transaction: tx,
    close,
  };
}

/**
 * TLS follows the connection string (for example `?sslmode=require`) and certificate verification stays on.
 * If Node does not trust the database certificate chain, set DATABASE_SSL_CA_PATH to the CA certificate file
 * that Supabase provides (Project settings, Database, SSL configuration). Do not turn verification off.
 */
export function createPgDb(connectionString: string, caPath?: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    ...(caPath ? { ssl: { ca: fs.readFileSync(caPath, 'utf8') } } : {}),
  });

  return wrap(
    pool,
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const inner: Db = wrap(client, async (nested) => nested(inner), async () => {});
        const out = await fn(inner);
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    () => pool.end(),
  );
}
