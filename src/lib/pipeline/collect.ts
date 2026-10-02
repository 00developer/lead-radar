// Stage 1: collect (docs/architecture.md section 7). The runner, not the collector, writes to the database.
// Re-running is safe: posts are inserted with ON CONFLICT DO NOTHING on (workspace_id, source, external_id).

import type { Db } from '../db/types';
import type { Collector } from '../collectors/types';
import type { WorkspaceContext } from './workspace';

export type CollectLimits = { maxResults: number; maxSpendUsd: number; sinceIso?: string };

export type CollectSummary = {
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  postsReturned: number;
  postsNew: number;
  costUsd: number;
  queriesUsed: number;
  error?: string;
};

export async function runCollect(db: Db, ws: WorkspaceContext, collector: Collector, limits: CollectLimits): Promise<CollectSummary> {
  const keywords = ws.keywords.map((k) => k.term);
  const started = await db.query<{ id: string }>(
    "insert into collector_runs (workspace_id, source, status, keywords_used) values ($1, $2, 'running', $3) returning id",
    [ws.id, collector.id, keywords],
  );
  const runId = started.rows[0].id;

  let result;
  try {
    result = await collector.run({ workspaceId: ws.id, keywords, maxResults: limits.maxResults, maxSpendUsd: limits.maxSpendUsd, sinceIso: limits.sinceIso });
  } catch (err) {
    result = { posts: [], costUsd: 0, queriesUsed: 0, status: 'failed' as const, error: err instanceof Error ? err.message : String(err) };
  }

  let postsNew = 0;
  for (const p of result.posts) {
    const ins = await db.query(
      `insert into posts (workspace_id, run_id, source, external_id, url, text, author_handle, author_name, author_profile_url,
                          author_bio, posted_at, language, reply_count, parent_external_id, matched_keyword, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       on conflict (workspace_id, source, external_id) do nothing`,
      [
        ws.id, runId, p.source, p.externalId, p.url, p.text, p.authorHandle, p.authorName ?? null, p.authorProfileUrl ?? null,
        p.authorBio ?? null, p.postedAt ?? null, p.language ?? null, p.replyCount ?? null, p.parentExternalId ?? null,
        p.matchedKeyword ?? null, JSON.stringify(p.raw ?? null),
      ],
    );
    postsNew += ins.rowCount;
  }

  await db.query(
    `update collector_runs set status = $1, posts_returned = $2, posts_new = $3, queries_used = $4, cost_usd = $5, error = $6, finished_at = now()
      where id = $7 and workspace_id = $8`,
    [result.status, result.posts.length, postsNew, result.queriesUsed, result.costUsd, result.error ?? null, runId, ws.id],
  );

  return { runId, status: result.status, postsReturned: result.posts.length, postsNew, costUsd: result.costUsd, queriesUsed: result.queriesUsed, error: result.error };
}
