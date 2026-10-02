// Reads the owner-filled labeling sheet and reports how good the AI was.
// Usage: npm run labels            (data/labeling.csv)
//        npm run labels -- --file data/labeling.dry.csv

import fs from 'node:fs';
import path from 'node:path';
import { DATA, parseArgs } from './config.js';

// Minimal CSV parser: handles quoted cells, doubled quotes and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.file === 'string' ? path.resolve(args.file) : path.join(DATA, 'labeling.csv');
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0];
  const idx = (name: string) => header.findIndex((h) => h.startsWith(name));
  const iType = idx('ai_author_type');
  const iIntent = idx('ai_intent');
  const iOwner = idx('owner_genuine_buyer');
  if ([iType, iIntent, iOwner].some((i) => i < 0)) throw new Error('Unexpected CSV header. Use the file written by "npm run classify".');

  const data = rows.slice(1).map((r) => ({
    ai: r[iType],
    intent: Number(r[iIntent]),
    owner: r[iOwner].trim().toLowerCase(),
  }));
  const labeled = data.filter((d) => d.owner === 'y' || d.owner === 'n');
  console.log(`Rows: ${data.length}. Labeled by owner: ${labeled.length}. Unlabeled: ${data.length - labeled.length}.`);
  if (!labeled.length) {
    console.log('Nothing labeled yet. Fill the owner_genuine_buyer column with y or n.');
    return;
  }

  const genuine = labeled.filter((d) => d.owner === 'y');
  const aiBuyer = labeled.filter((d) => d.ai === 'buyer');
  const aiBuyerGenuine = aiBuyer.filter((d) => d.owner === 'y');
  console.log(`\nOwner says genuine buyer: ${pct(genuine.length, labeled.length)} of labeled posts.`);
  console.log(`Precision of AI "buyer" (owner agrees it is genuine): ${pct(aiBuyerGenuine.length, aiBuyer.length)}`);
  console.log(`Recall (genuine buyers the AI called "buyer"): ${pct(aiBuyerGenuine.length, genuine.length)}`);

  for (const t of [60, 80]) {
    const sel = aiBuyer.filter((d) => d.intent >= t);
    console.log(`Genuine rate among AI buyers with intent >= ${t}: ${pct(sel.filter((d) => d.owner === 'y').length, sel.length)}`);
  }

  console.log('\nConfusion (rows = AI type, columns = owner):');
  const types = ['buyer', 'seller', 'spam', 'irrelevant', 'unclear', 'ERROR'];
  console.log(['AI type'.padEnd(12), 'genuine'.padStart(8), 'not'.padStart(8)].join(' '));
  for (const t of types) {
    const sel = labeled.filter((d) => d.ai === t);
    if (!sel.length) continue;
    const y = sel.filter((d) => d.owner === 'y').length;
    console.log([t.padEnd(12), String(y).padStart(8), String(sel.length - y).padStart(8)].join(' '));
  }
  console.log('\nTarget from the PRD: 50% or more of reviewed leads are genuine buyers.');
}

try {
  main();
} catch (e) {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
