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
 * that Supabase provides (Project settings, Database, SSL configuration), or DATABASE_SSL_CA to the certificate text itself
 * (needed on Vercel, which has no files). Do not turn verification off.
 */
export type PgTls = { caPath?: string; caPem?: string };

/** The CA certificate to trust, from a file or from an environment variable. Undefined means "use Node's default trust store". */
export function resolveCa(tls: PgTls = {}): string | undefined {
  if (tls.caPem && tls.caPem.trim()) return tls.caPem.replace(/\\n/g, '\n').trim() + '\n';
  if (tls.caPath) return fs.readFileSync(tls.caPath, 'utf8');
  return undefined;
}

export function createPgDb(connectionString: string, tls: PgTls | string = {}, max = 4): Db {
  const ca = resolveCa(typeof tls === 'string' ? { caPath: tls } : tls);
  const pool = new pg.Pool({
    connectionString,
    max,
    ...(ca ? { ssl: { ca } } : {}),
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
