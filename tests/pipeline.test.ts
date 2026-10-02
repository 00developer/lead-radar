import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import type { Collector, RawPost } from '../src/lib/collectors/types';
import { createFakeLlm } from '../src/lib/classifier/fake-llm';
import { LlmQuotaError, type Llm } from '../src/lib/classifier/llm';
import { runPipelineOnce } from '../src/lib/pipeline/run-all';
import { runCollect } from '../src/lib/pipeline/collect';
import { runPrefilter } from '../src/lib/pipeline/prefilter-stage';
import { runClassify } from '../src/lib/pipeline/classify-stage';
import { runPromote } from '../src/lib/pipeline/promote-stage';
import { exportLeadsCsv } from '../src/lib/pipeline/export';
import { loadWorkspace } from '../src/lib/pipeline/workspace';
import { seedOwnerWorkspace } from '../src/lib/seed';

let db: Db;
let counter = 0;

beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterAll(async () => {
  await db.close();
});

const opts = { maxResults: 100, maxSpendUsd: 0.5, maxCalls: 100, globalMonthlyCeiling: 2000, now: new Date('2026-09-30T12:00:00Z') };

function post(id: string, text: string, over: Partial<RawPost> = {}): RawPost {
  return {
    source: 'apify_threads', externalId: id, url: `https://www.threads.com/@u${id}/post/${id}`, text, authorHandle: `u${id}`,
    postedAt: '2026-09-29T10:00:00.000Z', raw: { id }, ...over,
  };
}
const collectorOf = (posts: RawPost[], status: 'ok' | 'failed' = 'ok', error?: string): Collector => ({
  id: 'apify_threads',
  async run() {
    return { posts, costUsd: 0.012, queriesUsed: 0, status, error };
  },
});

async function newWorkspace(): Promise<string> {
  return seedOwnerWorkspace(db, `ws-${++counter}`);
}
const count = async (table: string, ws: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table} where workspace_id = $1`, [ws])).rows[0].n);

const buyer = 'I need a website for my clothing brand, budget is 300 dollars';
const seller = 'I am a freelance web developer looking for new clients';
const posts = [post('1', buyer), post('2', seller), post('3', 'Beautiful profile photo of yours today my friend')];

describe('schema (migration)', () => {
  it('is idempotent: a second run applies nothing', async () => {
    expect(await migrate(db)).toEqual([]);
  });
  it('has workspace_id and Row Level Security on every business table', async () => {
    const tables = await db.query<{ table_name: string; has_ws: boolean; rls: boolean }>(
      `select c.relname as table_name,
              exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'workspace_id') as has_ws,
              c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'`,
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(15);
    for (const t of tables.rows) {
      expect(t.rls, `RLS on ${t.table_name}`).toBe(true);
      if (!['workspaces', 'workspace_members'].includes(t.table_name)) expect(t.has_ws, `workspace_id on ${t.table_name}`).toBe(true);
    }
  });
  it('the monthly usage function is atomic per workspace and respects the ceiling', async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    const call = async (w: string) => (await db.query<{ ok: boolean }>('select try_record_ai_usage($1, $2, $3) as ok', [w, 'classify', 2])).rows[0].ok;
    expect([await call(a), await call(a), await call(a)]).toEqual([true, true, false]);
    expect(await call(b)).toBe(true);
  });
});

describe('seed', () => {
  it('creates the four services as rows and is idempotent', async () => {
    const id = await newWorkspace();
    await seedOwnerWorkspace(db, `ws-${counter}`);
    const ws = await loadWorkspace(db, id);
    expect(ws.services.map((s) => s.slug).sort()).toEqual(['ai_automation', 'mobile_app', 'saas', 'web_dev']);
    expect(ws.keywords.map((k) => k.term)).toContain('need a website');
    expect(ws.keywords.map((k) => k.term)).not.toContain('Shopify developer'); // seeded disabled
    expect(ws.negativeTerms).toContain('we offer');
    expect(ws.negativeTerms).not.toContain('portfolio');
    expect(ws.settings).toMatchObject({ leadThreshold: 60, alertThreshold: 80, allowedLanguages: ['en', 'hi', 'hinglish'] });
    expect(await count('workspace_services', id)).toBe(4);
  });
});

describe('pipeline', () => {
  it('runs end to end and a second run creates no duplicates or extra model calls', async () => {
    const id = await newWorkspace();
    let calls = 0;
    const fake = createFakeLlm();
    const llm: Llm = { ...fake, complete: async (s, u) => { calls++; return fake.complete(s, u); } };

    const first = await runPipelineOnce(db, id, collectorOf(posts), llm, opts);
    expect(first.collect).toMatchObject({ status: 'ok', postsReturned: 3, postsNew: 3, costUsd: 0.012 });
    expect(first.classify.classified).toBe(3);
    expect(first.promote.leadsCreated).toBe(1); // only the buyer
    const snapshot = [await count('posts', id), await count('classifications', id), await count('leads', id)];
    expect(snapshot).toEqual([3, 3, 1]);
    const callsAfterFirst = calls;

    const second = await runPipelineOnce(db, id, collectorOf(posts), llm, opts);
    expect(second.collect.postsNew).toBe(0);
    expect(second.classify.attempted).toBe(0);
    expect(calls).toBe(callsAfterFirst);
    expect([await count('posts', id), await count('classifications', id), await count('leads', id)]).toEqual(snapshot);
    expect(await count('ai_usage', id)).toBe(3);
  });

  it('logs the run with status, counts and cost', async () => {
    const id = await newWorkspace();
    await runPipelineOnce(db, id, collectorOf(posts), createFakeLlm(), opts);
    const run = (await db.query<Record<string, unknown>>('select * from collector_runs where workspace_id = $1', [id])).rows[0];
    expect(run).toMatchObject({ source: 'apify_threads', status: 'ok', posts_returned: 3, posts_new: 3 });
    expect(Number(run.cost_usd)).toBeCloseTo(0.012);
    expect(run.finished_at).toBeTruthy();
  });

  it('a failed collector is recorded and does not crash the pipeline', async () => {
    const id = await newWorkspace();
    const s = await runPipelineOnce(db, id, collectorOf([], 'failed', 'Threads API returned HTTP 400'), createFakeLlm(), opts);
    expect(s.collect).toMatchObject({ status: 'failed', postsNew: 0 });
    const run = (await db.query<{ status: string; error: string }>('select status, error from collector_runs where workspace_id = $1', [id])).rows[0];
    expect(run).toEqual({ status: 'failed', error: 'Threads API returned HTTP 400' });
  });

  it('a collector that throws is recorded as failed', async () => {
    const id = await newWorkspace();
    const ws = await loadWorkspace(db, id);
    const boom: Collector = { id: 'apify_threads', async run() { throw new Error('network down'); } };
    expect(await runCollect(db, ws, boom, { maxResults: 10, maxSpendUsd: 0.1 })).toMatchObject({ status: 'failed', error: 'network down' });
  });

  it('pre-filter keeps a reason for every dropped post and drops same-author duplicates', async () => {
    const id = await newWorkspace();
    const ws = await loadWorkspace(db, id);
    const input = [
      post('10', buyer),
      post('11', buyer, { authorHandle: 'u10' }), // same author, same text
      post('12', 'ok'),
      post('13', 'Please send your portfolio, I want a website built for my shop'),
      post('14', 'I need a website for my brand', { postedAt: '2026-01-01T00:00:00.000Z' }),
      post('15', 'ооо юрист ооо юридические услуги юрист для компании'),
    ];
    await runCollect(db, ws, collectorOf(input), { maxResults: 10, maxSpendUsd: 1 });
    await runPrefilter(db, ws, opts.now);
    const rows = (await db.query<{ external_id: string; prefilter_status: string; prefilter_reason: string | null }>('select external_id, prefilter_status, prefilter_reason from posts where workspace_id = $1 order by external_id', [id])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.external_id, r.prefilter_status]));
    expect(by).toEqual({
      '10': 'passed', '11': 'dropped_duplicate', '12': 'dropped_short', '13': 'passed', '14': 'dropped_old', '15': 'dropped_language',
    });
    expect(rows.filter((r) => r.prefilter_status !== 'passed').every((r) => r.prefilter_reason)).toBe(true);
  });

  it('applies the workspace language setting after classification', async () => {
    const id = await newWorkspace();
    const llm: Llm = {
      provider: 'test', model: 'test',
      async complete() {
        return { inputTokens: 1, outputTokens: 1, text: JSON.stringify({ author_type: 'buyer', service: 'web_dev', matched_offering: null, fit: null, intent_score: 85, urgency: 'medium', budget: null, timeline: null, language: 'other', reason: 'Indonesian request', reply_draft: 'Halo', confidence: 0.9 }) };
      },
    };
    const s = await runPipelineOnce(db, id, collectorOf([post('20', 'Adakah yang bisa bikin website usaha dengan harga murah')]), llm, opts);
    expect(s.promote).toMatchObject({ leadsCreated: 0, hidden: 1 });
    await db.query("update workspace_settings set allowed_languages = array['en','hi','hinglish','other'] where workspace_id = $1", [id]);
    const again = await runPromote(db, await loadWorkspace(db, id));
    expect(again.leadsCreated).toBe(1);
  });

  it('never rewrites a lead the owner already touched', async () => {
    const id = await newWorkspace();
    await runPipelineOnce(db, id, collectorOf([post('30', buyer)]), createFakeLlm(), opts);
    await db.query("update leads set status = 'contacted', notes = 'called' where workspace_id = $1", [id]);
    await db.query('update workspace_settings set lead_intent_threshold = 95 where workspace_id = $1', [id]);
    await runPromote(db, await loadWorkspace(db, id));
    const lead = (await db.query<{ status: string; notes: string }>('select status, notes from leads where workspace_id = $1', [id])).rows;
    expect(lead).toEqual([{ status: 'contacted', notes: 'called' }]);
  });

  it('keeps data of two workspaces apart and reads each workspace own services into the prompt', async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    await db.query("delete from workspace_services where workspace_id = $1", [b]);
    await db.query("insert into workspace_services (workspace_id, slug, name, description) values ($1, 'plumbing', 'Plumbing', 'Pipes')", [b]);
    const seen: Record<string, string> = {};
    const spy = (name: string): Llm => ({ ...createFakeLlm(), complete: async (s, u) => { seen[name] = s; return createFakeLlm().complete(s, u); } });

    await runPipelineOnce(db, a, collectorOf(posts), spy('a'), opts);
    await runPipelineOnce(db, b, collectorOf(posts), spy('b'), opts);
    expect(seen.a).toContain('web_dev');
    expect(seen.b).toContain('- plumbing: Plumbing. Pipes');
    expect(seen.b).not.toContain('web_dev');
    // same external ids in two workspaces are allowed, and each workspace only sees its own rows
    expect(await count('posts', a)).toBe(3);
    expect(await count('posts', b)).toBe(3);
    expect(await count('leads', a)).toBe(1);
  });
});

describe('classifier failure handling', () => {
  const okJson = (over: object = {}) => JSON.stringify({ author_type: 'buyer', service: 'web_dev', matched_offering: null, fit: null, intent_score: 80, urgency: 'low', budget: null, timeline: null, language: 'en', reason: 'ok', reply_draft: 'Hi', confidence: 0.9, ...over });

  it('a quota error stops the run loudly and the rest is picked up next time', async () => {
    const id = await newWorkspace();
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => post(`4${i}`, `I need a website number ${k} for my business please`));
    let n = 0;
    const flaky: Llm = { provider: 't', model: 't', async complete() { if (++n > 2) throw new LlmQuotaError('LLM quota exceeded: test'); return { text: okJson(), inputTokens: 1, outputTokens: 1 }; } };
    const ws = await loadWorkspace(db, id);
    await runCollect(db, ws, collectorOf(many), { maxResults: 100, maxSpendUsd: 1 });
    await runPrefilter(db, ws, opts.now);
    const s = await runClassify(db, ws, flaky, { maxCalls: 100, globalMonthlyCeiling: 2000, concurrency: 1 });
    expect(s.stoppedReason).toMatch(/quota/);
    expect(s.classified).toBe(2);
    expect(await count('classifications', id)).toBe(2);

    const good: Llm = { provider: 't', model: 't', async complete() { return { text: okJson(), inputTokens: 1, outputTokens: 1 }; } };
    const s2 = await runClassify(db, ws, good, { maxCalls: 100, globalMonthlyCeiling: 2000 });
    expect(s2.classified).toBe(4);
    expect(s2.stoppedReason).toBeNull();
  });

  it('an API failure leaves the post unclassified for the next run', async () => {
    const id = await newWorkspace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down: Llm = { provider: 't', model: 't', async complete() { throw new Error('500 internal'); } };
    const s = await runPipelineOnce(db, id, collectorOf([post('50', buyer)]), down, opts);
    expect(s.classify).toMatchObject({ apiFailures: 1, classified: 0 });
    expect(await count('classifications', id)).toBe(0);
    warn.mockRestore();
  });

  it('invalid JSON twice is stored as unclear with an error and shows up as a review lead', async () => {
    const id = await newWorkspace();
    let calls = 0;
    const junk: Llm = { provider: 't', model: 't', async complete() { calls++; return { text: 'sorry, here is prose', inputTokens: 1, outputTokens: 1 }; } };
    const s = await runPipelineOnce(db, id, collectorOf([post('60', buyer)]), junk, opts);
    expect(calls).toBe(2); // one retry, then stop
    expect(s.classify.storedWithError).toBe(1);
    const c = (await db.query<{ author_type: string; error: string; needs_review: boolean }>('select author_type, error, needs_review from classifications where workspace_id = $1', [id])).rows[0];
    expect(c).toMatchObject({ author_type: 'unclear', needs_review: true });
    expect(c.error).toMatch(/invalid model output/);
    expect(await count('leads', id)).toBe(1);
  });

  it('rejects a service slug outside the workspace services', async () => {
    const id = await newWorkspace();
    const bad: Llm = { provider: 't', model: 't', async complete() { return { text: okJson({ service: 'crypto' }), inputTokens: 1, outputTokens: 1 }; } };
    const s = await runPipelineOnce(db, id, collectorOf([post('70', buyer)]), bad, opts);
    expect(s.classify.storedWithError).toBe(1);
  });

  it('respects the per-run call limit and the monthly ceiling', async () => {
    const id = await newWorkspace();
    const many = [1, 2, 3, 4, 5].map((i) => post(`8${i}`, `I need a website version ${i} for my small business`));
    const ws = await loadWorkspace(db, id);
    await runCollect(db, ws, collectorOf(many), { maxResults: 100, maxSpendUsd: 1 });
    await runPrefilter(db, ws, opts.now);
    const limited = await runClassify(db, ws, createFakeLlm(), { maxCalls: 2, globalMonthlyCeiling: 2000 });
    expect(limited.attempted).toBe(2);

    await db.query('update workspace_settings set ai_monthly_ceiling = 3 where workspace_id = $1', [id]);
    const capped = await runClassify(db, await loadWorkspace(db, id), createFakeLlm(), { maxCalls: 100, globalMonthlyCeiling: 2000 });
    expect(capped.classified).toBe(1); // 2 used, ceiling 3
    expect(capped.stoppedReason).toMatch(/ceiling/);
  });
});

describe('export', () => {
  it('exports lead card fields, hidden posts with a reason, and neutralises formulas', async () => {
    const id = await newWorkspace();
    await runPipelineOnce(db, id, collectorOf([...posts, post('90', '=HYPERLINK("http://x","y") I need a website for my brand')]), createFakeLlm(), opts);
    const ws = await loadWorkspace(db, id);
    const { csv, leads, hidden } = await exportLeadsCsv(db, ws, { includeHidden: true });
    expect(leads).toBe(2);
    expect(hidden).toBe(2);
    expect(csv.split('\n')[0]).toContain('author_handle,author_name,profile_url,post_url');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('classified as seller');
    expect((await exportLeadsCsv(db, ws)).csv).not.toContain('classified as seller');
  });
});
