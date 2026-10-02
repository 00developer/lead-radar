import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import type { Collector, RawPost } from '../src/lib/collectors/types';
import type { Llm } from '../src/lib/classifier/llm';
import { parseCsv } from '../src/lib/csv';
import { exportLabeledLeads, GOLDEN_HEADER } from '../src/lib/golden';
import { computeInsights, intentBand, pct, THRESHOLDS, type InsightRow } from '../src/lib/insights';
import { runPipelineOnce } from '../src/lib/pipeline/run-all';
import { seedOwnerWorkspace } from '../src/lib/seed';

const row = (intent: number | null, label: InsightRow['review_label'], keyword = 'need a website', over: Partial<InsightRow> = {}): InsightRow => ({
  intent_score: intent, review_label: label, matched_keyword: keyword, service: 'web_dev', language: 'en', source: 'apify_threads', ...over,
});

describe('insights', () => {
  it('asks for labels when nothing is labeled and reports no rate', () => {
    const i = computeInsights([row(90, null), row(70, null)]);
    expect(i).toMatchObject({ total: 2, labeled: 0, genuine: 0, rate: null, fewLabels: true });
    expect(i.advice[0]).toMatch(/No leads are labeled yet/);
    expect(i.thresholds.every((t) => t.precision === null)).toBe(true);
  });

  it('computes the genuine rate from labeled leads only, and warns about few labels', () => {
    const i = computeInsights([row(90, 'genuine'), row(80, 'genuine'), row(70, 'not_genuine'), row(60, null), row(50, null)]);
    expect(i).toMatchObject({ total: 5, labeled: 3, genuine: 2 });
    expect(i.rate).toBeCloseTo(2 / 3);
    expect(i.advice.join(' ')).toMatch(/at or above the 50% target/);
    expect(i.advice.join(' ')).toMatch(/Only 3 lead\(s\) are labeled/);
  });

  it('says when the rate is below the target', () => {
    const i = computeInsights([row(90, 'genuine'), row(80, 'not_genuine'), row(70, 'not_genuine')]);
    expect(i.advice.join(' ')).toMatch(/below the 50% target/);
  });

  it('what-if table: precision, genuine lost and recall at each threshold', () => {
    const i = computeInsights([row(90, 'genuine'), row(85, 'genuine'), row(75, 'not_genuine'), row(65, 'genuine'), row(55, 'not_genuine')]);
    const at = (t: number) => i.thresholds.find((x) => x.threshold === t)!;
    expect(at(60)).toMatchObject({ keptLabeled: 4, keptGenuine: 3, genuineLost: 0, precision: 0.75, recall: 1 });
    expect(at(80)).toMatchObject({ keptLabeled: 2, keptGenuine: 2, genuineLost: 1, precision: 1 });
    expect(at(80).recall).toBeCloseTo(2 / 3);
    expect(at(90)).toMatchObject({ keptLabeled: 1, keptGenuine: 1 });
    expect(i.thresholds.map((t) => t.threshold)).toEqual(THRESHOLDS);
  });

  it('groups by keyword, service, language, source and intent band, with rates', () => {
    const i = computeInsights([
      row(90, 'genuine', 'need a website'), row(85, 'genuine', 'need a website'), row(70, 'not_genuine', 'developer needed'),
      row(60, null, 'developer needed', { service: 'saas', language: 'hinglish' }),
    ]);
    const kw = Object.fromEntries(i.byKeyword.map((g) => [g.key, g]));
    expect(kw['need a website']).toMatchObject({ total: 2, labeled: 2, genuine: 2, rate: 1 });
    expect(kw['developer needed']).toMatchObject({ total: 2, labeled: 1, genuine: 0, rate: 0 });
    expect(i.byService.map((g) => g.key).sort()).toEqual(['saas', 'web_dev']);
    expect(i.byLanguage.map((g) => g.key).sort()).toEqual(['en', 'hinglish']);
    expect(i.bySource).toHaveLength(1);
    expect(i.byIntentBand.map((g) => g.key)).toEqual(['90 to 100', '80 to 89', '70 to 79', '60 to 69']);
  });

  it('gives keyword advice only with enough labels (5)', () => {
    const bad = Array.from({ length: 5 }, (_, k) => row(70 + k, k === 0 ? 'genuine' : 'not_genuine', 'Shopify developer'));
    const good = Array.from({ length: 5 }, (_, k) => row(80 + k, k === 0 ? 'not_genuine' : 'genuine', 'need a website'));
    const few = Array.from({ length: 4 }, () => row(70, 'not_genuine', 'tiny keyword'));
    const text = computeInsights([...bad, ...good, ...few]).advice.join('\n');
    expect(text).toMatch(/Keyword "Shopify developer": only 20% genuine in 5 labeled leads. Consider disabling/);
    expect(text).toMatch(/Keyword "need a website": 80% genuine in 5 labeled leads. It works well/);
    expect(text).not.toMatch(/tiny keyword/);
  });

  it('suggests a different threshold only with 20 or more labels, and only as advice', () => {
    // intent 50 to 59: not genuine. intent 60 to 69: half genuine. intent 70 and up: genuine.
    const rows: InsightRow[] = [];
    for (let k = 0; k < 8; k++) rows.push(row(50 + k, 'not_genuine'));
    for (let k = 0; k < 6; k++) rows.push(row(60 + k, k % 2 === 0 ? 'genuine' : 'not_genuine'));
    for (let k = 0; k < 8; k++) rows.push(row(75 + k, 'genuine'));
    const advice = computeInsights(rows).advice.join('\n');
    expect(advice).toMatch(/A lead threshold of \d+ would have given \d+% genuine while keeping \d+% of the genuine leads/);
    expect(computeInsights(rows.slice(0, 10)).advice.join('\n')).not.toMatch(/A lead threshold of/);
  });

  it('says so when no threshold can reach the target', () => {
    const rows = Array.from({ length: 24 }, (_, k) => row(60 + (k % 30), k % 10 === 0 ? 'genuine' : 'not_genuine'));
    expect(computeInsights(rows).advice.join('\n')).toMatch(/No threshold reaches the target precision/);
  });

  it('intent bands and percentages', () => {
    expect([intentBand(95), intentBand(90), intentBand(89), intentBand(80), intentBand(79), intentBand(60), intentBand(59), intentBand(null)]).toEqual([
      '90 to 100', '90 to 100', '80 to 89', '80 to 89', '70 to 79', '60 to 69', 'below 60', 'no score',
    ]);
    expect(pct(0.756)).toBe('76%');
    expect(pct(null)).toBe('n/a');
  });
});

describe('golden set export', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createMemoryDb();
    await migrate(db);
  });
  afterAll(async () => {
    await db.close();
  });

  const post = (id: string, text: string): RawPost => ({
    source: 'apify_threads', externalId: id, url: `https://www.threads.com/@u${id}/post/${id}`, text, authorHandle: `u${id}`,
    postedAt: new Date().toISOString(), raw: {},
  });
  const llm: Llm = {
    provider: 't', model: 't',
    async complete() {
      return { inputTokens: 1, outputTokens: 1, text: JSON.stringify({ author_type: 'buyer', service: 'web_dev', matched_offering: null, fit: null, intent_score: 85, urgency: 'low', budget: null, timeline: null, language: 'en', reason: 'wants a site', reply_draft: 'Hi', confidence: 0.9 }) };
    },
  };

  it('exports only labeled leads, with y or n, in the same columns as the Phase 0 golden set', async () => {
    const ws = await seedOwnerWorkspace(db, 'golden-1');
    const posts = [post('g1', 'I need a website for my shop, budget 300'), post('g2', '=HYPERLINK("http://x","y") I need a website for my cafe'), post('g3', 'I need a website for my gym, please help')];
    const collector: Collector = { id: 'apify_threads', async run() { return { posts, costUsd: 0, queriesUsed: 0, status: 'ok' }; } };
    await runPipelineOnce(db, ws, collector, llm, { maxResults: 10, maxSpendUsd: 1, maxCalls: 10, globalMonthlyCeiling: 100 });

    const none = await exportLabeledLeads(db, ws);
    expect(none.count).toBe(0);

    const ids = (await db.query<{ id: string; text: string }>('select l.id, p.text from leads l join posts p on p.id = l.post_id where l.workspace_id = $1', [ws])).rows;
    await db.query("update leads set review_label = 'genuine' where id = $1", [ids.find((x) => x.text.includes('shop'))!.id]);
    await db.query("update leads set review_label = 'not_genuine', notes = 'agency' where id = $1", [ids.find((x) => x.text.includes('HYPERLINK'))!.id]);

    const out = await exportLabeledLeads(db, ws);
    expect(out).toMatchObject({ count: 2, genuine: 1 });
    const parsed = parseCsv(out.csv);
    expect(parsed[0]).toEqual(GOLDEN_HEADER);
    expect(parsed).toHaveLength(3);
    const iOwner = GOLDEN_HEADER.indexOf('owner_genuine_buyer (y/n)');
    const byText = Object.fromEntries(parsed.slice(1).map((r) => [r[GOLDEN_HEADER.indexOf('text')], r]));
    expect(byText['I need a website for my shop, budget 300'][iOwner]).toBe('y');
    const hyper = parsed.slice(1).find((r) => r[GOLDEN_HEADER.indexOf('text')].includes('HYPERLINK'))!;
    expect(hyper[iOwner]).toBe('n');
    expect(hyper[GOLDEN_HEADER.indexOf('text')].startsWith("'=")).toBe(true); // spreadsheet formulas are neutralised
    expect(hyper[GOLDEN_HEADER.indexOf('owner_comment')]).toBe('agency');
    expect(parsed.slice(1).some((r) => r[GOLDEN_HEADER.indexOf('text')].includes('gym'))).toBe(false); // unlabeled
  });

  it('never mixes workspaces', async () => {
    const a = await seedOwnerWorkspace(db, 'golden-2');
    const b = await seedOwnerWorkspace(db, 'golden-3');
    const collector: Collector = { id: 'apify_threads', async run() { return { posts: [post('h1', 'I need a website for my bakery, budget 200')], costUsd: 0, queriesUsed: 0, status: 'ok' }; } };
    await runPipelineOnce(db, a, collector, llm, { maxResults: 10, maxSpendUsd: 1, maxCalls: 10, globalMonthlyCeiling: 100 });
    await db.query("update leads set review_label = 'genuine' where workspace_id = $1", [a]);
    expect((await exportLabeledLeads(db, b)).count).toBe(0);
    expect((await exportLabeledLeads(db, a)).count).toBe(1);
  });
});
