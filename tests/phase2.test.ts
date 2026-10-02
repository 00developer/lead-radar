import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import type { Collector, RawPost } from '../src/lib/collectors/types';
import type { Llm } from '../src/lib/classifier/llm';
import type { AlertChannel, AlertMessage, SendResult } from '../src/lib/alerts/channel';
import { createResendChannel, type FetchLike } from '../src/lib/alerts/email';
import { buildLeadEmail } from '../src/lib/alerts/compose';
import { extractContactHints, hasAnyHint } from '../src/lib/contact-hints';
import { runPipelineOnce } from '../src/lib/pipeline/run-all';
import { runAlerts } from '../src/lib/pipeline/alert-stage';
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

const NOW = new Date('2026-09-30T12:00:00Z');
const opts = { maxResults: 100, maxSpendUsd: 0.5, maxCalls: 100, globalMonthlyCeiling: 2000, now: NOW };

const post = (id: string, text: string): RawPost => ({
  source: 'apify_threads', externalId: id, url: `https://www.threads.com/@u${id}/post/${id}`, text, authorHandle: `u${id}`,
  postedAt: '2026-09-29T10:00:00.000Z', raw: { id },
});
const collectorOf = (posts: RawPost[]): Collector => ({ id: 'apify_threads', async run() { return { posts, costUsd: 0, queriesUsed: 0, status: 'ok' }; } });
const llmWith = (intent: number, type = 'buyer'): Llm => ({
  provider: 't', model: 't',
  async complete() {
    return { inputTokens: 1, outputTokens: 1, text: JSON.stringify({ author_type: type, service: 'web_dev', matched_offering: null, fit: null, intent_score: intent, urgency: 'high', budget: null, timeline: null, language: 'en', reason: 'Wants a website', reply_draft: 'Hi there', confidence: 0.9 }) };
  },
});

function recorder(result: SendResult = { ok: true }, delayMs = 0): AlertChannel & { sent: AlertMessage[] } {
  const sent: AlertMessage[] = [];
  return {
    id: 'email',
    sent,
    async send(m) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (result.ok) sent.push(m);
      return result;
    },
  };
}

async function workspaceWithLeads(n: number, intent = 90, alertEmail: string | null = 'owner@example.com'): Promise<string> {
  const id = await seedOwnerWorkspace(db, `p2-${++counter}`);
  await db.query('update workspace_settings set alert_email = $2 where workspace_id = $1', [id, alertEmail]);
  const posts = Array.from({ length: n }, (_, i) => post(`${counter}00${i}`, `I need a website for my business number ${i}, please help`));
  await runPipelineOnce(db, id, collectorOf(posts), llmWith(intent), opts);
  return id;
}
const alertRows = async (ws: string) => (await db.query<{ status: string; error: string | null }>('select status, error from alerts where workspace_id = $1', [ws])).rows;

describe('contact hints', () => {
  it('finds emails, phones, links and WhatsApp in text and bio', () => {
    const h = extractContactHints('I need a web app developer dm watsapp on 0775956652 or mail me: Hire.Me@Example.com', 'site https://my.site/x.');
    expect(h.emails).toEqual(['hire.me@example.com']);
    expect(h.phones).toContain('0775956652');
    expect(h.links).toEqual(['https://my.site/x']);
    expect(h.whatsapp).toBe(true);
  });
  it('does not treat post ids inside links as phone numbers, and finds nothing in plain text', () => {
    expect(extractContactHints('see https://www.threads.com/@a/post/3997485651041584340').phones).toEqual([]);
    expect(hasAnyHint(extractContactHints('I need a website for my clothing brand'))).toBe(false);
    expect(hasAnyHint(extractContactHints(null, undefined))).toBe(false);
  });
});

describe('alert email content', () => {
  const lead = { id: 'abc', service: 'web_dev', intent_score: 90, author_handle: 'ann', reason: 'Wants a site', text: '<img src=x onerror=alert(1)> need a site', post_url: 'https://www.threads.com/@ann/post/1', reply_draft: 'Hi <b>Ann</b>', needs_review: false };
  it('builds the subject from service, intent and handle', () => {
    expect(buildLeadEmail(lead, 'http://localhost:3000').subject).toBe('New lead: web_dev · intent 90 · @ann');
  });
  it('escapes everything from the post in the HTML and links to the lead', () => {
    const m = buildLeadEmail(lead, 'http://localhost:3000/');
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(m.html).toContain('http://localhost:3000/leads/abc');
    expect(m.text).toContain('Open in Lead Radar: http://localhost:3000/leads/abc');
    expect(m.text).toContain('never contacts anyone');
  });
  it('truncates long posts to 500 characters and refuses non-http links', () => {
    const m = buildLeadEmail({ ...lead, text: 'x'.repeat(2000), post_url: 'javascript:alert(1)' }, 'http://a');
    expect(m.text).toContain('x'.repeat(500) + '…');
    expect(m.text).not.toContain('x'.repeat(501));
    expect(m.html).toContain('href="#"');
  });
  it('flags leads the AI was unsure about and cannot be given a header injection through the handle', () => {
    expect(buildLeadEmail({ ...lead, needs_review: true }, 'http://a').text).toContain('AI was unsure');
    expect(buildLeadEmail({ ...lead, author_handle: 'a\r\nBcc: x@y.z' }, 'http://a').subject).not.toMatch(/[\r\n]/);
  });
});

describe('resend channel', () => {
  const msg: AlertMessage = { key: 'lead-alert-1', to: 'o@example.com', subject: 'S', text: 'T', html: '<p>T</p>' };
  it('sends the documented request', async () => {
    let seen: { url: string; init: { method: string; headers: Record<string, string>; body: string } } | undefined;
    const f: FetchLike = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ id: 'x' }) }; };
    const r = await createResendChannel({ apiKey: 're_SECRET', from: 'Lead Radar <a@b.c>', fetchFn: f }).send(msg);
    expect(r).toEqual({ ok: true });
    expect(seen!.url).toBe('https://api.resend.com/emails');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.headers.Authorization).toBe('Bearer re_SECRET');
    expect(seen!.init.headers['Idempotency-Key']).toBe('lead-alert-1');
    expect(JSON.parse(seen!.init.body)).toEqual({ from: 'Lead Radar <a@b.c>', to: ['o@example.com'], subject: 'S', text: 'T', html: '<p>T</p>' });
  });
  it('reports provider errors without leaking the key', async () => {
    const bad: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) });
    const thrown: FetchLike = async () => { throw new Error('boom re_SECRET'); };
    const a = await createResendChannel({ apiKey: 're_SECRET', from: 'x', fetchFn: bad }).send(msg);
    expect(a).toEqual({ ok: false, error: 'Email provider returned HTTP 403: domain not verified' });
    const b = await createResendChannel({ apiKey: 're_SECRET', from: 'x', fetchFn: thrown }).send(msg);
    expect(JSON.stringify(b)).not.toContain('re_SECRET');
  });
});

describe('alert stage', () => {
  it('sends one email for a high-intent lead and never a second one', async () => {
    const ws = await workspaceWithLeads(1);
    const ch = recorder();
    const wsCtx = await loadWorkspace(db, ws);
    const first = await runAlerts(db, wsCtx, { channel: ch, appUrl: 'http://x', alertEmail: 'owner@example.com' });
    expect(first).toMatchObject({ candidates: 1, sent: 1, failed: 0 });
    expect(ch.sent[0].to).toBe('owner@example.com');
    const second = await runAlerts(db, wsCtx, { channel: ch, appUrl: 'http://x', alertEmail: 'owner@example.com' });
    expect(second.sent).toBe(0);
    expect(ch.sent).toHaveLength(1);
    expect(await alertRows(ws)).toEqual([{ status: 'sent', error: null }]);
    const ev = await db.query<{ n: string }>("select count(*) as n from lead_events where workspace_id = $1 and event = 'alerted'", [ws]);
    expect(Number(ev.rows[0].n)).toBe(1);
  });
  it('does not alert below the alert threshold, for touched leads, or without an alert address', async () => {
    const low = await workspaceWithLeads(1, 70);
    expect((await runAlerts(db, await loadWorkspace(db, low), { channel: recorder(), appUrl: 'x', alertEmail: 'o@e.com' })).candidates).toBe(0);

    const touched = await workspaceWithLeads(1);
    await db.query("update leads set status = 'contacted' where workspace_id = $1", [touched]);
    expect((await runAlerts(db, await loadWorkspace(db, touched), { channel: recorder(), appUrl: 'x', alertEmail: 'o@e.com' })).candidates).toBe(0);

    const none = await workspaceWithLeads(1, 90, null);
    const ch = recorder();
    const r = await runAlerts(db, await loadWorkspace(db, none), { channel: ch, appUrl: 'x', alertEmail: null });
    expect(r.skipped).toMatch(/No alert email/);
    expect(await alertRows(none)).toEqual([]);
  });
  it('keeps a failed alert and retries it on the next run', async () => {
    const ws = await workspaceWithLeads(1);
    const ctx = await loadWorkspace(db, ws);
    const bad = recorder({ ok: false, error: 'HTTP 500' });
    expect(await runAlerts(db, ctx, { channel: bad, appUrl: 'x', alertEmail: 'o@e.com' })).toMatchObject({ failed: 1, sent: 0 });
    expect(await alertRows(ws)).toEqual([{ status: 'failed', error: 'HTTP 500' }]);
    const good = recorder();
    expect(await runAlerts(db, ctx, { channel: good, appUrl: 'x', alertEmail: 'o@e.com' })).toMatchObject({ sent: 1 });
    expect(await alertRows(ws)).toEqual([{ status: 'sent', error: null }]);
  });
  it('two runs at the same time send only one email', async () => {
    const ws = await workspaceWithLeads(1);
    const ctx = await loadWorkspace(db, ws);
    const ch = recorder({ ok: true }, 30);
    const [a, b] = await Promise.all([
      runAlerts(db, ctx, { channel: ch, appUrl: 'x', alertEmail: 'o@e.com' }),
      runAlerts(db, ctx, { channel: ch, appUrl: 'x', alertEmail: 'o@e.com' }),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(ch.sent).toHaveLength(1);
  });
  it('caps the number of emails per run so switching alerts on does not flood the inbox', async () => {
    const ws = await workspaceWithLeads(7);
    const ctx = await loadWorkspace(db, ws);
    const ch = recorder();
    expect((await runAlerts(db, ctx, { channel: ch, appUrl: 'x', alertEmail: 'o@e.com', maxPerRun: 5 })).sent).toBe(5);
    expect((await runAlerts(db, ctx, { channel: ch, appUrl: 'x', alertEmail: 'o@e.com', maxPerRun: 5 })).sent).toBe(2);
    expect(new Set(ch.sent.map((m) => m.key)).size).toBe(7);
  });
  it('skips leads older than the age limit', async () => {
    const ws = await workspaceWithLeads(1);
    await db.query("update leads set created_at = now() - interval '10 days' where workspace_id = $1", [ws]);
    expect((await runAlerts(db, await loadWorkspace(db, ws), { channel: recorder(), appUrl: 'x', alertEmail: 'o@e.com', maxAgeHours: 72 })).candidates).toBe(0);
  });
  it('the pipeline sends alerts after promotion when a channel is given', async () => {
    const id = await seedOwnerWorkspace(db, `p2-${++counter}`);
    await db.query("update workspace_settings set alert_email = 'o@e.com' where workspace_id = $1", [id]);
    const ch = recorder();
    const s = await runPipelineOnce(db, id, collectorOf([post(`${counter}9`, 'I need a website for my shop, budget 300 dollars')]), llmWith(92), { ...opts, alerts: { channel: ch, appUrl: 'http://x' } });
    expect(s.alerts).toMatchObject({ sent: 1 });
    expect(ch.sent[0].subject).toContain('intent 92');
  });
});

describe('dashboard views and triggers (migration 0002)', () => {
  it('lead_inbox joins the lead with its post and classification', async () => {
    const ws = await workspaceWithLeads(1);
    const rows = (await db.query<Record<string, unknown>>('select * from lead_inbox where workspace_id = $1', [ws])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'new', author_type: 'buyer', service: 'web_dev', intent_score: 90, source: 'apify_threads' });
    expect(String(rows[0].text)).toContain('I need a website');
  });
  it('hidden_posts lists classified posts that are not leads', async () => {
    const id = await seedOwnerWorkspace(db, `p2-${++counter}`);
    await runPipelineOnce(db, id, collectorOf([post(`${counter}1`, 'I am a freelance developer looking for clients now')]), llmWith(0, 'seller'), opts);
    const rows = (await db.query<{ author_type: string }>('select author_type from hidden_posts where workspace_id = $1', [id])).rows;
    expect(rows).toEqual([{ author_type: 'seller' }]);
    expect((await db.query('select * from lead_inbox where workspace_id = $1', [id])).rows).toHaveLength(0);
  });
  it('changes to status, label and notes are logged and updated_at moves', async () => {
    const ws = await workspaceWithLeads(1);
    const before = (await db.query<{ id: string; updated_at: Date }>('select id, updated_at from leads where workspace_id = $1', [ws])).rows[0];
    await new Promise((r) => setTimeout(r, 15));
    await db.query("update leads set status = 'contacted' where id = $1", [before.id]);
    await db.query("update leads set review_label = 'genuine' where id = $1", [before.id]);
    await db.query("update leads set notes = 'called him' where id = $1", [before.id]);
    await db.query("update leads set status = 'contacted' where id = $1", [before.id]); // no change: no event
    const ev = (await db.query<{ event: string; from_value: string | null; to_value: string | null }>('select event, from_value, to_value from lead_events where lead_id = $1 order by created_at, event', [before.id])).rows;
    expect(ev.map((e) => e.event).sort()).toEqual(['labeled', 'note_updated', 'status_changed']);
    expect(ev.find((e) => e.event === 'status_changed')).toMatchObject({ from_value: 'new', to_value: 'contacted' });
    const after = (await db.query<{ updated_at: Date }>('select updated_at from leads where id = $1', [before.id])).rows[0];
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });
  it('seed creates the two source rows and they are limited by check constraints', async () => {
    const id = await seedOwnerWorkspace(db, `p2-${++counter}`);
    const rows = (await db.query<{ source: string; enabled: boolean }>('select source, enabled from workspace_sources where workspace_id = $1 order by source', [id])).rows;
    expect(rows).toEqual([{ source: 'apify_threads', enabled: true }, { source: 'threads_api', enabled: false }]);
    await expect(db.query('update workspace_sources set max_spend_usd = 999 where workspace_id = $1', [id])).rejects.toThrow();
  });
});
