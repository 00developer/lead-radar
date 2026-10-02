'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '../../lib/auth';
import { getDb } from '../../lib/app/server';
import { realDeps } from '../../lib/app/deps';
import { runWorkspacePipeline } from '../../lib/pipeline/orchestrate';
import { disconnect } from '../../lib/threads/oauth';

function go(kind: 'notice' | 'error', message: string): never {
  redirect(`/sources?${kind}=${encodeURIComponent(message.slice(0, 400))}`);
}

/** "Run now": collect, pre-filter, classify, promote and alert for one source, with the limits saved for that source. */
export async function runNow(formData: FormData) {
  const s = await requireSession();
  const source = z.enum(['apify_threads', 'threads_api']).safeParse(formData.get('source'));
  if (!source.success) go('error', 'Unknown source.');

  let result;
  try {
    result = await runWorkspacePipeline(getDb(), s.workspaceId, source.data, realDeps());
  } catch (e) {
    go('error', e instanceof Error ? e.message : 'The run failed.');
  }
  revalidatePath('/sources');
  revalidatePath('/leads');
  revalidatePath('/');
  if (!result.ok) go('error', result.error);

  const r = result.summary;
  const parts = [
    `${r.collect.status}: ${r.collect.postsReturned} posts returned, ${r.collect.postsNew} new, $${r.collect.costUsd.toFixed(3)}`,
    `${r.classify.classified} classified, ${r.promote.leadsCreated} new leads`,
    r.alerts ? (r.alerts.skipped ? `alerts skipped (${r.alerts.skipped})` : `${r.alerts.sent} alert email(s) sent`) : 'alert emails are not configured',
  ];
  if (r.collect.error) parts.push(`collector note: ${r.collect.error}`);
  if (r.classify.stoppedReason) parts.push(`stopped early: ${r.classify.stoppedReason}`);
  go(r.collect.status === 'failed' || r.classify.stoppedReason ? 'error' : 'notice', parts.join('. '));
}

/** Disconnect: deletes the stored token. */
export async function disconnectThreads() {
  const s = await requireSession();
  await disconnect(getDb(), s.workspaceId);
  revalidatePath('/sources');
  go('notice', 'Threads account disconnected. The stored token was deleted.');
}
