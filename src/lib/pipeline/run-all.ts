// Runs collect -> pre-filter -> classify -> promote once. Used by the network-free dry run and by the tests.

import type { Db } from '../db/types';
import type { Collector } from '../collectors/types';
import type { Llm } from '../classifier/llm';
import { runCollect, type CollectSummary } from './collect';
import { runPrefilter, type PrefilterSummary } from './prefilter-stage';
import { runClassify, type ClassifySummary } from './classify-stage';
import { runPromote, type PromoteSummary } from './promote-stage';
import { runAlerts, type AlertOptions, type AlertSummary } from './alert-stage';
import { loadWorkspace } from './workspace';

export type PipelineSummary = { collect: CollectSummary; prefilter: PrefilterSummary; classify: ClassifySummary; promote: PromoteSummary; alerts: AlertSummary | null };

export type PipelineOptions = {
  maxResults: number;
  maxSpendUsd: number;
  maxCalls: number;
  globalMonthlyCeiling: number;
  now?: Date;
  /** Stop starting new classifications after this time (epoch ms). */
  deadlineMs?: number;
  /** When given, alert emails are sent for new high-intent leads after promotion. */
  alerts?: Pick<AlertOptions, 'channel' | 'appUrl'>;
};

export async function runPipelineOnce(db: Db, workspaceId: string, collector: Collector, llm: Llm, o: PipelineOptions): Promise<PipelineSummary> {
  const ws = await loadWorkspace(db, workspaceId);
  const collect = await runCollect(db, ws, collector, { maxResults: o.maxResults, maxSpendUsd: o.maxSpendUsd });
  const prefilter = await runPrefilter(db, ws, o.now);
  const classify = await runClassify(db, ws, llm, { maxCalls: o.maxCalls, globalMonthlyCeiling: o.globalMonthlyCeiling, deadlineMs: o.deadlineMs });
  const promote = await runPromote(db, ws);
  const alerts = o.alerts ? await runAlerts(db, ws, { ...o.alerts, alertEmail: ws.settings.alertEmail }) : null;
  return { collect, prefilter, classify, promote, alerts };
}
