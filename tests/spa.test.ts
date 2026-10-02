import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import type { Llm } from '../src/lib/classifier/llm';
import { extractCopyStrings, findChunkRefs, findScriptUrls, looksLikeCopy } from '../src/lib/profile/spa';
import { scanSite } from '../src/lib/profile/scan';
import { fetchPage, type Resolved, type Transport, type TransportResponse } from '../src/lib/profile/safe-fetch';
import { analyzePastedText } from '../src/lib/profile/run';
import { getProfile, loadConfirmedProfile, confirmProfile } from '../src/lib/profile/store';
import { seedOwnerWorkspace } from '../src/lib/seed';

// ---- helpers ---------------------------------------------------------------------------------------

type Page = { status?: number; type?: string; body?: string };
function fakeNet(pages: Record<string, Page>) {
  const requests: string[] = [];
  const transport: Transport = {
    async resolve(): Promise<Resolved[]> { return [{ address: '93.184.216.34', family: 4 }]; },
    async get({ url, maxBytes }): Promise<TransportResponse> {
      requests.push(url.toString());
      const p = pages[url.toString()];
      if (!p) return { status: 404, headers: {}, body: Buffer.from(''), truncated: false };
      const body = Buffer.from(p.body ?? '');
      return { status: p.status ?? 200, headers: p.type ? { 'content-type': p.type } : {}, body: body.subarray(0, maxBytes), truncated: body.length > maxBytes };
    },
  };
  return { transport, requests };
}
const html = (body: string): Page => ({ type: 'text/html', body });
const js = (body: string): Page => ({ type: 'application/javascript', body });

const SITE = 'https://spa.example.com';
const SPA_HTML = `<!doctype html><html><head><title>Acme</title><script type="module" crossorigin src="/assets/index-AbC123xy.js"></script>
<link rel="modulepreload" href="/assets/vendor-react-Zz9.js"><script src="https://cdn.thirdparty.io/tracker.js"></script></head><body><div id="root"></div></body></html>`;
const BUNDLE = `
const a="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3";
const b="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-4";
jsx("h1",{children:"Custom websites and mobile apps for growing companies"});
jsx("p",{children:"We build AI agents that answer your customers 24/7."});
jsx("li",{children:"Workflow automation for sales and support"});
jsx("p",{children:"Voice agents that book appointments and qualify inbound leads for your team."});
jsx("p",{children:"Dashboards that show revenue, churn and pipeline in one place for founders."});
const c="Uncaught TypeError: cannot read properties of undefined";
const d="./About-Kq81Zz.js"; const e="./vendor-icons-Xy77Aa.js";
const f=function(x){return x+1};
`;

// ---- copy detection --------------------------------------------------------------------------------

describe('deciding what is page copy', () => {
  it.each([
    'Custom websites and mobile apps for growing companies',
    'We build AI agents that answer your customers 24/7.',
    'Scale Orders, Not Overheads',
    'Hindi + English + 12 regional langs',
    'Automate invoicing, GST filing, bank reconciliation, and expense management.',
  ])('keeps: %s', (s) => expect(looksLikeCopy(s)).toBe(true));
  it.each([
    'mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3',
    'flex-1 space-y-2.5 overflow-y-auto px-3.5 py-4',
    '0 0 0 3px rgba(242,101,34,.55)',
    'Uncaught TypeError: cannot read properties of undefined',
    'function(e){return e.map(t=>t.id)}',
    'https://cdn.example.com/lib/some-long-path/file.js',
    'two words',
    'a a a a a a a a a a a',
    '{"a":1,"b":"some value here"}',
    'Invariant failed: something went wrong in the renderer',
  ])('drops: %s', (s) => expect(looksLikeCopy(s)).toBe(false));
  it('extracts copy from a bundle in order, without duplicates, and decodes escapes', () => {
    const out = extractCopyStrings(`${BUNDLE} const dup="We build AI agents that answer your customers 24/7."; const u="Caf\\u00e9 management software for restaurants";`);
    expect(out).toEqual([
      'Custom websites and mobile apps for growing companies',
      'We build AI agents that answer your customers 24/7.',
      'Workflow automation for sales and support',
      'Voice agents that book appointments and qualify inbound leads for your team.',
      'Dashboards that show revenue, churn and pipeline in one place for founders.',
      'Café management software for restaurants',
    ]);
  });
});

describe('finding the script files', () => {
  const base = new URL(`${SITE}/`);
  it('takes only scripts from the same site', () => {
    expect(findScriptUrls(SPA_HTML, base).sort()).toEqual([`${SITE}/assets/index-AbC123xy.js`, `${SITE}/assets/vendor-react-Zz9.js`].sort());
  });
  it('follows lazy-loaded route files of the same site', () => {
    expect(findChunkRefs(BUNDLE, new URL(`${SITE}/assets/index-AbC123xy.js`)).sort()).toEqual([`${SITE}/assets/About-Kq81Zz.js`, `${SITE}/assets/vendor-icons-Xy77Aa.js`].sort());
  });
});

// ---- scanning a script-driven site -----------------------------------------------------------------

describe('site scan: pages built with JavaScript', () => {
  const site = (over: Record<string, Page> = {}) =>
    fakeNet({
      [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nAllow: /\nSitemap: https://elsewhere.invalid/sitemap.xml' },
      [`${SITE}/`]: html(SPA_HTML),
      [`${SITE}/assets/index-AbC123xy.js`]: js(BUNDLE + 'x'.repeat(0)),
      [`${SITE}/assets/About-Kq81Zz.js`]: js('jsx("p",{children:"Our team has ten years of experience in enterprise software."});'),
      [`${SITE}/assets/vendor-react-Zz9.js`]: js('const s="This is library code that must never be read by the scan tool";'),
      [`${SITE}/assets/vendor-icons-Xy77Aa.js`]: js('const s="Library icons that must never be read either by the scan tool";'),
      ...over,
    });

  it('reads the text from the site\'s own scripts, skips libraries, and never touches other sites', async () => {
    const { transport, requests } = site();
    const r = await scanSite(`${SITE}/`, { transport });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const last = r.pages[r.pages.length - 1];
    expect(last.text).toContain('Custom websites and mobile apps for growing companies');
    expect(last.text).toContain('Our team has ten years of experience');
    expect(last.text).not.toMatch(/grid gap-4|TypeError|library code|Library icons/);
    expect(requests.some((u) => u.includes('vendor'))).toBe(false);
    expect(requests.some((u) => u.includes('thirdparty') || u.includes('elsewhere'))).toBe(false);
    expect(r.notes.join(' ')).toMatch(/script file/);
  });
  it('says so when the sitemap in robots.txt is on another address', async () => {
    const r = await scanSite(`${SITE}/`, { transport: site().transport });
    expect(r.ok && r.notes.join(' ')).toMatch(/sitemap named in robots\.txt is on another address \(elsewhere\.invalid\)/);
  });
  it('does not read scripts that robots.txt disallows', async () => {
    const { transport, requests } = site({ [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /assets/' } });
    const r = await scanSite(`${SITE}/`, { transport });
    expect(requests.some((u) => u.includes('/assets/'))).toBe(false);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Paste the text') });
  });
  it('never executes anything: a script that would throw or loop is only read as text', async () => {
    const { transport } = site({ [`${SITE}/assets/index-AbC123xy.js`]: js('throw new Error("boom"); while(true){} ' + BUNDLE) });
    const r = await scanSite(`${SITE}/`, { transport });
    expect(r.ok).toBe(true);
  });
  it('asks for scripts with a size limit, so a huge file is never loaded whole', async () => {
    const limits: number[] = [];
    const { transport } = site();
    const spy: Transport = { resolve: transport.resolve, async get(req) { if (req.url.pathname.endsWith('.js')) limits.push(req.maxBytes); return transport.get(req); } };
    await scanSite(`${SITE}/`, { transport: spy });
    expect(limits.length).toBeGreaterThan(0);
    expect(Math.max(...limits)).toBeLessThanOrEqual(2_000_000);
  });
  it('asks the user to paste text when the scripts hold no readable copy either', async () => {
    const { transport } = fakeNet({
      [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nAllow: /' },
      [`${SITE}/`]: html(SPA_HTML),
      [`${SITE}/assets/index-AbC123xy.js`]: js('const a="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3"; function f(){return 1}'),
    });
    expect(await scanSite(`${SITE}/`, { transport })).toMatchObject({ ok: false, error: expect.stringContaining('Paste the text') });
  });
  it('a script that is served with the wrong type (for example HTML) is refused', async () => {
    const { transport } = site({ [`${SITE}/assets/index-AbC123xy.js`]: html(BUNDLE) });
    const r = await fetchPage(`${SITE}/assets/index-AbC123xy.js`, transport, { userAgent: 'x', accept: 'js' });
    expect(r).toMatchObject({ ok: false, reason: 'unsupported_type' });
  });
});

// ---- pasted text -----------------------------------------------------------------------------------

describe('pasted text', () => {
  let db: Db;
  let n = 0;
  beforeAll(async () => {
    db = await createMemoryDb();
    await migrate(db);
  });
  afterAll(async () => {
    await db.close();
  });
  const llm = (json: unknown): Llm & { calls: number } => {
    const l = { calls: 0, provider: 't', model: 't', async complete() { l.calls += 1; return { text: JSON.stringify(json), inputTokens: 1, outputTokens: 1 }; } };
    return l;
  };
  const answer = { business_summary: 'Acme builds AI automation.', offerings: [{ kind: 'service', name: 'Voice AI agents', description: 'Phone agents', source_url: '(pasted text)' }] };
  const text = 'Voice AI agents for inbound calls and appointment booking. '.repeat(6);

  it('turns pasted text into a draft without fetching anything, and counts as a scan', async () => {
    const ws = await seedOwnerWorkspace(db, `paste-${++n}`);
    const l = llm(answer);
    const r = await analyzePastedText(db, ws, text, { llm: l, ceiling: 100 });
    expect(r).toMatchObject({ ok: true, status: 'draft', offerings: 1 });
    const got = (await getProfile(db, ws))!;
    expect(got.profile).toMatchObject({ website_url: '(pasted text)', status: 'draft' });
    expect(got.offerings[0]).toMatchObject({ name: 'Voice AI agents', source_url: '(pasted text)', confirmed: false });
    expect(await loadConfirmedProfile(db, ws)).toBeNull();
    expect(Number((await db.query<{ n: string }>("select count(*) as n from ai_usage where workspace_id = $1 and kind = 'profile_scan'", [ws])).rows[0].n)).toBe(1);
  });
  it('rejects text that is too short or too long before any AI call', async () => {
    const ws = await seedOwnerWorkspace(db, `paste-${++n}`);
    const l = llm(answer);
    expect(await analyzePastedText(db, ws, 'too short', { llm: l, ceiling: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('at least 200') });
    expect(await analyzePastedText(db, ws, 'x'.repeat(40_000), { llm: l, ceiling: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    expect(l.calls).toBe(0);
  });
  it('keeps the real website address when text is pasted later, and never overwrites a confirmed list', async () => {
    const ws = await seedOwnerWorkspace(db, `paste-${++n}`);
    await db.query("insert into business_profiles (workspace_id, website_url, status) values ($1, 'https://acme.example.com/', 'draft')", [ws]);
    await analyzePastedText(db, ws, text, { llm: llm(answer), ceiling: 100 });
    expect((await getProfile(db, ws))!.profile.website_url).toBe('https://acme.example.com/');
    await confirmProfile(db, ws, 'summary');
    const again = await analyzePastedText(db, ws, text, { llm: llm({ ...answer, offerings: [{ kind: 'service', name: 'Something else', description: '', source_url: null }] }), ceiling: 100 });
    expect(again).toMatchObject({ ok: true, status: 'pending' });
    expect((await loadConfirmedProfile(db, ws))!.offerings.map((o) => o.name)).toEqual(['Voice AI agents']);
  });
  it('respects the monthly AI limit and the answer when nothing is found', async () => {
    const ws = await seedOwnerWorkspace(db, `paste-${++n}`);
    expect(await analyzePastedText(db, ws, text, { llm: llm(answer), ceiling: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('monthly AI limit') });
    expect(await analyzePastedText(db, ws, text, { llm: llm({ business_summary: '', offerings: [] }), ceiling: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('by hand') });
  });
});
