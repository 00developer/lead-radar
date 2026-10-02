// Server-only helpers for route handlers and Server Actions: one shared database pool and the OAuth settings.
// Never import this from a Client Component.

import 'server-only';
import { createPgDb } from '../db/pg';
import type { Db } from '../db/types';
import { parseEnv, requireValue, type Env } from '../env';
import type { OAuthConfig } from '../threads/oauth';

const g = globalThis as unknown as { __leadRadarDb?: Db };

export function serverEnv(): Env {
  return parseEnv(process.env);
}

/** One pool per server process (Next reloads modules in development, so it is kept on globalThis). */
export function getDb(): Db {
  if (!g.__leadRadarDb) {
    const env = serverEnv();
    g.__leadRadarDb = createPgDb(requireValue(env.DATABASE_URL, 'DATABASE_URL'), env.DATABASE_SSL_CA_PATH);
  }
  return g.__leadRadarDb;
}

export function appUrl(): string {
  return (serverEnv().APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function oauthConfig(): OAuthConfig {
  const env = serverEnv();
  return {
    appId: requireValue(env.THREADS_APP_ID, 'THREADS_APP_ID'),
    appSecret: requireValue(env.THREADS_APP_SECRET, 'THREADS_APP_SECRET'),
    redirectUri: env.THREADS_REDIRECT_URI ?? `${appUrl()}/api/threads/callback`,
    encryptionKey: env.ENCRYPTION_KEY,
  };
}
