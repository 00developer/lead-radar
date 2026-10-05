// Exports leads to a CSV file, or to an Excel file when --out ends with .xlsx.
// Usage: npm run export:leads [-- --out out/leads.csv|out/leads.xlsx] [--include-hidden] [--workspace <id>]

import fs from 'node:fs';
import path from 'node:path';
import { exportLeadsCsv, loadExportRows } from '../lib/pipeline/export';
import { buildLeadsWorkbook } from '../lib/pipeline/export-xlsx';
import { loadWorkspace, resolveWorkspaceId } from '../lib/pipeline/workspace';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb(loadEnv());
  try {
    const ws = await loadWorkspace(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    const includeHidden = args['include-hidden'] === true;
    const out = path.resolve(strArg(args, 'out') ?? path.join('out', `leads-${new Date().toISOString().slice(0, 10)}.csv`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let leads: number;
    let hidden: number;
    if (out.toLowerCase().endsWith('.xlsx')) {
      const data = await loadExportRows(db, ws, { includeHidden });
      fs.writeFileSync(out, await buildLeadsWorkbook(data, { workspaceName: ws.name, includeHidden }));
      leads = data.leads.length;
      hidden = data.hidden.length;
    } else {
      const r = await exportLeadsCsv(db, ws, { includeHidden });
      fs.writeFileSync(out, r.csv);
      leads = r.leads;
      hidden = r.hidden;
    }
    console.log(`Wrote ${leads} leads${includeHidden ? ` and ${hidden} hidden posts` : ''} to ${path.relative(process.cwd(), out)}`);
  } finally {
    await db.close();
  }
});
