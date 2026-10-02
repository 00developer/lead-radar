// End-to-end test of the OFFICIAL Threads search before Meta approves it (docs/memory.md, Phase 3).
// It searches with a development token, in test mode (the token owner's own posts are allowed), and runs the normal pipeline in a
// THROWAWAY in-memory database: the owner's real database is not touched and no lead is stored anywhere.
// Idea: write a test post like "I need a website developer for my shop, budget 300 dollars" from a Threads tester account, run
// this, and see that the official search finds it and the AI turns it into a lead.

import { createMemoryDb } from '../db/memory';
import { migrate } from '../db/migrate';
import { createThreadsApiCollector, type FetchLike } from '../collectors/threads-api';
import type { Llm } from '../classifier/llm';
import { runPipelineOnce } from '../pipeline/run-all';
import { loadWorkspace } from '../pipeline/workspace';
import { seedOwnerWorkspace } from '../seed';

export type E2eResult = {
  found: number;
  prefilterPassed: number;
  classified: number;
  leads: { handle: string; intent: number | null; service: string | null; reason: string | null; text: string }[];
  hidden: { handle: string; type: string; why: string; text: string }[];
};

export async function runThreadsE2e(o: {
  accessToken: string;
  ownUsername: string;
  llm: Llm;
  keywords?: string[];
  fetchFn?: FetchLike;
  /** Test posts can be new; the age limit of the workspace is ignored here. */
  maxResults?: number;
}): Promise<E2eResult> {
  const db = await createMemoryDb();
  try {
    await migrate(db);
    const wsId = await seedOwnerWorkspace(db, 'threads-e2e');
    await db.query('update workspace_settings set max_post_age_days = 3650 where workspace_id = $1', [wsId]);
    if (o.keywords) {
      await db.query('update keywords set enabled = false where workspace_id = $1 and not is_negative', [wsId]);
      for (const k of o.keywords) {
        await db.query("insert into keywords (workspace_id, term, language) values ($1,$2,'en') on conflict (workspace_id, term, is_negative) do update set enabled = true", [wsId, k]);
      }
    }
    const collector = createThreadsApiCollector({ accessToken: o.accessToken, ownUsername: o.ownUsername, allowOwnPosts: true, fetchFn: o.fetchFn });
    const s = await runPipelineOnce(db, wsId, collector, o.llm, {
      maxResults: o.maxResults ?? 20, maxSpendUsd: 0, maxCalls: 20, globalMonthlyCeiling: 1000,
    });
    const ws = await loadWorkspace(db, wsId);
    const leads = await db.query<{ author_handle: string; intent_score: number | null; service: string | null; reason: string | null; text: string }>(
      'select p.author_handle, c.intent_score, c.service, c.reason, p.text from leads l join posts p on p.id = l.post_id join classifications c on c.id = l.classification_id where l.workspace_id = $1 order by c.intent_score desc nulls last',
      [ws.id],
    );
    const hidden = await db.query<{ author_handle: string; author_type: string; reason: string | null; text: string }>(
      'select author_handle, author_type, reason, text from hidden_posts where workspace_id = $1',
      [ws.id],
    );
    return {
      found: s.collect.postsReturned,
      prefilterPassed: s.prefilter.passed,
      classified: s.classify.classified,
      leads: leads.rows.map((r) => ({ handle: r.author_handle, intent: r.intent_score, service: r.service, reason: r.reason, text: r.text })),
      hidden: hidden.rows.map((r) => ({ handle: r.author_handle, type: r.author_type, why: r.reason ?? '', text: r.text })),
    };
  } finally {
    await db.close();
  }
}
