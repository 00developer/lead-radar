// Collect stage plus the free pre-filter. Costs money on the Apify source, so limits are always applied.
//
// Usage:
//   npm run collect -- --dry-run                      show what would run (keywords, limits, cost estimate), call nothing
//   npm run collect                                   run the default source (apify_threads)
//   npm run collect -- --source threads_api           official API (needs THREADS_ACCESS_TOKEN and Meta approval for real leads)
// Flags: --workspace <id>  --max-results <n>  --max-spend-usd <n>

import { createCollector, isSourceId } from '../lib/collectors';
import { runCollect } from '../lib/pipeline/collect';
import { runPrefilter } from '../lib/pipeline/prefilter-stage';
import { loadWorkspace, resolveWorkspaceId } from '../lib/pipeline/workspace';
import { loadEnv, numArg, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const source = strArg(args, 'source') ?? 'apify_threads';
  if (!isSourceId(source)) throw new Error(`--source must be apify_threads or threads_api, got "${source}".`);
  const maxResults = numArg(args, 'max-results', env.COLLECT_MAX_RESULTS);
  const maxSpendUsd = numArg(args, 'max-spend-usd', env.COLLECT_MAX_SPEND_USD);

  const db = openDb(env);
  try {
    const ws = await loadWorkspace(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    const estimate = source === 'apify_threads' ? (Math.min(maxResults, ws.keywords.length * 20) * env.APIFY_PRICE_PER_1K_USD) / 1000 : 0;
    console.log(`Workspace: ${ws.name}`);
    console.log(`Source: ${source}. Keywords (${ws.keywords.length}): ${ws.keywords.map((k) => k.term).join(' | ')}`);
    console.log(`Limits: max ${maxResults} results, max $${maxSpendUsd}. Estimated cost at most $${estimate.toFixed(4)}.`);
    if (args['dry-run'] === true) {
      console.log('\nDry run only. Nothing was called and nothing was written.');
      return;
    }
    if (ws.keywords.length === 0) throw new Error('This workspace has no enabled keywords.');

    const s = await runCollect(db, ws, createCollector(source, env), { maxResults, maxSpendUsd });
    console.log(`\nRun ${s.runId}: ${s.status}. Returned ${s.postsReturned}, new ${s.postsNew}, cost $${s.costUsd}, queries ${s.queriesUsed}.`);
    if (s.error) console.log(`Note: ${s.error}`);

    const p = await runPrefilter(db, ws);
    console.log(`Pre-filter: processed ${p.processed}, passed ${p.passed}, short ${p.dropped_short}, language ${p.dropped_language}, old ${p.dropped_old}, negative keyword ${p.dropped_negative_keyword}, duplicate ${p.dropped_duplicate}.`);
    if (s.status === 'failed') process.exitCode = 1;
  } finally {
    await db.close();
  }
});
