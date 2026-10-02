import fs from 'node:fs';
import path from 'node:path';
import { OUT, readJson } from './config.js';
import { normalize, type NormalizedPost } from './normalize.js';

export type RunMeta = {
  actor: string;
  actorKey: string;
  keywords: string[];
  perKeyword: number;
  plannedItems: number;
  estimateUsd: number;
  costUsd: number;
  status: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  itemCount: number;
};

export type SavedRun = { file: string; meta: RunMeta; items: Record<string, unknown>[] };

export function loadRuns(): SavedRun[] {
  const base = path.join(OUT, 'apify');
  if (!fs.existsSync(base)) return [];
  const runs: SavedRun[] = [];
  for (const actorDir of fs.readdirSync(base)) {
    const dir = path.join(base, actorDir);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(dir, f);
      const data = readJson<{ meta: RunMeta; items: Record<string, unknown>[] }>(file);
      runs.push({ file, meta: data.meta, items: data.items });
    }
  }
  return runs;
}

export function normalizedPosts(runs: SavedRun[]): NormalizedPost[] {
  const out: NormalizedPost[] = [];
  for (const r of runs) {
    for (const item of r.items) {
      const n = normalize(r.meta.actorKey, item);
      if (n) out.push(n);
    }
  }
  return out;
}
