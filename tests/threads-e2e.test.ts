import { describe, expect, it } from 'vitest';
import { createThreadsApiCollector, type FetchLike } from '../src/lib/collectors/threads-api';
import { createFakeLlm } from '../src/lib/classifier/fake-llm';
import { runThreadsE2e } from '../src/lib/threads/e2e';

const TOKEN = 'DEV-TOKEN-SECRET';
const ownPost = (text: string, id = '1') => ({
  id, text, permalink: `https://www.threads.net/@tester/post/${id}`, timestamp: new Date().toISOString().replace('Z', '+0000'), username: 'tester', is_reply: false,
});
const fetchReturning = (data: unknown[]): FetchLike => async () => ({ ok: true, status: 200, json: async () => ({ data }) });
const input = { workspaceId: 'w', keywords: ['need a website'], maxResults: 10, maxSpendUsd: 0 };

describe('official search test mode (before Meta approves threads_keyword_search)', { timeout: 180000 }, () => {
  it('by default own posts are reported as "permission not approved", never as leads', async () => {
    const c = createThreadsApiCollector({ accessToken: TOKEN, ownUsername: 'tester', fetchFn: fetchReturning([ownPost('I need a website for my shop')]) });
    expect(await c.run(input)).toMatchObject({ status: 'failed', posts: [], error: expect.stringContaining('permission not approved') });
  });

  it('with test mode on, own posts come back as normal posts', async () => {
    const c = createThreadsApiCollector({ accessToken: TOKEN, ownUsername: 'tester', allowOwnPosts: true, fetchFn: fetchReturning([ownPost('I need a website for my shop')]) });
    const r = await c.run(input);
    expect(r.status).toBe('ok');
    expect(r.posts).toHaveLength(1);
  });

  it('runs the whole pipeline in a throwaway database and shows the lead, without any real data', async () => {
    const res = await runThreadsE2e({
      accessToken: TOKEN, ownUsername: 'tester', llm: createFakeLlm(),
      fetchFn: fetchReturning([ownPost('I need a website for my shop, budget 300 dollars', '1'), ownPost('Beautiful sunset at the beach today my friends', '2')]),
    });
    expect(res).toMatchObject({ found: 2, classified: 2 });
    expect(res.leads).toHaveLength(1);
    expect(res.leads[0]).toMatchObject({ handle: 'tester', service: 'web_dev' });
    expect(res.leads[0].text).toContain('budget 300');
    expect(res.hidden.map((h) => h.type)).toEqual(['irrelevant']);
  });

  it('uses only the keywords it is given, and a search with no matches reports zero without an error', async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url) => {
      seen.push(new URL(url).searchParams.get('q') ?? '');
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const res = await runThreadsE2e({ accessToken: TOKEN, ownUsername: 'tester', llm: createFakeLlm(), keywords: ['hire a developer'], fetchFn: f });
    expect(res).toMatchObject({ found: 0, classified: 0, leads: [] });
    expect(seen).toEqual(['hire a developer']);
  });

  it('never leaks the token in anything it returns', async () => {
    const res = await runThreadsE2e({ accessToken: TOKEN, ownUsername: 'tester', llm: createFakeLlm(), fetchFn: fetchReturning([ownPost('I need a website for my shop, budget 300 dollars')]) });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });
});
