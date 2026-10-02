// Dry run of the whole pipeline with NO network and NO cost: in-memory Postgres, saved fixture posts, fake classifier.
// It runs the pipeline twice to show that a second run creates no duplicates.
// Usage: npm run pipeline:dry

import fs from 'node:fs';
import path from 'node:path';
import { createMemoryDb } from '../lib/db/memory';
import { migrate } from '../lib/db/migrate';
import { createFixtureCollector } from '../lib/collectors/fixture';
import { createFakeLlm } from '../lib/classifier/fake-llm';
import { exportLeadsCsv } from '../lib/pipeline/export';
import { runPipelineOnce } from '../lib/pipeline/run-all';
import { loadWorkspace } from '../lib/pipeline/workspace';
import { seedOwnerWorkspace } from '../lib/seed';
import { run } from './common';

run(async () => {
  const items = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/apify-webdata.sample.json'), 'utf8')) as Record<string, unknown>[];
  const db = await createMemoryDb();
  try {
    console.log(`Applied migrations: ${(await migrate(db)).join(', ')}`);
    const id = await seedOwnerWorkspace(db);
    // The fixture posts are months old; allow old posts for this dry run only.
    await db.query('update workspace_settings set max_post_age_days = 3650 where workspace_id = $1', [id]);

    const opts = { maxResults: 100, maxSpendUsd: 0.5, maxCalls: 100, globalMonthlyCeiling: 2000 };
    for (const round of [1, 2]) {
      const s = await runPipelineOnce(db, id, createFixtureCollector(items), createFakeLlm(), opts);
      console.log(`\nRound ${round}: collected ${s.collect.postsReturned} (new ${s.collect.postsNew}), pre-filter passed ${s.prefilter.passed} of ${s.prefilter.processed} new,`
        + ` classified ${s.classify.classified}, leads created ${s.promote.leadsCreated}, hidden by AI ${s.promote.hidden}.`);
    }
    const counts = await db.query<{ posts: string; classifications: string; leads: string }>(
      'select (select count(*) from posts) as posts, (select count(*) from classifications) as classifications, (select count(*) from leads) as leads',
    );
    console.log(`\nTotals after both rounds: ${JSON.stringify(counts.rows[0])} (a second round must not add rows).`);

    const ws = await loadWorkspace(db, id);
    const { csv, leads, hidden } = await exportLeadsCsv(db, ws, { includeHidden: true });
    const out = path.resolve('out', 'dry-run-leads.csv');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, csv);
    console.log(`Exported ${leads} leads and ${hidden} hidden posts to ${path.relative(process.cwd(), out)}. (Fake classifier: labels are not real.)`);
  } finally {
    await db.close();
  }
});
