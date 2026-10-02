// Exports leads to a CSV file.
// Usage: npm run export:leads [-- --out out/leads.csv] [--include-hidden] [--workspace <id>]

import fs from 'node:fs';
import path from 'node:path';
import { exportLeadsCsv } from '../lib/pipeline/export';
import { loadWorkspace, resolveWorkspaceId } from '../lib/pipeline/workspace';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb(loadEnv());
  try {
    const ws = await loadWorkspace(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    const { csv, leads, hidden } = await exportLeadsCsv(db, ws, { includeHidden: args['include-hidden'] === true });
    const out = path.resolve(strArg(args, 'out') ?? path.join('out', `leads-${new Date().toISOString().slice(0, 10)}.csv`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, csv);
    console.log(`Wrote ${leads} leads${args['include-hidden'] === true ? ` and ${hidden} hidden posts` : ''} to ${path.relative(process.cwd(), out)}`);
  } finally {
    await db.close();
  }
});
