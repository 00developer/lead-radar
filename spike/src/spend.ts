import fs from 'node:fs';
import path from 'node:path';
import { OUT, readJson, writeJson } from './config.js';

const FILE = path.join(OUT, 'spend.json');

export type SpendRecord = {
  at: string;
  actor: string;
  keywords: number;
  items: number;
  costUsd: number;
  runId: string;
};

export type SpendFile = { apifyUsd: number; runs: SpendRecord[] };

export function loadSpend(): SpendFile {
  if (!fs.existsSync(FILE)) return { apifyUsd: 0, runs: [] };
  return readJson<SpendFile>(FILE);
}

export function addSpend(rec: SpendRecord): SpendFile {
  const s = loadSpend();
  s.runs.push(rec);
  s.apifyUsd = Number((s.apifyUsd + rec.costUsd).toFixed(4));
  writeJson(FILE, s);
  return s;
}
