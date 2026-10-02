// Exports leads to CSV (Phase 1 acceptance: the fields of the lead card in docs/design.md, except contact hints).
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

type LeadRow = Record<string, unknown> & { lead_id: string };

export async function exportLeadsCsv(db: Db, ws: WorkspaceContext, opts: { includeHidden?: boolean } = {}): Promise<{ csv: string; leads: number; hidden: number }> {
  const leads = await db.query<LeadRow>(
    `select l.id as lead_id, l.status, l.needs_review, l.created_at, l.review_label, l.notes, l.reply_draft_edited,
            p.author_handle, p.author_name, p.author_profile_url, p.url as post_url, p.posted_at, p.source, p.matched_keyword, p.text,
            c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language, c.reason, c.confidence, c.reply_draft
       from leads l
       join posts p on p.id = l.post_id and p.workspace_id = l.workspace_id
       join classifications c on c.id = l.classification_id and c.workspace_id = l.workspace_id
      where l.workspace_id = $1
      order by c.intent_score desc nulls last, l.created_at desc`,
    [ws.id],
  );

  const rows: unknown[][] = leads.rows.map((r) => [
    'lead', r.lead_id, r.status, r.needs_review, r.created_at, r.author_handle, r.author_name, r.author_profile_url, r.post_url, r.posted_at,
    r.source, r.matched_keyword, r.text, r.author_type, r.service, r.intent_score, r.urgency, r.budget, r.timeline, r.language, r.reason,
    r.confidence, r.reply_draft_edited ?? r.reply_draft, r.review_label, r.notes, '',
  ]);

  let hidden = 0;
  if (opts.includeHidden) {
    const h = await db.query<Record<string, unknown>>(
      `select p.author_handle, p.author_name, p.author_profile_url, p.url as post_url, p.posted_at, p.source, p.matched_keyword, p.text,
              c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language, c.reason, c.confidence, c.error
         from classifications c
         join posts p on p.id = c.post_id and p.workspace_id = c.workspace_id
        where c.workspace_id = $1 and c.prompt_version = $2
          and not exists (select 1 from leads l where l.post_id = c.post_id and l.workspace_id = c.workspace_id)
        order by c.intent_score desc nulls last`,
      [ws.id, ws.promptVersion],
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
      rows.push([
        'hidden', '', '', '', '', r.author_handle, r.author_name, r.author_profile_url, r.post_url, r.posted_at, r.source, r.matched_keyword,
        r.text, r.author_type, r.service, r.intent_score, r.urgency, r.budget, r.timeline, r.language, r.reason, r.confidence, '', '', '',
        d.hiddenReason ?? '',
      ]);
      hidden += 1;
    }
  }
  return { csv: toCsv(HEADER, rows), leads: leads.rows.length, hidden };
}
