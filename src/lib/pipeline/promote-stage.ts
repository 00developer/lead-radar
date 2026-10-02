// Stage 4: promote. Applies the promotion rules (promote.ts) to the current prompt version's classifications.
// Idempotent: leads are upserted on (workspace_id, post_id). A lead the owner already touched (status other than 'new',
// or a review label) is never rewritten.

import type { Db } from '../db/types';
import { decidePromotion } from './promote';
import type { WorkspaceContext } from './workspace';

export type PromoteSummary = { considered: number; leadsCreated: number; leadsUpdated: number; hidden: number };

type Row = {
  id: string;
  post_id: string;
  author_type: 'buyer' | 'seller' | 'spam' | 'irrelevant' | 'unclear';
  intent_score: number | null;
  confidence: string | null; // numeric comes back as text
  language: string | null;
  error: string | null;
  needs_review: boolean;
  fit: 'strong' | 'partial' | 'none' | null;
};

export async function runPromote(db: Db, ws: WorkspaceContext): Promise<PromoteSummary> {
  const summary: PromoteSummary = { considered: 0, leadsCreated: 0, leadsUpdated: 0, hidden: 0 };
  const rows = await db.query<Row>(
    `select id, post_id, author_type, intent_score, confidence, language, error, needs_review, fit
       from classifications where workspace_id = $1 and prompt_version = $2 order by created_at, id`,
    [ws.id, ws.promptVersion],
  );

  for (const c of rows.rows) {
    summary.considered += 1;
    const d = decidePromotion(
      {
        authorType: c.author_type,
        intentScore: c.intent_score,
        confidence: c.confidence === null ? null : Number(c.confidence),
        language: c.language,
        error: c.error,
        fit: c.fit,
      },
      { leadThreshold: ws.settings.leadThreshold, allowedLanguages: ws.settings.allowedLanguages },
    );

    if (c.needs_review !== d.needsReview) {
      await db.query('update classifications set needs_review = $1 where id = $2 and workspace_id = $3', [d.needsReview, c.id, ws.id]);
    }
    if (!d.isLead) {
      summary.hidden += 1;
      continue;
    }
    const up = await db.query<{ inserted: boolean }>(
      `insert into leads (workspace_id, post_id, classification_id, needs_review) values ($1,$2,$3,$4)
       on conflict (workspace_id, post_id) do update
          set classification_id = excluded.classification_id, needs_review = excluded.needs_review, updated_at = now()
        where leads.status = 'new' and leads.review_label is null
          and (leads.classification_id, leads.needs_review) is distinct from (excluded.classification_id, excluded.needs_review)
       returning (xmax = 0) as inserted`,
      [ws.id, c.post_id, c.id, d.needsReview],
    );
    if (up.rows[0]) {
      if (up.rows[0].inserted) summary.leadsCreated += 1;
      else summary.leadsUpdated += 1;
    }
  }
  return summary;
}
