// Writes the leads the owner labeled in the dashboard to tests/fixtures/labeled-live.csv, so the classifier can be evaluated
// on fresh data: npm run eval -- --set live   (or --set all for old and new together).
// Usage: npm run golden:update [-- --workspace <id>]

import fs from 'node:fs';
import path from 'node:path';
import { exportLabeledLeads } from '../lib/golden';
import { resolveWorkspaceId } from '../lib/pipeline/workspace';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb(loadEnv());
  try {
    const { csv, count, genuine } = await exportLabeledLeads(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    const out = path.resolve('tests', 'fixtures', 'labeled-live.csv');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, csv);
    console.log(`Wrote ${count} labeled lead(s) (${genuine} genuine, ${count - genuine} not genuine) to ${path.relative(process.cwd(), out)}`);
    if (count < 30) console.log('Fewer than 30 labels: the evaluation on this set is only a hint. Label more leads in the dashboard first.');
  } finally {
    await db.close();
  }
});
