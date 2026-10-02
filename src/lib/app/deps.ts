// Real dependencies for the pipeline when it runs inside the Next.js server (Run now button, cron route).

import 'server-only';
import { createResendChannel } from '../alerts/email';
import { createGeminiLlm } from '../classifier/llm';
import { createCollector } from '../collectors';
import { threadsCollectorForWorkspace, type OrchestrateDeps } from '../pipeline/orchestrate';
import { requireValue } from '../env';
import { appUrl, oauthConfig, serverEnv } from './server';

/** Time budget for the classify stage inside one server request. Longer jobs continue on the next run. */
export const REQUEST_TIME_BUDGET_MS = 240_000;

export function realLlm() {
  const env = serverEnv();
  return createGeminiLlm({ apiKey: requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY'), model: env.CLASSIFIER_MODEL, thinking: env.GEMINI_THINKING });
}

export function realDeps(): OrchestrateDeps {
  const env = serverEnv();
  return {
    async collectorFor(source, ctx) {
      if (source === 'apify_threads') return createCollector('apify_threads', env);
      let oauth = null;
      try {
        oauth = oauthConfig();
      } catch {
        // Threads app settings missing: fall back to the development token, if any.
      }
      return threadsCollectorForWorkspace(ctx.db, ctx.workspaceId, oauth, env.THREADS_ACCESS_TOKEN);
    },
    llm: realLlm(),
    channel: env.EMAIL_API_KEY && env.ALERT_FROM_EMAIL ? createResendChannel({ apiKey: env.EMAIL_API_KEY, from: env.ALERT_FROM_EMAIL }) : null,
    appUrl: appUrl(),
    globalMonthlyCeiling: env.AI_MONTHLY_CEILING,
    maxCalls: env.CLASSIFY_MAX_CALLS_PER_RUN,
    timeBudgetMs: REQUEST_TIME_BUDGET_MS,
  };
}
