// Builds the Excel (.xlsx) download of the leads: readable column names, one lead per row, wrapped post text, clickable links,
// a filter on every column and a frozen header. Post text is untrusted: every cell is written as text (never as a formula), so a
// post that starts with "=" is shown as it is and nothing runs in Excel.

import ExcelJS from 'exceljs';
import { extractContactHints } from '../contact-hints';
import type { ExportHidden, ExportLead } from './export';

type Cell = string | number | Date | { text: string; hyperlink: string } | null;
type Col<T> = { header: string; width: number; wrap?: boolean; value: (r: T) => Cell; kind?: 'intent' | 'label' | 'date' | 'confidence' | 'link' };

const INDIGO = 'FF4F5BFF';
const SOURCE: Record<string, string> = { apify_threads: 'Threads (Apify)', threads_api: 'Threads (official API)' };
const LABEL: Record<string, string> = { genuine: 'Genuine', not_genuine: 'Not genuine' };
const TYPE: Record<string, string> = { buyer: 'Buyer', seller: 'Seller', spam: 'Spam', irrelevant: 'Not relevant', unclear: 'Unclear' };

/** Removes characters that are not allowed in an Excel file and keeps inside Excel's 32,767 character cell limit. */
export function clean(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').slice(0, 32000);
}

/** Only real http(s) addresses become clickable links. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : clean(v));

function link(label: string | null, url: string | null | undefined): Cell {
  const href = safeUrl(url);
  if (!label) return null;
  return href ? { text: clean(label), hyperlink: href } : clean(label);
}

function contactText(lead: ExportLead): string | null {
  const h = extractContactHints(lead.text, lead.author_bio);
  const parts = [...h.emails.map((e) => `Email: ${e}`), ...h.phones.map((p) => `Phone: ${p}`), ...(h.whatsapp ? ['Mentions WhatsApp'] : [])];
  return parts.length ? parts.join('\n') : null;
}

const LEAD_COLUMNS: Col<ExportLead>[] = [
  { header: 'Intent (0-100)', width: 11, kind: 'intent', value: (r) => num(r.intent_score) },
  { header: 'Author', width: 22, kind: 'link', value: (r) => link(`@${r.author_handle}`, r.author_profile_url ?? `https://www.threads.com/@${r.author_handle}`) },
  { header: 'Name', width: 20, value: (r) => text(r.author_name) },
  { header: 'Service', width: 15, value: (r) => text(r.service) },
  { header: 'Status', width: 12, value: (r) => text(r.status) },
  { header: 'Your label', width: 13, kind: 'label', value: (r) => (r.review_label ? LABEL[r.review_label] ?? r.review_label : null) },
  { header: 'Post', width: 60, wrap: true, value: (r) => text(r.text) },
  { header: 'Open post', width: 12, kind: 'link', value: (r) => link('Open post', r.post_url) },
  { header: 'Posted (UTC)', width: 17, kind: 'date', value: (r) => asDate(r.posted_at) },
  { header: 'Why the AI picked it', width: 42, wrap: true, value: (r) => text(r.reason) },
  { header: 'Budget', width: 14, wrap: true, value: (r) => text(r.budget) },
  { header: 'Timeline', width: 14, wrap: true, value: (r) => text(r.timeline) },
  { header: 'Urgency', width: 10, value: (r) => text(r.urgency) },
  { header: 'Contact found in the post or bio', width: 30, wrap: true, value: contactText },
  { header: 'Reply draft (not sent)', width: 50, wrap: true, value: (r) => text(r.reply_draft_edited ?? r.reply_draft) },
  { header: 'Your notes', width: 32, wrap: true, value: (r) => text(r.notes) },
  { header: 'Needs review', width: 11, value: (r) => (r.needs_review ? 'Yes' : null) },
  { header: 'Language', width: 10, value: (r) => text(r.language) },
  { header: 'AI confidence', width: 11, kind: 'confidence', value: (r) => num(r.confidence) },
  { header: 'Matched keyword', width: 20, value: (r) => text(r.matched_keyword) },
  { header: 'Source', width: 20, value: (r) => SOURCE[r.source] ?? text(r.source) },
  { header: 'Added to Lead Radar (UTC)', width: 19, kind: 'date', value: (r) => asDate(r.created_at) },
];

const HIDDEN_COLUMNS: Col<ExportHidden>[] = [
  { header: 'AI says', width: 13, value: (r) => TYPE[r.author_type] ?? text(r.author_type) },
  { header: 'Intent (0-100)', width: 11, kind: 'intent', value: (r) => num(r.intent_score) },
  { header: 'Author', width: 22, kind: 'link', value: (r) => link(`@${r.author_handle}`, r.author_profile_url ?? `https://www.threads.com/@${r.author_handle}`) },
  { header: 'Name', width: 20, value: (r) => text(r.author_name) },
  { header: 'Post', width: 60, wrap: true, value: (r) => text(r.text) },
  { header: 'Open post', width: 12, kind: 'link', value: (r) => link('Open post', r.post_url) },
  { header: 'Posted (UTC)', width: 17, kind: 'date', value: (r) => asDate(r.posted_at) },
  { header: 'Why it was hidden', width: 36, wrap: true, value: (r) => text(r.hidden_reason) },
  { header: 'AI reason', width: 42, wrap: true, value: (r) => text(r.reason) },
  { header: 'Service', width: 15, value: (r) => text(r.service) },
  { header: 'Language', width: 10, value: (r) => text(r.language) },
  { header: 'AI confidence', width: 11, kind: 'confidence', value: (r) => num(r.confidence) },
  { header: 'Matched keyword', width: 20, value: (r) => text(r.matched_keyword) },
  { header: 'Source', width: 20, value: (r) => SOURCE[r.source] ?? text(r.source) },
];

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** Rough number of lines a wrapped cell needs, so the row is tall enough to read without being huge. */
function lines(value: Cell, width: number): number {
  if (typeof value !== 'string') return 1;
  const perLine = Math.max(8, Math.floor(width * 1.05));
  return value.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

function addSheet<T>(wb: ExcelJS.Workbook, name: string, cols: Col<T>[], rows: T[], freezeColumns: number) {
  const sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: freezeColumns, ySplit: 1 }] });
  sheet.columns = cols.map((c) => ({ header: c.header, width: c.width }));

  const head = sheet.getRow(1);
  head.height = 32;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(INDIGO);
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  for (const r of rows) {
    const values = cols.map((c) => c.value(r));
    const row = sheet.addRow(values);
    let maxLines = 1;
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: c.kind === 'intent' || c.kind === 'confidence' ? 'center' : 'left' };
      if (c.wrap) maxLines = Math.max(maxLines, lines(values[i], c.width));
      const v = values[i];
      if (c.kind === 'date' && v instanceof Date) cell.numFmt = 'dd mmm yyyy hh:mm';
      if (c.kind === 'confidence' && typeof v === 'number') cell.numFmt = '0.00';
      if (c.kind === 'link' && v && typeof v === 'object' && 'hyperlink' in v) cell.font = { color: { argb: 'FF1A56DB' }, underline: true };
      if (c.kind === 'intent' && typeof v === 'number') {
        cell.fill = fill(v >= 80 ? 'FFD6F5E3' : v >= 60 ? 'FFFDF0CF' : 'FFEAECF5');
        cell.font = { bold: true };
      }
      if (c.kind === 'label' && v === 'Genuine') cell.fill = fill('FFD6F5E3');
      if (c.kind === 'label' && v === 'Not genuine') cell.fill = fill('FFFDE3E0');
    });
    row.height = Math.min(210, Math.max(20, maxLines * 14.5 + 4));
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return sheet;
}

function addAbout(wb: ExcelJS.Workbook, info: { workspaceName: string; leads: number; hidden: number | null; capped: boolean; generatedAt: Date }) {
  const sheet = wb.addWorksheet('About this file');
  sheet.columns = [{ width: 28 }, { width: 90 }];
  const rows: [string, string][] = [
    ['Lead Radar export', clean(info.workspaceName)],
    ['Created (UTC)', info.generatedAt.toISOString().replace('T', ' ').slice(0, 16)],
    ['Leads in this file', String(info.leads)],
    ...(info.hidden !== null ? ([['Hidden by AI', `${info.hidden} posts the AI read but did not turn into leads (second sheet)`]] as [string, string][]) : []),
    ...(info.capped ? ([['Note', 'The file is limited to the first 2,000 rows of each sheet, highest intent first. Use the filters in Lead Radar to export a smaller set.']] as [string, string][]) : []),
    ['Order', 'Highest intent first. Use the arrow on each column header to filter or sort.'],
    ['Intent colours', 'Green 80 and above, yellow 60 to 79, grey below 60.'],
    ['Contact', 'Lead Radar never contacts anyone. Contact details appear only when the author wrote them in a public post or bio. Otherwise reply under the post or send a message by hand.'],
    ['Dates', 'All times are UTC.'],
  ];
  rows.forEach(([a, b], i) => {
    const row = sheet.addRow([a, b]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).alignment = { vertical: 'top' };
    if (i === 0) row.getCell(1).font = { bold: true, size: 14, color: { argb: INDIGO } };
  });
}

export async function buildLeadsWorkbook(
  data: { leads: ExportLead[]; hidden: ExportHidden[] },
  opts: { workspaceName: string; includeHidden: boolean; capped?: boolean; now?: Date },
): Promise<Buffer> {
  const generatedAt = opts.now ?? new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lead Radar';
  wb.created = generatedAt;
  addSheet(wb, 'Leads', LEAD_COLUMNS, data.leads, 2);
  if (opts.includeHidden) addSheet(wb, 'Hidden by AI', HIDDEN_COLUMNS, data.hidden, 3);
  addAbout(wb, { workspaceName: opts.workspaceName, leads: data.leads.length, hidden: opts.includeHidden ? data.hidden.length : null, capped: !!opts.capped, generatedAt });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
