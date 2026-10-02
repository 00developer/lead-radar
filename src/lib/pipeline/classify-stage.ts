// Stage 3: classify (docs/architecture.md section 7, docs/classifier.md). Only posts that passed the pre-filter and have no
// classification for the current prompt version are sent to the model, so re-running never pays twice for a post.
//
// Cost controls: a per-run call limit, and the monthly ceiling enforced by the database function try_record_ai_usage
// (checked right before each model call). A provider quota error stops the whole run loudly (decision D-35).

import type { Db } from '../db/types';
import { buildSystemPrompt, buildUserMessage, type PromptPost, type PromptService } from '../classifier/prompt';
import { validateClassification, type Classification } from '../classifier/schema';
import { LlmQuotaError, type Llm } from '../classifier/llm';
import type { WorkspaceContext } from './workspace';

export type ClassifyLimits = {
  maxCalls: number;
  globalMonthlyCeiling: number;
  concurrency?: number;
  /** Stop starting new posts after this time (epoch ms). Used by serverless runs: the rest continues on the next run. */
  deadlineMs?: number;
};

export type ClassifySummary = {
  attempted: number;
  classified: number;
  /** Model returned invalid JSON twice: stored as unclear with an error, flagged for review. */
  storedWithError: number;
  /** The API call itself failed: the post stays unclassified and the next run picks it up. */
  apiFailures: number;
  stoppedReason: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

type PostRow = {
  id: string;
  author_handle: string;
  author_bio: string | null;
  posted_at: Date | null;
  text: string;
  is_reply: string | null;
};

type Outcome =
  | { kind: 'ok'; result: Classification; inputTokens: number; outputTokens: number }
  | { kind: 'invalid'; error: string; inputTokens: number; outputTokens: number }
  | { kind: 'api_error'; error: string; inputTokens: number; outputTokens: number };

/** One post: call the model, validate, retry once on invalid JSON. Throws LlmQuotaError when the quota is exhausted. */
export async function classifyPost(llm: Llm, system: string, post: PromptPost, serviceSlugs: string[], offeringNames: string[] = []): Promise<Outcome> {
  let inputTokens = 0;
  let outputTokens = 0;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const reminder = attempt === 1 ? '\n\nReturn valid JSON only, matching the schema exactly.' : '';
    let text: string;
    try {
      const r = await llm.complete(system, buildUserMessage(post) + reminder);
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      text = r.text;
    } catch (e) {
      if (e instanceof LlmQuotaError) throw e;
      return { kind: 'api_error', error: (e instanceof Error ? e.message : String(e)).slice(0, 300), inputTokens, outputTokens };
    }
    try {
      return { kind: 'ok', result: validateClassification(text, serviceSlugs, offeringNames), inputTokens, outputTokens };
    } catch (e) {
      lastError = `invalid model output: ${(e instanceof Error ? e.message : String(e)).slice(0, 250)}`;
    }
  }
  return { kind: 'invalid', error: lastError, inputTokens, outputTokens };
}

export async function runClassify(db: Db, ws: WorkspaceContext, llm: Llm, limits: ClassifyLimits): Promise<ClassifySummary> {
  const summary: ClassifySummary = {
    attempted: 0, classified: 0, storedWithError: 0, apiFailures: 0, stoppedReason: null, inputTokens: 0, outputTokens: 0, model: llm.model,
  };
  const ceiling = Math.min(ws.settings.aiMonthlyCeiling, limits.globalMonthlyCeiling);
  const system = buildSystemPrompt(ws.services satisfies PromptService[], ws.profile);
  const offeringNames = ws.profile?.offerings.map((o) => o.name) ?? [];
  const offeringId = (name: string | null) => (name ? ws.profile?.offerings.find((o) => o.name === name)?.id ?? null : null);
  const slugs = ws.services.map((s) => s.slug);

  const todo = await db.query<PostRow>(
    `select p.id, p.author_handle, p.author_bio, p.posted_at, p.text,
            coalesce(p.raw->>'isReply', p.raw->>'is_reply') as is_reply
       from posts p
      where p.workspace_id = $1 and p.prefilter_status = 'passed'
        and not exists (select 1 from classifications c where c.post_id = p.id and c.prompt_version = $2)
      order by p.posted_at desc nulls last, p.collected_at, p.id
      limit $3`,
    [ws.id, ws.promptVersion, limits.maxCalls],
  );

  const queue = [...todo.rows];
  let stop = false;

  const worker = async () => {
    while (!stop) {
      const row = queue.shift();
      if (!row) return;
      if (limits.deadlineMs && Date.now() > limits.deadlineMs) {
        stop = true;
        summary.stoppedReason = 'Time budget reached. The remaining posts are classified on the next run.';
        return;
      }

      const gate = await db.query<{ ok: boolean }>('select try_record_ai_usage($1, $2, $3) as ok', [ws.id, 'classify', ceiling]);
      if (!gate.rows[0].ok) {
        stop = true;
        summary.stoppedReason = `Monthly AI ceiling reached (${ceiling} calls). Nothing more is classified this month.`;
        return;
      }
      summary.attempted += 1;

      let out: Outcome;
      try {
        out = await classifyPost(
          llm,
          system,
          { authorHandle: row.author_handle, authorBio: row.author_bio, postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null, isReply: row.is_reply === null ? undefined : row.is_reply === 'true', text: row.text },
          slugs,
          offeringNames,
        );
      } catch (e) {
        if (e instanceof LlmQuotaError) {
          stop = true;
          summary.stoppedReason = e.message;
          return;
        }
        throw e;
      }
      summary.inputTokens += out.inputTokens;
      summary.outputTokens += out.outputTokens;

      if (out.kind === 'api_error') {
        summary.apiFailures += 1;
        console.warn(`[classify] API error for post ${row.id}: ${out.error}`);
        continue;
      }
      if (out.kind === 'invalid') {
        summary.storedWithError += 1;
        await db.query(
          `insert into classifications (workspace_id, post_id, prompt_version, model, author_type, needs_review, input_tokens, output_tokens, error)
           values ($1,$2,$3,$4,'unclear',true,$5,$6,$7) on conflict (post_id, prompt_version) do nothing`,
          [ws.id, row.id, ws.promptVersion, llm.model, out.inputTokens, out.outputTokens, out.error],
        );
        continue;
      }
      const c = out.result;
      await db.query(
        `insert into classifications (workspace_id, post_id, prompt_version, model, author_type, service, intent_score, urgency, budget,
                                      timeline, language, reason, reply_draft, confidence, input_tokens, output_tokens, matched_offering_id, fit)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (post_id, prompt_version) do nothing`,
        [
          ws.id, row.id, ws.promptVersion, llm.model, c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline,
          c.language, c.reason, c.reply_draft, c.confidence, out.inputTokens, out.outputTokens, offeringId(c.matched_offering), c.fit,
        ],
      );
      summary.classified += 1;
    }
  };

  const n = Math.max(1, limits.concurrency ?? 2);
  await Promise.all(Array.from({ length: n }, worker));
  return summary;
}
