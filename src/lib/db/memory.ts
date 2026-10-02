// In-memory Postgres (PGlite) for tests and the network-free dry run. Not used in production.
// It creates a minimal stand-in for the Supabase "auth" schema so the real migration runs unchanged.

import { PGlite } from '@electric-sql/pglite';
import type { Db, QueryResult } from './types';

type Runner = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
};

function wrap(runner: Runner, tx: Db['transaction'], close: () => Promise<void>): Db {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const res = await runner.query(text, params);
      return { rows: res.rows as T[], rowCount: Math.max(res.affectedRows ?? 0, res.rows.length) };
    },
    async exec(sql: string) {
      await runner.exec(sql);
    },
    transaction: tx,
    close,
  };
}

const AUTH_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

export async function createMemoryDb(): Promise<Db> {
  const pglite = new PGlite();
  await pglite.waitReady;
  await pglite.exec(AUTH_STUB);
  const db: Db = wrap(
    pglite as unknown as Runner,
    async (fn) =>
      pglite.transaction(async (t) => {
        const inner: Db = wrap(t as unknown as Runner, async (nested) => nested(inner), async () => {});
        return fn(inner);
      }),
    () => pglite.close(),
  );
  return db;
}
