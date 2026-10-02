// Grows the evaluation set (docs/classifier.md section 7): exports the leads the owner labeled in the dashboard to a CSV with
// the same columns as tests/fixtures/labeled.csv, so `npm run eval -- --set live` can measure the classifier on fresh data.
// Only leads with a label are exported. Genuine becomes "y", not genuine becomes "n".

import type { Db } from './db/types';
import { toCsv } from './csv';

export const GOLDEN_HEADER = [
  'id', 'source', 'url', 'text', 'ai_author_type', 'ai_service', 'ai_intent', 'ai_reason',
  'owner_genuine_buyer (y/n)', 'owner_service', 'owner_comment',
];

export async function exportLabeledLeads(db: Db, workspaceId: string): Promise<{ csv: string; count: number; genuine: number }> {
  const r = await db.query<{
    post_id: string; source: string; url: string; text: string; author_type: string; service: string | null; intent_score: number | null;
    reason: string | null; review_label: 'genuine' | 'not_genuine'; notes: string | null;
  }>(
    `select p.id as post_id, p.source, p.url, p.text, c.author_type, c.service, c.intent_score, c.reason, l.review_label, l.notes
       from leads l
       join posts p on p.id = l.post_id and p.workspace_id = l.workspace_id
       join classifications c on c.id = l.classification_id and c.workspace_id = l.workspace_id
      where l.workspace_id = $1 and l.review_label is not null
      order by l.updated_at, l.id`,
    [workspaceId],
  );
  const rows = r.rows.map((x) => [
    x.post_id, x.source, x.url, x.text, x.author_type, x.service, x.intent_score, x.reason,
    x.review_label === 'genuine' ? 'y' : 'n', '', x.notes,
  ]);
  return { csv: toCsv(GOLDEN_HEADER, rows), count: rows.length, genuine: r.rows.filter((x) => x.review_label === 'genuine').length };
}
