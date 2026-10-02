// Stage 2: pre-filter. Only touches posts with prefilter_status = 'pending', so re-running does nothing new.

import type { Db } from '../db/types';
import { normalizeForDedupe, prefilterPost, type PrefilterStatus } from './prefilter';
import type { WorkspaceContext } from './workspace';

export type PrefilterSummary = Record<PrefilterStatus, number> & { processed: number };

type PendingRow = { id: string; text: string; posted_at: Date | null; author_handle: string };

export async function runPrefilter(db: Db, ws: WorkspaceContext, now: Date = new Date()): Promise<PrefilterSummary> {
  const summary: PrefilterSummary = {
    processed: 0, passed: 0, dropped_short: 0, dropped_language: 0, dropped_old: 0, dropped_negative_keyword: 0, dropped_duplicate: 0,
  };

  const pending = await db.query<PendingRow>(
    "select id, text, posted_at, author_handle from posts where workspace_id = $1 and prefilter_status = 'pending' order by collected_at, id",
    [ws.id],
  );
  if (pending.rows.length === 0) return summary;

  // Duplicate rule: the same author posting the same text again. Seed with posts of these authors that already passed.
  const authors = [...new Set(pending.rows.map((r) => r.author_handle))];
  const passedBefore = await db.query<{ author_handle: string; text: string }>(
    "select author_handle, text from posts where workspace_id = $1 and prefilter_status = 'passed' and author_handle = any($2)",
    [ws.id, authors],
  );
  const seen = new Set(passedBefore.rows.map((r) => `${r.author_handle}|${normalizeForDedupe(r.text)}`));

  for (const row of pending.rows) {
    let verdict = prefilterPost(
      { text: row.text, postedAt: row.posted_at ? new Date(row.posted_at) : null },
      { now, maxAgeDays: ws.settings.maxPostAgeDays, negativeTerms: ws.negativeTerms },
    );
    if (verdict.status === 'passed') {
      const key = `${row.author_handle}|${normalizeForDedupe(row.text)}`;
      if (seen.has(key)) verdict = { status: 'dropped_duplicate', reason: 'same author posted the same text before' };
      else seen.add(key);
    }
    await db.query('update posts set prefilter_status = $1, prefilter_reason = $2 where id = $3 and workspace_id = $4', [
      verdict.status, verdict.reason, row.id, ws.id,
    ]);
    summary.processed += 1;
    summary[verdict.status] += 1;
  }
  return summary;
}
