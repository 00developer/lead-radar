// Classify stage plus promotion. Posts that already have a classification for the current prompt version are skipped.
//
// Usage:
//   npm run classify -- --dry-run     show how many posts would be classified, call nothing
//   npm run classify                  classify and promote
// Flags: --workspace <id>  --max-calls <n>

import { runClassify } from '../lib/pipeline/classify-stage';
import { runPromote } from '../lib/pipeline/promote-stage';
import { loadWorkspace, resolveWorkspaceId } from '../lib/pipeline/workspace';
import { loadEnv, numArg, openDb, openLlm, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const maxCalls = numArg(args, 'max-calls', env.CLASSIFY_MAX_CALLS_PER_RUN);

  const db = openDb(env);
  try {
    const ws = await loadWorkspace(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    const waiting = await db.query<{ n: string }>(
      `select count(*) as n from posts p where p.workspace_id = $1 and p.prefilter_status = 'passed'
          and not exists (select 1 from classifications c where c.post_id = p.id and c.prompt_version = $2)`,
      [ws.id, ws.promptVersion],
    );
    const n = Number(waiting.rows[0].n);
    console.log(`Workspace: ${ws.name}. Prompt ${ws.promptVersion}, model ${env.CLASSIFIER_MODEL}.`);
    console.log(`Posts waiting for classification: ${n}. This run will classify at most ${Math.min(n, maxCalls)}.`);
    if (args['dry-run'] === true) {
      console.log('\nDry run only. Nothing was called and nothing was written.');
      return;
    }

    const c = await runClassify(db, ws, openLlm(env), { maxCalls, globalMonthlyCeiling: env.AI_MONTHLY_CEILING });
    console.log(`\nClassified ${c.classified} of ${c.attempted} attempted. Stored with error ${c.storedWithError}. API failures ${c.apiFailures}. Tokens in/out: ${c.inputTokens}/${c.outputTokens}.`);
    if (c.stoppedReason) {
      console.error(`\nSTOPPED EARLY: ${c.stoppedReason}`);
      process.exitCode = 1;
    }
    const p = await runPromote(db, ws);
    console.log(`Promotion: considered ${p.considered}, leads created ${p.leadsCreated}, updated ${p.leadsUpdated}, hidden by AI ${p.hidden}.`);
  } finally {
    await db.close();
  }
});
