import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import { decryptSecret, encryptSecret, safeEqual } from '../src/lib/crypto';
import {
  buildAuthorizeUrl, cleanCode, completeConnection, disconnect, getConnection, loadActiveToken, refreshIfNeeded, type FetchLike, type OAuthConfig,
} from '../src/lib/threads/oauth';
import { threadsCollectorForWorkspace, runWorkspacePipeline, type OrchestrateDeps } from '../src/lib/pipeline/orchestrate';
import { createFakeLlm } from '../src/lib/classifier/fake-llm';
import type { Collector, RawPost } from '../src/lib/collectors/types';
import { seedOwnerWorkspace } from '../src/lib/seed';

const KEY = crypto.randomBytes(32).toString('base64');
const OTHER_KEY = crypto.randomBytes(32).toString('base64');
const SECRET = 'APP-SECRET-VALUE';

let db: Db;
let n = 0;
beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterAll(async () => {
  await db.close();
});
const workspace = () => seedOwnerWorkspace(db, `oauth-${++n}`);

type Call = { url: string; method: string; body?: string };
function fakeThreads(opts: { failAt?: 'short' | 'long' | 'me' | 'refresh'; expiresIn?: number } = {}): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const respond = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });
    if (url.startsWith('https://graph.threads.com/oauth/access_token')) return opts.failAt === 'short' ? respond(false, 400, { error: { message: `bad code and ${SECRET}` } }) : respond(true, 200, { access_token: 'SHORT-TOKEN', user_id: 4242 });
    if (url.startsWith('https://graph.threads.net/access_token')) return opts.failAt === 'long' ? respond(false, 400, { error: { message: 'nope' } }) : respond(true, 200, { access_token: 'LONG-TOKEN', token_type: 'bearer', expires_in: opts.expiresIn ?? 5_184_000 });
    if (url.startsWith('https://graph.threads.net/v1.0/me')) return opts.failAt === 'me' ? respond(false, 500, {}) : respond(true, 200, { id: '4242', username: 'company_account' });
    if (url.startsWith('https://graph.threads.net/refresh_access_token')) return opts.failAt === 'refresh' ? respond(false, 400, { error: { message: 'expired' } }) : respond(true, 200, { access_token: 'REFRESHED-TOKEN', token_type: 'bearer', expires_in: 5_184_000 });
    return respond(false, 404, {});
  };
  return { fetchFn, calls };
}
const cfg = (fetchFn: FetchLike, key = KEY): OAuthConfig => ({ appId: 'APP-ID', appSecret: SECRET, redirectUri: 'https://app.example.com/api/threads/callback', encryptionKey: key, fetchFn });

describe('encryption', () => {
  it('round-trips and never repeats the same ciphertext', () => {
    const a = encryptSecret('token-123', KEY);
    const b = encryptSecret('token-123', KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain('token-123');
    expect(decryptSecret(a, KEY)).toBe('token-123');
  });
  it('fails safely with a wrong key or tampered data, without leaking anything', () => {
    const enc = encryptSecret('token-123', KEY);
    expect(() => decryptSecret(enc, OTHER_KEY)).toThrow(/reconnected/);
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow(/reconnected/);
    try {
      decryptSecret(enc, OTHER_KEY);
    } catch (e) {
      expect(String(e)).not.toContain(enc);
    }
  });
  it('requires a 32 byte key', () => {
    expect(() => encryptSecret('x', undefined)).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('authorize url and code', () => {
  it('asks for exactly the two scopes with a state value', () => {
    const u = new URL(buildAuthorizeUrl({ appId: 'APP-ID', redirectUri: 'https://a.example/cb' }, 'STATE1'));
    expect(u.origin + u.pathname).toBe('https://threads.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'APP-ID', redirect_uri: 'https://a.example/cb', scope: 'threads_basic,threads_keyword_search,threads_content_publish', response_type: 'code', state: 'STATE1' });
  });
  it('removes the "#_" suffix Threads adds to the code', () => {
    expect(cleanCode('AQABC123#_')).toBe('AQABC123');
    expect(cleanCode('AQABC123')).toBe('AQABC123');
  });
});

describe('connecting an account', () => {
  it('runs the three calls, stores the token encrypted and shows only safe fields', async () => {
    const ws = await workspace();
    const { fetchFn, calls } = fakeThreads();
    const r = await completeConnection(db, ws, cfg(fetchFn), 'CODE123#_');
    expect(r.username).toBe('company_account');

    expect(calls[0].method).toBe('POST');
    expect(new URLSearchParams(calls[0].body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(calls[0].body).get('code')).toBe('CODE123');
    expect(calls[1].url).toContain('grant_type=th_exchange_token');
    expect(calls[2].url).toContain('/v1.0/me?fields=id%2Cusername');

    const row = (await db.query<{ access_token_encrypted: string; status: string; scopes: string[] }>('select access_token_encrypted, status, scopes from threads_connections where workspace_id = $1', [ws])).rows[0];
    expect(row.access_token_encrypted).not.toContain('LONG-TOKEN');
    expect(decryptSecret(row.access_token_encrypted, KEY)).toBe('LONG-TOKEN');
    expect(row).toMatchObject({ status: 'active', scopes: ['threads_basic', 'threads_keyword_search', 'threads_content_publish'] });

    const info = await getConnection(db, ws);
    expect(info).toMatchObject({ username: 'company_account', status: 'active', hasToken: true });
    expect(JSON.stringify(info)).not.toContain('LONG-TOKEN');
    expect(await loadActiveToken(db, ws, KEY)).toEqual({ token: 'LONG-TOKEN', username: 'company_account' });
  });
  it('connecting again replaces the single connection of the workspace', async () => {
    const ws = await workspace();
    await completeConnection(db, ws, cfg(fakeThreads().fetchFn), 'A');
    await completeConnection(db, ws, cfg(fakeThreads().fetchFn), 'B');
    expect(Number((await db.query<{ n: string }>('select count(*) as n from threads_connections where workspace_id = $1', [ws])).rows[0].n)).toBe(1);
  });
  it.each(['short', 'long', 'me'] as const)('a failure at the %s step saves nothing and hides secrets in the message', async (step) => {
    const ws = await workspace();
    await expect(completeConnection(db, ws, cfg(fakeThreads({ failAt: step }).fetchFn), 'CODE')).rejects.toThrow();
    try {
      await completeConnection(db, ws, cfg(fakeThreads({ failAt: step }).fetchFn), 'CODE');
    } catch (e) {
      expect(String(e)).not.toContain(SECRET);
      expect(String(e)).not.toContain('SHORT-TOKEN');
    }
    expect(await getConnection(db, ws)).toBeNull();
  });
  it('disconnect deletes the stored token', async () => {
    const ws = await workspace();
    await completeConnection(db, ws, cfg(fakeThreads().fetchFn), 'A');
    await disconnect(db, ws);
    const row = (await db.query<{ access_token_encrypted: string | null; status: string }>('select access_token_encrypted, status from threads_connections where workspace_id = $1', [ws])).rows[0];
    expect(row).toEqual({ access_token_encrypted: null, status: 'disconnected' });
    expect(await loadActiveToken(db, ws, KEY)).toBeNull();
  });
  it('an expired token or a wrong key marks the connection as needing a reconnect', async () => {
    const expired = await workspace();
    await completeConnection(db, expired, cfg(fakeThreads().fetchFn), 'A');
    await db.query("update threads_connections set token_expires_at = now() - interval '1 day' where workspace_id = $1", [expired]);
    expect(await loadActiveToken(db, expired, KEY)).toBeNull();
    expect((await getConnection(db, expired))?.status).toBe('needs_reconnect');

    const wrongKey = await workspace();
    await completeConnection(db, wrongKey, cfg(fakeThreads().fetchFn), 'A');
    expect(await loadActiveToken(db, wrongKey, OTHER_KEY)).toBeNull();
    expect((await getConnection(db, wrongKey))?.status).toBe('needs_reconnect');
  });
});

describe('token refresh', () => {
  const now = new Date();
  it('does nothing while the token is fresh or younger than 24 hours', async () => {
    const ws = await workspace();
    const t = fakeThreads();
    await completeConnection(db, ws, cfg(t.fetchFn), 'A');
    expect(await refreshIfNeeded(db, ws, cfg(t.fetchFn), now)).toBe('not_needed');
    await db.query("update threads_connections set token_expires_at = now() + interval '3 days' where workspace_id = $1", [ws]); // due, but issued just now
    expect(await refreshIfNeeded(db, ws, cfg(t.fetchFn), now)).toBe('not_needed');
  });
  it('refreshes a token that expires within 10 days and is at least 24 hours old', async () => {
    const ws = await workspace();
    const t = fakeThreads();
    await completeConnection(db, ws, cfg(t.fetchFn), 'A');
    await db.query("update threads_connections set token_expires_at = now() + interval '3 days', connected_at = now() - interval '50 days' where workspace_id = $1", [ws]);
    expect(await refreshIfNeeded(db, ws, cfg(t.fetchFn), now)).toBe('refreshed');
    expect(await loadActiveToken(db, ws, KEY)).toMatchObject({ token: 'REFRESHED-TOKEN' });
  });
  it('marks the connection when the refresh fails', async () => {
    const ws = await workspace();
    await completeConnection(db, ws, cfg(fakeThreads().fetchFn), 'A');
    await db.query("update threads_connections set token_expires_at = now() + interval '3 days', connected_at = now() - interval '50 days' where workspace_id = $1", [ws]);
    expect(await refreshIfNeeded(db, ws, cfg(fakeThreads({ failAt: 'refresh' }).fetchFn), now)).toBe('failed');
    expect((await getConnection(db, ws))?.status).toBe('needs_reconnect');
  });
});

describe('run orchestration (Run now and cron)', () => {
  const post = (id: string): RawPost => ({ source: 'apify_threads', externalId: id, url: `https://www.threads.com/@u${id}/post/${id}`, text: `I need a website for my business, number ${id}`, authorHandle: `u${id}`, postedAt: new Date().toISOString(), raw: {} });
  const collector = (posts: RawPost[]): Collector => ({ id: 'apify_threads', async run() { return { posts, costUsd: 0.01, queriesUsed: 0, status: 'ok' }; } });
  const deps = (over: Partial<OrchestrateDeps> = {}): OrchestrateDeps => ({
    collectorFor: async () => collector([post(`${n}1`), post(`${n}2`)]),
    llm: createFakeLlm(), channel: null, appUrl: 'http://x', globalMonthlyCeiling: 2000, maxCalls: 100, ...over,
  });

  it('runs a source with the limits saved for it and returns the summary', async () => {
    const ws = await workspace();
    await db.query('update workspace_sources set max_results = 50, max_spend_usd = 0.2 where workspace_id = $1 and source = $2', [ws, 'apify_threads']);
    let seen: { maxResults: number; maxSpendUsd: number } | undefined;
    const r = await runWorkspacePipeline(db, ws, 'apify_threads', deps({ collectorFor: async () => ({ id: 'apify_threads', async run(i) { seen = i; return { posts: [], costUsd: 0, queriesUsed: 0, status: 'ok' }; } }) }));
    expect(r.ok).toBe(true);
    expect(seen).toMatchObject({ maxResults: 50, maxSpendUsd: 0.2 });
  });
  it('refuses a source that is switched off', async () => {
    const ws = await workspace();
    const r = await runWorkspacePipeline(db, ws, 'threads_api', deps());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('switched off') });
  });
  it('refuses to start while another run is in progress, but ignores a stuck old one', async () => {
    const ws = await workspace();
    await db.query("insert into collector_runs (workspace_id, source, status) values ($1,'apify_threads','running')", [ws]);
    expect(await runWorkspacePipeline(db, ws, 'apify_threads', deps())).toMatchObject({ ok: false, error: expect.stringContaining('already in progress') });
    await db.query("update collector_runs set started_at = now() - interval '1 hour' where workspace_id = $1", [ws]);
    expect((await runWorkspacePipeline(db, ws, 'apify_threads', deps())).ok).toBe(true);
  });
  it('returns the collector setup error instead of throwing', async () => {
    const ws = await workspace();
    const r = await runWorkspacePipeline(db, ws, 'apify_threads', deps({ collectorFor: async () => { throw new Error('APIFY_TOKEN is not set.'); } }));
    expect(r).toEqual({ ok: false, error: 'APIFY_TOKEN is not set.' });
  });
  it('stops classifying when the time budget is over and keeps the rest for the next run', async () => {
    const ws = await workspace();
    const r = await runWorkspacePipeline(db, ws, 'apify_threads', deps({ timeBudgetMs: -1000 }));
    expect(r.ok && r.summary.classify.stoppedReason).toMatch(/Time budget/);
    expect(r.ok && r.summary.classify.classified).toBe(0);
    const again = await runWorkspacePipeline(db, ws, 'apify_threads', deps());
    expect(again.ok && again.summary.classify.classified).toBe(2);
  });
  it('the official collector needs a connected account or a development token', async () => {
    const ws = await workspace();
    await expect(threadsCollectorForWorkspace(db, ws, null, undefined)).rejects.toThrow(/No Threads account is connected/);
    expect((await threadsCollectorForWorkspace(db, ws, null, 'DEV-TOKEN')).id).toBe('threads_api');
    await completeConnection(db, ws, cfg(fakeThreads().fetchFn), 'A');
    expect((await threadsCollectorForWorkspace(db, ws, cfg(fakeThreads().fetchFn), undefined)).id).toBe('threads_api');
  });
});
