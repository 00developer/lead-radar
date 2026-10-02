// Minimal database interface. The pipeline talks to this, so the same code runs on Postgres (Supabase)
// and on an in-memory Postgres for tests and dry runs.

export type QueryResult<T> = { rows: T[]; rowCount: number };

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Runs a script with several statements and no parameters (used for migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
