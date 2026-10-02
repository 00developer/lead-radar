import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createApifyThreadsCollector, mapWebdataItem, type ActorRunner } from '../src/lib/collectors/apify-threads';
import { createThreadsApiCollector, type FetchLike } from '../src/lib/collectors/threads-api';

const fixture = JSON.parse(fs.readFileSync('tests/fixtures/apify-webdata.sample.json', 'utf8')) as Record<string, unknown>[];
const input = { workspaceId: 'w', keywords: ['need a website', 'need a developer'], maxResults: 100, maxSpendUsd: 0.5 };

describe('apify collector', () => {
  it('maps a real saved item and derives the profile url from the post url', () => {
    const p = mapWebdataItem(fixture[0])!;
    expect(p.source).toBe('apify_threads');
    expect(p.externalId).toBe(String(fixture[0].postId));
    expect(p.url).toContain('/post/');
    expect(p.authorProfileUrl).toBe(String(fixture[0].url).split('/post/')[0]);
    expect(p.raw).toBe(fixture[0]);
  });
  it('skips reposts, non-posts and items without text or id', () => {
    expect(mapWebdataItem({ ...fixture[0], isRepost: true })).toBeNull();
    expect(mapWebdataItem({ ...fixture[0], type: 'profile' })).toBeNull();
    expect(mapWebdataItem({ ...fixture[0], text: '' })).toBeNull();
    expect(mapWebdataItem({ ...fixture[0], postId: undefined })).toBeNull();
  });
  it('passes hard limits to the runner and never asks for more than the spend limit allows', async () => {
    let seen: { maxItems: number; maxTotalChargeUsd: number } | undefined;
    const runner: ActorRunner = {
      async runActor(_id, _in, limits) {
        seen = limits;
        return { status: 'SUCCEEDED', usageTotalUsd: 0.01, items: fixture.slice(0, 5) };
      },
    };
    const c = createApifyThreadsCollector({ runner, actorId: 'a/b', pricePer1kUsd: 3 });
    const r = await c.run({ ...input, maxResults: 500, maxSpendUsd: 0.03 }); // $0.03 buys 10 items at $3 per 1,000
    expect(seen).toEqual({ maxItems: 10, maxTotalChargeUsd: 0.03 });
    expect(r.posts).toHaveLength(5);
    expect(r.costUsd).toBe(0.01);
  });
  it('refuses to run when the spend limit cannot buy one result', async () => {
    const runner: ActorRunner = {
      async runActor() {
        throw new Error('must not be called');
      },
    };
    const r = await createApifyThreadsCollector({ runner, actorId: 'a/b', pricePer1kUsd: 3 }).run({ ...input, maxSpendUsd: 0.0001 });
    expect(r.status).toBe('failed');
  });
  it('returns failed (not a crash) when the actor errors, and partial for a failed run with posts', async () => {
    const boom: ActorRunner = {
      async runActor() {
        throw new Error('402 Insufficient balance');
      },
    };
    const failed = await createApifyThreadsCollector({ runner: boom, actorId: 'a/b', pricePer1kUsd: 3 }).run(input);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('402') });
    const half: ActorRunner = {
      async runActor() {
        return { status: 'TIMED-OUT', usageTotalUsd: 0.02, items: fixture.slice(0, 3) };
      },
    };
    expect((await createApifyThreadsCollector({ runner: half, actorId: 'a/b', pricePer1kUsd: 3 }).run(input)).status).toBe('partial');
  });
  it('removes duplicate posts returned by two keywords', async () => {
    const runner: ActorRunner = {
      async runActor() {
        return { status: 'SUCCEEDED', usageTotalUsd: 0, items: [fixture[0], fixture[0], fixture[1]] };
      },
    };
    const r = await createApifyThreadsCollector({ runner, actorId: 'a/b', pricePer1kUsd: 3 }).run(input);
    expect(r.posts).toHaveLength(2);
  });
});

describe('threads official collector', () => {
  const TOKEN = 'SECRET-TOKEN-123';
  const item = (id: string, user: string) => ({
    id,
    text: `post ${id}`,
    permalink: `https://www.threads.net/@${user}/post/${id}`,
    timestamp: '2026-09-29T10:00:00+0000',
    username: user,
    is_reply: false,
  });
  const ok = (data: unknown[]): FetchLike => async () => ({ ok: true, status: 200, json: async () => ({ data }) });

  it('sends the documented parameters and maps the response', async () => {
    let url = '';
    const f: FetchLike = async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({ data: [item('1', 'alice')] }) };
    };
    const r = await createThreadsApiCollector({ accessToken: TOKEN, fetchFn: f }).run({ ...input, keywords: ['need a website'], sinceIso: '2026-09-29T00:00:00Z' });
    const p = new URL(url).searchParams;
    expect(p.get('q')).toBe('need a website');
    expect(p.get('search_type')).toBe('RECENT');
    expect(p.get('access_token')).toBe(TOKEN);
    expect(p.get('since')).toBe(String(Date.parse('2026-09-29T00:00:00Z') / 1000));
    expect(r.posts[0]).toMatchObject({ source: 'threads_api', externalId: '1', authorHandle: 'alice', postedAt: '2026-09-29T10:00:00.000Z' });
    expect(r.queriesUsed).toBe(1);
    expect(r.costUsd).toBe(0);
  });
  it('treats an empty result as normal, not an error', async () => {
    const r = await createThreadsApiCollector({ accessToken: TOKEN, fetchFn: ok([]) }).run(input);
    expect(r).toMatchObject({ status: 'ok', posts: [] });
  });
  it('fails loudly when only the connected account own posts come back (permission not approved)', async () => {
    const r = await createThreadsApiCollector({ accessToken: TOKEN, ownUsername: 'Me', fetchFn: ok([item('1', 'me')]) }).run(input);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/permission not approved/);
  });
  it('never leaks the token in errors', async () => {
    const bad: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({}) });
    const thrown: FetchLike = async (u) => {
      throw new Error(`network error for ${u}`);
    };
    for (const f of [bad, thrown]) {
      const r = await createThreadsApiCollector({ accessToken: TOKEN, fetchFn: f }).run(input);
      expect(r.status).toBe('failed');
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });
  it('stops before the 2,200 queries per 24 hours budget and reports partial', async () => {
    const r = await createThreadsApiCollector({ accessToken: TOKEN, fetchFn: ok([]), queriesUsedLast24h: 2199 }).run({ ...input, keywords: ['a', 'b', 'c'] });
    expect(r.queriesUsed).toBe(1);
    expect(r.status).toBe('partial');
  });
});

describe('official search error messages', () => {
  it("includes Meta's own error text (a missing permission) and never the token", async () => {
    const TOKEN = 'SECRET-TOKEN-XYZ';
    const denied: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: `Application does not have permission for this action (${TOKEN})`, code: 10 } }) });
    const r = await createThreadsApiCollector({ accessToken: TOKEN, fetchFn: denied }).run({ workspaceId: 'w', keywords: ['need a website'], maxResults: 5, maxSpendUsd: 0 });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('Application does not have permission for this action');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});
