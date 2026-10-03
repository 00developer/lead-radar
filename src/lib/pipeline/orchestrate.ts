// Runs the whole pipeline for one workspace and one source, with the limits stored in workspace_sources.
// Used by the "Run now" button and by the cron route, so both behave the same.

import type { Db } from '../db/types';
import type { AlertChannel } from '../alerts/channel';
import type { Collector, SourceId } from '../collectors/types';
import type { Llm } from '../classifier/llm';
import { createThreadsApiCollector } from '../collectors/threads-api';
import { loadActiveToken, refreshIfNeeded, type OAuthConfig } from '../threads/oauth';
import { runPipelineOnce, type PipelineSummary } from './run-all';
import { effectiveLimits, getPlan, sourceAllowed } from '../phase4/workspaces';

export type OrchestrateDeps = {
  /** Builds the collector for a source. Kept as a function so tests and dry runs can swap it. */
  collectorFor(source: SourceId, ctx: { db: Db; workspaceId: string }): Promise<Collector>;
  llm: Llm;
  channel: AlertChannel | null;
  appUrl: string;
  globalMonthlyCeiling: number;
  maxCalls: number;
  /** Time budget in ms for the classify stage (serverless functions have time limits). */
  timeBudgetMs?: number;
  now?: Date;
};

export type OrchestrateResult = { ok: true; summary: PipelineSummary } | { ok: false; error: string };

export async function runWorkspacePipeline(db: Db, workspaceId: string, source: SourceId, deps: OrchestrateDeps): Promise<OrchestrateResult> {
  const cfg = await db.query<{ enabled: boolean; max_results: number; max_spend_usd: string }>(
    'select enabled, max_results, max_spend_usd from workspace_sources where workspace_id = $1 and source = $2',
    [workspaceId, source],
  );
  const row = cfg.rows[0];
  if (!row) return { ok: false, error: `Source ${source} is not set up for this workspace.` };
  if (!row.enabled) return { ok: false, error: `Source ${source} is switched off. Enable it under Sources & Runs first.` };

  // The owner-controlled plan is the real limit: a workspace can never collect more than its plan allows, whatever it saved itself.
  const plan = await getPlan(db, workspaceId);
  if (!plan || !sourceAllowed(plan, source)) return { ok: false, error: 'Collection from this source is not enabled for your workspace yet. Ask the app owner to enable it.' };
  const limits = effectiveLimits(plan, { maxResults: row.max_results, maxSpendUsd: Number(row.max_spend_usd) });

  // One run at a time per workspace (a stuck 'running' row older than 15 minutes is ignored).
  const busy = await db.query(
    "select 1 from collector_runs where workspace_id = $1 and status = 'running' and started_at > now() - interval '15 minutes' limit 1",
    [workspaceId],
  );
  if (busy.rows.length > 0) return { ok: false, error: 'A run is already in progress for this workspace. Wait for it to finish.' };

  let collector: Collector;
  try {
    collector = await deps.collectorFor(source, { db, workspaceId });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const summary = await runPipelineOnce(db, workspaceId, collector, deps.llm, {
    maxResults: limits.maxResults,
    maxSpendUsd: limits.maxSpendUsd,
    maxCalls: deps.maxCalls,
    globalMonthlyCeiling: deps.globalMonthlyCeiling,
    now: deps.now,
    deadlineMs: deps.timeBudgetMs ? Date.now() + deps.timeBudgetMs : undefined,
    alerts: deps.channel ? { channel: deps.channel, appUrl: deps.appUrl } : undefined,
  });
  return { ok: true, summary };
}

/**
 * The official collector for a workspace: uses the connected account's encrypted token (refreshing it when it is about to
 * expire), or the Phase 1 development token from .env. Counts the queries already used in the last 24 hours.
 */
export async function threadsCollectorForWorkspace(db: Db, workspaceId: string, oauth: OAuthConfig | null, devToken: string | undefined): Promise<Collector> {
  if (oauth) await refreshIfNeeded(db, workspaceId, oauth);
  const conn = await loadActiveToken(db, workspaceId, oauth?.encryptionKey);
  const token = conn?.token ?? devToken;
  if (!token) throw new Error('No Threads account is connected. Connect one under Sources & Runs.');
  const used = await db.query<{ n: string }>(
    "select coalesce(sum(queries_used), 0) as n from collector_runs where workspace_id = $1 and source = 'threads_api' and started_at > now() - interval '24 hours'",
    [workspaceId],
  );
  return createThreadsApiCollector({ accessToken: token, ownUsername: conn?.username, queriesUsedLast24h: Number(used.rows[0].n) });
}
