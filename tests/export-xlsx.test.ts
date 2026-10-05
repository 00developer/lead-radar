import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildLeadsWorkbook, clean, safeUrl } from '../src/lib/pipeline/export-xlsx';
import type { ExportHidden, ExportLead } from '../src/lib/pipeline/export';

function lead(over: Partial<ExportLead> = {}): ExportLead {
  return {
    lead_id: 'l1', status: 'new', needs_review: false, created_at: new Date('2026-10-03T06:31:05Z'), review_label: null, notes: null,
    reply_draft_edited: null, author_handle: 'asha', author_name: 'Asha', author_profile_url: 'https://www.threads.com/@asha', author_bio: null,
    post_url: 'https://www.threads.com/@asha/post/1', posted_at: new Date('2026-10-02T10:15:00Z'), source: 'apify_threads', matched_keyword: 'need a website',
    text: 'I need a website for my shop.\nBudget 300 dollars. Mail me at asha@example.com or call +91 98765 43210', author_type: 'buyer', service: 'web_dev',
    intent_score: 95, urgency: 'medium', budget: '300 dollars', timeline: null, language: 'en', reason: 'Clear request to hire', confidence: '0.98', reply_draft: 'Hi Asha!',
    ...over,
  };
}
const hiddenPost = (): ExportHidden => ({
  author_handle: 'dev1', author_name: null, author_profile_url: null, post_url: 'https://www.threads.com/@dev1/post/2', posted_at: null, source: 'threads_api',
  matched_keyword: null, text: 'I build websites, DM me', author_type: 'seller', service: null, intent_score: 10, urgency: null, budget: null, timeline: null,
  language: 'en', reason: 'Offers a service', confidence: 0.9, hidden_reason: 'classified as seller',
});

async function open(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

describe('Excel export', () => {
  it('writes readable headers, a frozen header row, a filter and real numbers and dates', async () => {
    const wb = await open(await buildLeadsWorkbook({ leads: [lead({ review_label: 'genuine', notes: 'called Monday' })], hidden: [] }, { workspaceName: 'My company', includeHidden: false }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Leads', 'About this file']);
    const ws = wb.getWorksheet('Leads')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 8)).toEqual(['Intent (0-100)', 'Author', 'Name', 'Service', 'Status', 'Your label', 'Post', 'Open post']);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, xSplit: 2 });
    expect(ws.autoFilter).toBeTruthy();
    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe(95); // a number, so Excel can sort and filter it
    expect(row.getCell(6).value).toBe('Genuine');
    expect(row.getCell(9).value).toBeInstanceOf(Date);
    expect((row.getCell(9).value as Date).toISOString()).toBe('2026-10-02T10:15:00.000Z');
    expect(row.getCell(7).alignment?.wrapText).toBe(true);
    expect(String(row.getCell(7).value)).toContain('\n'); // line breaks stay inside the one cell
    const all = (row.values as unknown[]).map((v) => (typeof v === 'object' && v && 'text' in v ? (v as { text: string }).text : v));
    expect(all).toContain('called Monday');
    expect(all).toContain('Threads (Apify)');
  });

  it('makes author and post links clickable, but only for http(s) addresses', async () => {
    const wb = await open(
      await buildLeadsWorkbook({ leads: [lead(), lead({ author_profile_url: 'javascript:alert(1)', post_url: 'file:///C:/secret.txt', author_handle: 'bad' })], hidden: [] }, { workspaceName: 'W', includeHidden: false }),
    );
    const ws = wb.getWorksheet('Leads')!;
    expect(ws.getRow(2).getCell(2).value).toMatchObject({ text: '@asha', hyperlink: 'https://www.threads.com/@asha' });
    expect(ws.getRow(2).getCell(8).value).toMatchObject({ text: 'Open post', hyperlink: 'https://www.threads.com/@asha/post/1' });
    expect(typeof ws.getRow(3).getCell(2).value).toBe('string'); // plain text, no link
    expect(typeof ws.getRow(3).getCell(8).value).toBe('string');
    expect(safeUrl('https://x.test/a b')).toBe('https://x.test/a%20b');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
  });

  it('never turns post text into a formula', async () => {
    const evil = '=HYPERLINK("http://evil.test","click")';
    const wb = await open(await buildLeadsWorkbook({ leads: [lead({ text: evil, notes: '+SUM(1,1)', author_name: '@cmd|calc' })], hidden: [] }, { workspaceName: 'W', includeHidden: false }));
    const ws = wb.getWorksheet('Leads')!;
    const post = ws.getRow(2).getCell(7);
    expect(post.type).toBe(ExcelJS.ValueType.String);
    expect(post.value).toBe(evil);
    expect(ws.getRow(2).getCell(16).type).toBe(ExcelJS.ValueType.String);
    // No cell anywhere holds a formula.
    ws.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
  });

  it('removes characters Excel cannot store and survives very long text', async () => {
    expect(clean('a\u0000b\u0008c\u000Bd\ne')).toBe('abcd\ne');
    const wb = await open(await buildLeadsWorkbook({ leads: [lead({ text: `x\u0000${'y'.repeat(40_000)}` })], hidden: [] }, { workspaceName: 'W', includeHidden: false }));
    expect(String(wb.getWorksheet('Leads')!.getRow(2).getCell(7).value).length).toBeLessThanOrEqual(32_000);
  });

  it('shows contact details the author wrote publicly', async () => {
    const wb = await open(await buildLeadsWorkbook({ leads: [lead()], hidden: [] }, { workspaceName: 'W', includeHidden: false }));
    const contact = String(wb.getWorksheet('Leads')!.getRow(2).getCell(14).value);
    expect(contact).toContain('Email: asha@example.com');
    expect(contact).toContain('Phone: +91 98765 43210');
  });

  it('adds the hidden-by-AI sheet only when asked, and an About sheet', async () => {
    const withHidden = await open(await buildLeadsWorkbook({ leads: [lead()], hidden: [hiddenPost()] }, { workspaceName: 'Acme', includeHidden: true, capped: true }));
    expect(withHidden.worksheets.map((w) => w.name)).toEqual(['Leads', 'Hidden by AI', 'About this file']);
    const h = withHidden.getWorksheet('Hidden by AI')!;
    expect(h.getRow(2).getCell(1).value).toBe('Seller');
    expect(h.getRow(2).getCell(8).value).toBe('classified as seller');
    const about = withHidden.getWorksheet('About this file')!;
    const text = (about.getSheetValues() as unknown[]).flat().map(String).join(' | ');
    expect(text).toContain('Acme');
    expect(text).toContain('first 2,000 rows');
    const without = await open(await buildLeadsWorkbook({ leads: [lead()], hidden: [hiddenPost()] }, { workspaceName: 'Acme', includeHidden: false }));
    expect(without.getWorksheet('Hidden by AI')).toBeUndefined();
  });

  it('colours the intent cell by band and handles an empty list', async () => {
    const wb = await open(await buildLeadsWorkbook({ leads: [lead({ intent_score: 85 }), lead({ intent_score: 65 }), lead({ intent_score: 20 })], hidden: [] }, { workspaceName: 'W', includeHidden: false }));
    const ws = wb.getWorksheet('Leads')!;
    const colour = (r: number) => (ws.getRow(r).getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb;
    expect([colour(2), colour(3), colour(4)]).toEqual(['FFD6F5E3', 'FFFDF0CF', 'FFEAECF5']);
    const empty = await open(await buildLeadsWorkbook({ leads: [], hidden: [] }, { workspaceName: 'W', includeHidden: false }));
    expect(empty.getWorksheet('Leads')!.rowCount).toBe(1); // header only
  });
});
