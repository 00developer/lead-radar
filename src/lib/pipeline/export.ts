// Exports leads (Phase 1 acceptance: the fields of the lead card in docs/design.md). The data is loaded once here and used for
// both the CSV script and the Excel download in the dashboard (export-xlsx.ts).
// Optionally also exports the posts the AI hid, so the owner can spot buyers it missed ("Hidden by AI").

import type { Db } from '../db/types';
import { toCsv } from '../csv';
import { decidePromotion } from './promote';
import type { WorkspaceContext } from './workspace';

const HEADER = [
  'kind', 'lead_id', 'status', 'needs_review', 'created_at', 'author_handle', 'author_name', 'profile_url', 'post_url', 'posted_at',
  'source', 'matched_keyword', 'text', 'ai_type', 'service', 'intent', 'urgency', 'budget', 'timeline', 'language', 'reason',
  'confidence', 'reply_draft', 'review_label', 'notes', 'hidden_reason',
];

export type ExportLead = {
  lead_id: string; status: string; needs_review: boolean; created_at: Date | string; review_label: string | null; notes: string | null;
  reply_draft_edited: string | null; author_handle: string; author_name: string | null; author_profile_url: string | null; author_bio: string | null;
  post_url: string; posted_at: Date | string | null; source: string; matched_keyword: string | null; text: string; author_type: string;
  service: string | null; intent_score: number | null; urgency: string | null; budget: string | null; timeline: string | null;
  language: string | null; reason: string | null; confidence: number | string | null; reply_draft: string | null;
};

export type ExportHidden = {
  author_handle: string; author_name: string | null; author_profile_url: string | null; post_url: string; posted_at: Date | string | null;
  source: string; matched_keyword: string | null; text: string; author_type: string; service: string | null; intent_score: number | null;
  urgency: string | null; budget: string | null; timeline: string | null; language: string | null; reason: string | null;
  confidence: number | string | null; hidden_reason: string;
};

/**
 * Loads the rows of one workspace. `limit` caps the rows of each part (the dashboard download uses it to stay under the hosting
 * response size limit); the CLI passes none.
 */
export async function loadExportRows(
  db: Db, ws: WorkspaceContext, opts: { includeHidden?: boolean; limit?: number } = {},
): Promise<{ leads: ExportLead[]; hidden: ExportHidden[] }> {
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : null;
  const leads = await db.query<ExportLead>(
    `select l.id as lead_id, l.status, l.needs_review, l.created_at, l.review_label, l.notes, l.reply_draft_edited,
            p.author_handle, p.author_name, p.author_profile_url, p.author_bio, p.url as post_url, p.posted_at, p.source, p.matched_keyword, p.text,
            c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language, c.reason, c.confidence, c.reply_draft
       from leads l
       join posts p on p.id = l.post_id and p.workspace_id = l.workspace_id
       join classifications c on c.id = l.classification_id and c.workspace_id = l.workspace_id
      where l.workspace_id = $1
      order by c.intent_score desc nulls last, l.created_at desc
      limit $2`,
    [ws.id, limit],
  );

  const hidden: ExportHidden[] = [];
  if (opts.includeHidden) {
    const h = await db.query<Record<string, unknown>>(
      `select p.author_handle, p.author_name, p.author_profile_url, p.url as post_url, p.posted_at, p.source, p.matched_keyword, p.text,
              c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language, c.reason, c.confidence, c.error
         from classifications c
         join posts p on p.id = c.post_id and p.workspace_id = c.workspace_id
        where c.workspace_id = $1 and c.prompt_version = $2
          and not exists (select 1 from leads l where l.post_id = c.post_id and l.workspace_id = c.workspace_id)
        order by c.intent_score desc nulls last
        limit $3`,
      [ws.id, ws.promptVersion, limit],
    );
    for (const r of h.rows) {
      const d = decidePromotion(
        {
          authorType: r.author_type as 'buyer' | 'seller' | 'spam' | 'irrelevant' | 'unclear',
          intentScore: r.intent_score as number | null,
          confidence: r.confidence === null ? null : Number(r.confidence),
          language: r.language as string | null,
          error: r.error as string | null,
        },
        { leadThreshold: ws.settings.leadThreshold, allowedLanguages: ws.settings.allowedLanguages },
      );
      hidden.push({ ...(r as Omit<ExportHidden, 'hidden_reason'>), hidden_reason: d.hiddenReason ?? '' });
    }
  }
  return { leads: leads.rows, hidden };
}

export async function exportLeadsCsv(db: Db, ws: WorkspaceContext, opts: { includeHidden?: boolean; limit?: number } = {}): Promise<{ csv: string; leads: number; hidden: number }> {
  const { leads, hidden } = await loadExportRows(db, ws, opts);
  const rows: unknown[][] = leads.map((r) => [
    'lead', r.lead_id, r.status, r.needs_review, r.created_at, r.author_handle, r.author_name, r.author_profile_url, r.post_url, r.posted_at,
    r.source, r.matched_keyword, r.text, r.author_type, r.service, r.intent_score, r.urgency, r.budget, r.timeline, r.language, r.reason,
    r.confidence, r.reply_draft_edited ?? r.reply_draft, r.review_label, r.notes, '',
  ]);
  for (const r of hidden) {
    rows.push([
      'hidden', '', '', '', '', r.author_handle, r.author_name, r.author_profile_url, r.post_url, r.posted_at, r.source, r.matched_keyword,
      r.text, r.author_type, r.service, r.intent_score, r.urgency, r.budget, r.timeline, r.language, r.reason, r.confidence, '', '', '',
      r.hidden_reason,
    ]);
  }
  return { csv: toCsv(HEADER, rows), leads: leads.length, hidden: hidden.length };
}
