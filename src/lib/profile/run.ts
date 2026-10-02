// Runs the two Business Profile jobs that call the network and the AI: scanning a website and suggesting keywords.
// Both count against the monthly AI ceiling, and scans are limited per day.

import type { Db } from '../db/types';
import type { Llm } from '../classifier/llm';
import { LlmQuotaError } from '../classifier/llm';
import { extractOfferings, suggestKeywords } from './extract';
import { scanSite } from './scan';
import type { Transport } from './safe-fetch';
import { getProfile, MAX_SCANS_PER_DAY, saveScan, saveSuggestions, scansToday } from './store';

export type ScanOutcome =
  | { ok: true; status: 'draft' | 'pending'; offerings: number; pages: number; notes: string[] }
  | { ok: false; error: string };

async function allowAiCall(db: Db, workspaceId: string, kind: string, ceiling: number): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>('select try_record_ai_usage($1, $2, $3) as ok', [workspaceId, kind, ceiling]);
  return r.rows[0].ok;
}

export async function scanWebsiteForProfile(
  db: Db,
  workspaceId: string,
  url: string,
  deps: { transport: Transport; llm: Llm; appUrl?: string; ceiling: number; maxPages?: number },
): Promise<ScanOutcome> {
  if ((await scansToday(db, workspaceId)) >= MAX_SCANS_PER_DAY) {
    return { ok: false, error: `The limit of ${MAX_SCANS_PER_DAY} website scans per day is reached. Try again tomorrow or add offerings by hand.` };
  }
  const scan = await scanSite(url, { transport: deps.transport, appUrl: deps.appUrl, maxPages: deps.maxPages });
  if (!scan.ok) return { ok: false, error: scan.error };

  if (!(await allowAiCall(db, workspaceId, 'profile_scan', deps.ceiling))) {
    return { ok: false, error: 'The monthly AI limit is reached. Nothing was analysed.' };
  }
  let extraction;
  try {
    extraction = await extractOfferings(deps.llm, scan.pages);
  } catch (e) {
    return { ok: false, error: e instanceof LlmQuotaError ? e.message : e instanceof Error ? e.message : 'The AI step failed.' };
  }
  if (extraction.offerings.length === 0) {
    return { ok: false, error: 'The pages do not say what the company sells, so nothing was found. Add your products and services by hand.' };
  }
  const status = await saveScan(db, workspaceId, {
    url: scan.pages[0].url,
    summary: extraction.summary,
    offerings: extraction.offerings,
    pages: scan.pages.map((p) => p.url),
    notes: scan.notes,
  });
  return { ok: true, status, offerings: extraction.offerings.length, pages: scan.pages.length, notes: scan.notes };
}

export async function suggestKeywordsForProfile(db: Db, workspaceId: string, deps: { llm: Llm; ceiling: number }): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const got = await getProfile(db, workspaceId);
  const confirmed = got?.offerings.filter((o) => o.confirmed) ?? [];
  if (!got || got.profile.status !== 'confirmed' || confirmed.length === 0) return { ok: false, error: 'Confirm your products and services first. Keywords are suggested from the confirmed list.' };
  if (!(await allowAiCall(db, workspaceId, 'profile_keywords', deps.ceiling))) return { ok: false, error: 'The monthly AI limit is reached.' };

  const services = (await db.query<{ slug: string; name: string }>('select slug, name from workspace_services where workspace_id = $1 and enabled order by created_at', [workspaceId])).rows;
  const existing = (await db.query<{ term: string }>('select term from keywords where workspace_id = $1 union select term from keyword_suggestions where workspace_id = $1', [workspaceId])).rows.map((r) => r.term);
  try {
    const list = await suggestKeywords(deps.llm, { summary: got.profile.business_summary, offerings: confirmed.map((o) => ({ name: o.name, description: o.description })), services, existingTerms: existing });
    return { ok: true, added: await saveSuggestions(db, workspaceId, list) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The AI step failed.' };
  }
}

const MIN_PASTED_CHARS = 200;
const MAX_PASTED_CHARS = 30_000;

/**
 * The user pastes the text of their services page (the way that always works, also for sites that hide their text behind
 * JavaScript). No website is fetched. It counts as a scan for the daily limit and against the monthly AI ceiling.
 */
export async function analyzePastedText(db: Db, workspaceId: string, text: string, deps: { llm: Llm; ceiling: number }): Promise<ScanOutcome> {
  const clean = text.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (clean.length < MIN_PASTED_CHARS) return { ok: false, error: `Paste at least ${MIN_PASTED_CHARS} characters, for example the text of your services page.` };
  if (clean.length > MAX_PASTED_CHARS) return { ok: false, error: `That is too long. Paste at most ${MAX_PASTED_CHARS} characters.` };
  if ((await scansToday(db, workspaceId)) >= MAX_SCANS_PER_DAY) {
    return { ok: false, error: `The limit of ${MAX_SCANS_PER_DAY} scans per day is reached. Try again tomorrow or add offerings by hand.` };
  }
  if (!(await allowAiCall(db, workspaceId, 'profile_scan', deps.ceiling))) return { ok: false, error: 'The monthly AI limit is reached. Nothing was analysed.' };

  const pastedUrl = '(pasted text)';
  let extraction;
  try {
    extraction = await extractOfferings(deps.llm, [{ url: pastedUrl, title: 'Text pasted by the user', description: '', text: clean }]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The AI step failed.' };
  }
  if (extraction.offerings.length === 0) return { ok: false, error: 'The text does not say what the company sells, so nothing was found. Add your products and services by hand.' };

  // Keep the real website address if the profile already has one.
  const existing = await getProfile(db, workspaceId);
  const url = existing && !existing.profile.website_url.startsWith('(') ? existing.profile.website_url : pastedUrl;
  const status = await saveScan(db, workspaceId, { url, summary: extraction.summary, offerings: extraction.offerings, pages: [pastedUrl], notes: ['Analysed from text pasted by the user.'] });
  return { ok: true, status, offerings: extraction.offerings.length, pages: 1, notes: [] };
}
