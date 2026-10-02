// Evaluates the classifier prompt on the owner-labeled golden set (tests/fixtures/labeled.csv, from Phase 0).
// Reports precision (share of leads that are genuine), recall, the buyer/seller confusion, and every disagreement.
// Run it after any prompt change and write the result into docs/memory.md.
//
// Usage:
//   npm run eval -- --dry-run      fake classifier, no network, no cost (checks the script only)
//   npm run eval                   real model calls: one per post (about 49), capped by CLASSIFY_MAX_CALLS_PER_RUN
//   npm run eval -- --set live     the leads the owner labeled in the dashboard (make it first with: npm run golden:update)
//   npm run eval -- --set all      the Phase 0 golden set and the live labels together

import fs from 'node:fs';
import path from 'node:path';
import { buildSystemPrompt, PROMPT_VERSION } from '../lib/classifier/prompt';
import { createFakeLlm } from '../lib/classifier/fake-llm';
import { LlmQuotaError, type Llm } from '../lib/classifier/llm';
import { classifyPost } from '../lib/pipeline/classify-stage';
import { decidePromotion } from '../lib/pipeline/promote';
import { computeMetrics, confusion, type EvalItem } from '../lib/eval';
import { parseCsv } from '../lib/csv';
import { OWNER_SERVICES } from '../lib/seed';
import { loadEnv, openLlm, parseArgs, run } from './common';

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const dry = args['dry-run'] === true;
  const llm: Llm = dry ? createFakeLlm() : openLlm(env);

  const set = typeof args.set === 'string' ? args.set : 'golden';
  if (!['golden', 'live', 'all'].includes(set)) throw new Error('--set must be golden, live or all.');
  const files = [...(set !== 'live' ? ['labeled.csv'] : []), ...(set !== 'golden' ? ['labeled-live.csv'] : [])].map((f) => path.resolve('tests/fixtures', f));
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`${path.basename(f)} does not exist yet. Run: npm run golden:update`);
  const parts = files.map((f) => parseCsv(fs.readFileSync(f, 'utf8')));
  const rows = [parts[0][0], ...parts.flatMap((p) => p.slice(1))];
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const iId = col('id'), iText = col('text'), iOwner = col('owner_genuine_buyer (y/n)');
  if ([iId, iText, iOwner].includes(-1)) throw new Error('labeled.csv is missing an expected column.');
  const overrides = (JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/label-overrides.json'), 'utf8')) as { overrides: Record<string, { expected: 'y' | 'n' }> }).overrides;

  const golden = rows.slice(1).filter((r) => r[iOwner] === 'y' || r[iOwner] === 'n').slice(0, env.CLASSIFY_MAX_CALLS_PER_RUN);
  const system = buildSystemPrompt(OWNER_SERVICES);
  const slugs = OWNER_SERVICES.map((s) => s.slug);
  console.log(`Prompt ${PROMPT_VERSION}, model ${llm.model}${dry ? ' (DRY RUN, fake classifier)' : ''}. Set "${set}": ${golden.length} posts.`);

  const items: EvalItem[] = [];
  const queue = [...golden];
  let quotaMessage: string | null = null;
  let inTok = 0, outTok = 0;
  const worker = async () => {
    for (let r = queue.shift(); r && !quotaMessage; r = queue.shift()) {
      const owner = r[iOwner] === 'y';
      const expected = overrides[r[iId]] ? overrides[r[iId]].expected === 'y' : owner;
      try {
        const o = await classifyPost(llm, system, { authorHandle: 'unknown', text: r[iText] }, slugs);
        inTok += o.inputTokens;
        outTok += o.outputTokens;
        if (o.kind !== 'ok') {
          items.push({ id: r[iId], text: r[iText], ownerGenuine: owner, expectedGenuine: expected, isLead: false, aiType: 'error', intent: null, failed: true });
        } else {
          const d = decidePromotion(
            { authorType: o.result.author_type, intentScore: o.result.intent_score, confidence: o.result.confidence, language: o.result.language, error: null },
            { leadThreshold: 60, allowedLanguages: ['en', 'hi', 'hinglish'] },
          );
          items.push({ id: r[iId], text: r[iText], ownerGenuine: owner, expectedGenuine: expected, isLead: d.isLead, aiType: o.result.author_type, intent: o.result.intent_score });
        }
      } catch (e) {
        if (e instanceof LlmQuotaError) quotaMessage = e.message;
        else throw e;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  if (quotaMessage) console.error(`\nSTOPPED EARLY (quota): ${quotaMessage}`);

  const failed = items.filter((i) => i.failed).length;
  console.log(`Classified ${items.length - failed} of ${golden.length}. Failed ${failed}. Tokens in/out: ${inTok}/${outTok}.`);
  for (const [label, useExpected] of [['Against the raw owner labels', false], ['Against owner labels + D-33 (hiring posts are not leads)', true]] as const) {
    const m = computeMetrics(items, useExpected);
    console.log(`\n${label}:`);
    console.log(`  leads ${m.leads}, genuine in set ${m.genuineTotal}, TP ${m.truePositive}, FP ${m.falsePositive}, FN ${m.falseNegative}`);
    console.log(`  precision (share of leads that are genuine) ${pct(m.precision)}, recall ${pct(m.recall)}  (product target: precision 50% or more)`);
    console.log(`  confusion (AI type -> owner genuine / not): ${JSON.stringify(confusion(items, useExpected))}`);
  }
  console.log('\nDisagreements against labels + D-33:');
  for (const i of items.filter((x) => !x.failed && x.isLead !== x.expectedGenuine)) {
    console.log(`  [${i.isLead ? 'lead but not genuine' : 'missed genuine'}] ${i.aiType}/${i.intent}  ${i.text.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  const outFile = path.resolve('out', `eval-${PROMPT_VERSION}-${llm.model}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ promptVersion: PROMPT_VERSION, model: llm.model, dry, items }, null, 1));
  console.log(`\nSaved: ${path.relative(process.cwd(), outFile)}`);
  if (quotaMessage) process.exitCode = 1;
});
