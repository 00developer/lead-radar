// Threads OAuth (docs/architecture.md section 17, decision D-26). Endpoints verified from Meta's docs on 2026-09-30:
//   authorize      https://threads.com/oauth/authorize?client_id&redirect_uri&scope&response_type=code&state
//   short token    POST https://graph.threads.com/oauth/access_token  (client_id, client_secret, code, grant_type=authorization_code, redirect_uri)
//                  -> { access_token, user_id }   (valid 1 hour)
//   long token     GET  https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret&access_token
//                  -> { access_token, token_type, expires_in }   (valid 60 days, server side only)
//   refresh        GET  https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token
//                  (token must be at least 24 hours old and not expired)
//   profile        GET  https://graph.threads.net/v1.0/me?fields=id,username&access_token
// The redirect appends "#_" to the code, which is not part of it and must be removed.
// The hosts (.com and .net) are exactly as written in Meta's docs. Least privilege: only the two scopes below.

import type { Db } from '../db/types';
import { decryptSecret, encryptSecret } from '../crypto';

export const SCOPES = ['threads_basic', 'threads_keyword_search', 'threads_content_publish'];
const AUTHORIZE_URL = 'https://threads.com/oauth/authorize';
const SHORT_TOKEN_URL = 'https://graph.threads.com/oauth/access_token';
const LONG_TOKEN_URL = 'https://graph.threads.net/access_token';
const REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const ME_URL = 'https://graph.threads.net/v1.0/me';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type OAuthConfig = { appId: string; appSecret: string; redirectUri: string; encryptionKey: string | undefined; fetchFn?: FetchLike };

export function buildAuthorizeUrl(cfg: Pick<OAuthConfig, 'appId' | 'redirectUri'>, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

/** Removes the "#_" that Threads appends to the code. */
export function cleanCode(raw: string): string {
  return raw.replace(/#_.*$/, '').trim();
}

function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.replaceAll(s, '[hidden]');
  return out;
}

async function getJson(cfg: OAuthConfig, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } | undefined, what: string, secrets: string[]) {
  const doFetch: FetchLike = cfg.fetchFn ?? ((u, i) => fetch(u, i));
  let res;
  try {
    res = await doFetch(url, init);
  } catch (e) {
    throw new Error(`${what} failed: ${redact(e instanceof Error ? e.message : 'request error', secrets)}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    const msg = (body as { error?: { message?: string }; error_message?: string } | null)?.error?.message ?? (body as { error_message?: string } | null)?.error_message ?? '';
    throw new Error(`${what} failed (HTTP ${res.status})${msg ? `: ${redact(String(msg), secrets)}` : ''}`);
  }
  return body as Record<string, unknown>;
}

export async function exchangeCodeForShortToken(cfg: OAuthConfig, code: string): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: cfg.appId, client_secret: cfg.appSecret, code: cleanCode(code), grant_type: 'authorization_code', redirect_uri: cfg.redirectUri,
  }).toString();
  const j = await getJson(cfg, SHORT_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 'Threads token exchange', [cfg.appSecret, code]);
  if (typeof j.access_token !== 'string' || (typeof j.user_id !== 'string' && typeof j.user_id !== 'number')) throw new Error('Threads token exchange returned an unexpected response.');
  return { accessToken: j.access_token, userId: String(j.user_id) };
}

export async function exchangeForLongLivedToken(cfg: OAuthConfig, shortToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: cfg.appSecret, access_token: shortToken });
  const j = await getJson(cfg, `${LONG_TOKEN_URL}?${q.toString()}`, undefined, 'Threads long-lived token exchange', [cfg.appSecret, shortToken]);
  if (typeof j.access_token !== 'string' || typeof j.expires_in !== 'number') throw new Error('Threads long-lived token exchange returned an unexpected response.');
  return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
}

export async function refreshLongLivedToken(cfg: OAuthConfig, token: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token });
  const j = await getJson(cfg, `${REFRESH_URL}?${q.toString()}`, undefined, 'Threads token refresh', [token, cfg.appSecret]);
  if (typeof j.access_token !== 'string' || typeof j.expires_in !== 'number') throw new Error('Threads token refresh returned an unexpected response.');
  return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
}

export async function fetchThreadsProfile(cfg: OAuthConfig, token: string): Promise<{ id: string; username: string }> {
  const q = new URLSearchParams({ fields: 'id,username', access_token: token });
  const j = await getJson(cfg, `${ME_URL}?${q.toString()}`, undefined, 'Threads profile lookup', [token, cfg.appSecret]);
  if ((typeof j.id !== 'string' && typeof j.id !== 'number') || typeof j.username !== 'string') throw new Error('Threads profile lookup returned an unexpected response.');
  return { id: String(j.id), username: j.username };
}

// ---- stored connection (one per workspace, D-27) ---------------------------------------------------

export type ConnectionInfo = {
  id: string;
  threadsUserId: string;
  username: string;
  status: 'active' | 'needs_reconnect' | 'disconnected';
  scopes: string[];
  tokenExpiresAt: Date | null;
  connectedAt: Date;
  lastError: string | null;
  hasToken: boolean;
};

/** Runs the whole callback: code -> short token -> long-lived token -> profile -> encrypted row. Replaces an existing connection. */
export async function completeConnection(db: Db, workspaceId: string, cfg: OAuthConfig, code: string): Promise<{ username: string }> {
  const short = await exchangeCodeForShortToken(cfg, code);
  const long = await exchangeForLongLivedToken(cfg, short.accessToken);
  const profile = await fetchThreadsProfile(cfg, long.accessToken);
  const encrypted = encryptSecret(long.accessToken, cfg.encryptionKey);
  await db.query(
    `insert into threads_connections (workspace_id, threads_user_id, username, access_token_encrypted, scopes, token_expires_at, status, last_error, connected_at)
     values ($1,$2,$3,$4,$5,$6,'active',null,now())
     on conflict (workspace_id) do update set threads_user_id = excluded.threads_user_id, username = excluded.username,
       access_token_encrypted = excluded.access_token_encrypted, scopes = excluded.scopes, token_expires_at = excluded.token_expires_at,
       status = 'active', last_error = null, connected_at = now()`,
    [workspaceId, profile.id, profile.username, encrypted, SCOPES, long.expiresAt],
  );
  return { username: profile.username };
}

export async function getConnection(db: Db, workspaceId: string): Promise<ConnectionInfo | null> {
  const r = await db.query<{ id: string; threads_user_id: string; username: string; status: ConnectionInfo['status']; scopes: string[]; token_expires_at: Date | null; connected_at: Date; last_error: string | null; has_token: boolean }>(
    'select id, threads_user_id, username, status, scopes, token_expires_at, connected_at, last_error, (access_token_encrypted is not null) as has_token from threads_connections where workspace_id = $1',
    [workspaceId],
  );
  const c = r.rows[0];
  if (!c) return null;
  return { id: c.id, threadsUserId: c.threads_user_id, username: c.username, status: c.status, scopes: c.scopes, tokenExpiresAt: c.token_expires_at, connectedAt: c.connected_at, lastError: c.last_error, hasToken: c.has_token };
}

/** Deletes the stored token (the row stays as "disconnected" so the UI can show it). */
export async function disconnect(db: Db, workspaceId: string): Promise<void> {
  await db.query("update threads_connections set access_token_encrypted = null, status = 'disconnected', token_expires_at = null, last_error = null where workspace_id = $1", [workspaceId]);
}

export async function markNeedsReconnect(db: Db, workspaceId: string, reason: string): Promise<void> {
  await db.query("update threads_connections set status = 'needs_reconnect', last_error = $2 where workspace_id = $1", [workspaceId, reason.slice(0, 300)]);
}

/** Returns the decrypted token of an active connection, or null. Only call this on the server, right before an API call. */
export async function loadActiveToken(db: Db, workspaceId: string, encryptionKey: string | undefined): Promise<{ token: string; username: string } | null> {
  const r = await db.query<{ access_token_encrypted: string | null; username: string; status: string; token_expires_at: Date | null }>(
    'select access_token_encrypted, username, status, token_expires_at from threads_connections where workspace_id = $1',
    [workspaceId],
  );
  const c = r.rows[0];
  if (!c || c.status !== 'active' || !c.access_token_encrypted) return null;
  if (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now()) {
    await markNeedsReconnect(db, workspaceId, 'The access token expired.');
    return null;
  }
  try {
    return { token: decryptSecret(c.access_token_encrypted, encryptionKey), username: c.username };
  } catch (e) {
    await markNeedsReconnect(db, workspaceId, e instanceof Error ? e.message : 'Could not decrypt the token.');
    return null;
  }
}

/** Refreshes a token that expires within 10 days (Threads requires it to be at least 24 hours old). Failures mark the connection. */
export async function refreshIfNeeded(db: Db, workspaceId: string, cfg: OAuthConfig, now: Date = new Date()): Promise<'refreshed' | 'not_needed' | 'failed'> {
  const r = await db.query<{ access_token_encrypted: string | null; token_expires_at: Date | null; connected_at: Date; status: string }>(
    'select access_token_encrypted, token_expires_at, connected_at, status from threads_connections where workspace_id = $1',
    [workspaceId],
  );
  const c = r.rows[0];
  if (!c || c.status !== 'active' || !c.access_token_encrypted || !c.token_expires_at) return 'not_needed';
  const daysLeft = (new Date(c.token_expires_at).getTime() - now.getTime()) / 86_400_000;
  const ageHours = (now.getTime() - new Date(c.connected_at).getTime()) / 3_600_000;
  if (daysLeft > 10 || ageHours < 24) return 'not_needed';
  try {
    const fresh = await refreshLongLivedToken(cfg, decryptSecret(c.access_token_encrypted, cfg.encryptionKey));
    await db.query('update threads_connections set access_token_encrypted = $2, token_expires_at = $3, connected_at = $4 where workspace_id = $1', [
      workspaceId, encryptSecret(fresh.accessToken, cfg.encryptionKey), fresh.expiresAt, now,
    ]);
    return 'refreshed';
  } catch (e) {
    await markNeedsReconnect(db, workspaceId, e instanceof Error ? e.message : 'Token refresh failed.');
    return 'failed';
  }
}
