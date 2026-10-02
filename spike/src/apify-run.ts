// Runs ONE Apify Threads Actor on a keyword set with hard spend limits and saves the raw result.
//
// Usage (from the spike folder):
//   npm run apify -- --actor ethereal --set core --per-keyword 20 --dry-run
//   npm run apify -- --actor ethereal --set core --per-keyword 20
//
// Flags:
//   --actor       ethereal | webdata | easyapi
//   --set         core | extra | devanagari   (keyword group from keywords.json, default core)
//   --limit-kw    only use the first N keywords of the set (for tiny test runs)
//   --per-keyword posts wanted per keyword (default 20)
//   --max-run-usd hard cap for this one run (default 1.5)
//   --dry-run     print the input and cost estimate, call nothing

import path from 'node:path';
import { ApifyClient } from 'apify-client';
import { ACTORS, isActorKey } from './actors.js';
import { OUT, DATA, ROOT, ensureDir, need, num, parseArgs, readJson, writeJson } from './config.js';
import { addSpend, loadSpend } from './spend.js';

type KeywordFile = Record<string, string[]>;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const actorKey = String(args.actor ?? '');
  if (!isActorKey(actorKey)) {
    throw new Error(`--actor must be one of: ${Object.keys(ACTORS).join(', ')}`);
  }
  const actor = ACTORS[actorKey];
  const setName = String(args.set ?? 'core');
  const keywordFile = readJson<KeywordFile>(path.join(ROOT, 'keywords.json'));
  const group = keywordFile[setName];
  if (!Array.isArray(group)) throw new Error(`Keyword set "${setName}" not found in keywords.json`);

  const limitKw = args['limit-kw'] ? Number(args['limit-kw']) : group.length;
  const keywords = group.slice(0, limitKw);
  const perKeyword = args['per-keyword'] ? Number(args['per-keyword']) : 20;
  const maxRunUsd = args['max-run-usd'] ? Number(args['max-run-usd']) : 1.5;
  const totalBudget = num('APIFY_TOTAL_BUDGET_USD', 4);
  const dry = args['dry-run'] === true;

  const input = actor.buildInput(keywords, perKeyword);
  const plannedItems = keywords.length * Math.max(perKeyword, actorKey === 'easyapi' ? 10 : 0);
  const estimateUsd = Number(((plannedItems * actor.pricePer1kUsd) / 1000).toFixed(4));
  const spent = loadSpend().apifyUsd;

  console.log(`Actor:            ${actor.id} (${actor.pricingModel}, listed $${actor.pricePer1kUsd}/1k)`);
  console.log(`Keywords (${keywords.length}):   ${keywords.join(' | ')}`);
  console.log(`Planned items:    ${plannedItems}`);
  console.log(`Estimated cost:   $${estimateUsd}  (per-run cap $${maxRunUsd})`);
  console.log(`Spent so far:     $${spent}  of total budget $${totalBudget}`);
  console.log(`Actor input:      ${JSON.stringify(input)}`);

  if (estimateUsd > maxRunUsd) {
    throw new Error(`Estimate $${estimateUsd} is above the per-run cap $${maxRunUsd}. Reduce --per-keyword or --limit-kw, or ask the owner.`);
  }
  if (spent + estimateUsd > totalBudget) {
    throw new Error(`Spent $${spent} + estimate $${estimateUsd} would exceed the total budget $${totalBudget}. Stop and ask the owner.`);
  }
  if (dry) {
    console.log('\nDry run only. Nothing was called.');
    return;
  }

  const client = new ApifyClient({ token: need('APIFY_TOKEN') });
  const startedAt = new Date().toISOString();
  console.log('\nStarting Actor run (waiting up to 10 minutes)...');

  const run = await client.actor(actor.id).call(input, {
    waitSecs: 600,
    // Hard caps enforced by Apify: one applies to pay-per-result Actors, the other to pay-per-event Actors.
    maxItems: plannedItems,
    maxTotalChargeUsd: maxRunUsd,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: plannedItems + 50 });
  const costUsd = run.usageTotalUsd ?? 0;
  const finishedAt = new Date().toISOString();

  const dir = path.join(OUT, 'apify', actor.key);
  ensureDir(dir);
  const file = path.join(dir, `${startedAt.replace(/[:.]/g, '-')}.json`);
  writeJson(file, {
    meta: {
      actor: actor.id,
      actorKey: actor.key,
      keywords,
      perKeyword,
      plannedItems,
      estimateUsd,
      costUsd,
      status: run.status,
      runId: run.id,
      startedAt,
      finishedAt,
      itemCount: items.length,
    },
    items,
  });

  const s = addSpend({ at: finishedAt, actor: actor.id, keywords: keywords.length, items: items.length, costUsd, runId: run.id });
  console.log(`\nRun ${run.status}. Items: ${items.length}. Actual cost: $${costUsd}. Total spent: $${s.apifyUsd} of $${totalBudget}.`);
  console.log(`Saved: ${path.relative(ROOT, file)}`);
  void DATA;
}

main().catch((err) => {
  console.error(`\nERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
