// Summarizes every saved Apify run: volume, fields, freshness, duplicates, relevance proxy, cost.
// Output: console + out/summary.md   (input for the Phase 0 report)

import fs from 'node:fs';
import path from 'node:path';
import { OUT, ROOT, readJson } from './config.js';
import { loadRuns, normalizedPosts, type SavedRun } from './runs.js';
import { normalize, type NormalizedPost } from './normalize.js';

type KeywordFile = Record<string, string[]>;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}

function analyzeRun(run: SavedRun, negative: string[]): string[] {
  const { meta, items } = run;
  const norm = items.map((it) => normalize(meta.actorKey, it)).filter((x): x is NonNullable<typeof x> => x !== null);
  const ids = new Set(norm.map((n) => n.id));
  const texts = new Set(norm.map((n) => n.text.trim().toLowerCase()));

  // Which top-level fields appear in at least half of the items
  const fieldCount = new Map<string, number>();
  for (const it of items) for (const k of Object.keys(it)) fieldCount.set(k, (fieldCount.get(k) ?? 0) + 1);
  const commonFields = [...fieldCount.entries()]
    .filter(([, c]) => c >= items.length / 2)
    .map(([k]) => k)
    .sort();

  const times = norm.map((n) => (n.postedAt ? Date.parse(n.postedAt) : NaN)).filter((t) => !Number.isNaN(t));
  const now = Date.now();
  const ageDays = times.map((t) => (now - t) / 86_400_000);
  const newest = ageDays.length ? Math.min(...ageDays) : null;
  const oldest = ageDays.length ? Math.max(...ageDays) : null;

  const phrases = meta.keywords.map((k) => k.toLowerCase());
  const containsPhrase = norm.filter((n) => phrases.some((p) => n.text.toLowerCase().includes(p))).length;
  const negs = negative.map((k) => k.toLowerCase());
  const sellerish = norm.filter((n) => negs.some((p) => n.text.toLowerCase().includes(p))).length;
  const withUser = norm.filter((n) => n.username).length;
  const withUrl = norm.filter((n) => n.url).length;
  const withTime = norm.filter((n) => n.postedAt).length;
  const withBio = norm.filter((n) => n.bio && n.bio.trim()).length;
  // A bio counts as having a contact hint if it holds an email, a link, a WhatsApp mention or a long digit run (phone).
  const contactRe = /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|www\.|wa\.me|whatsapp|\+?\d[\d\s-]{8,}\d/i;
  const bioWithContact = norm.filter((n) => n.bio && contactRe.test(n.bio)).length;
  const followers = norm.map((n) => n.followers).filter((f): f is number => typeof f === 'number');
  const avgLen = norm.length ? Math.round(norm.reduce((a, n) => a + n.text.length, 0) / norm.length) : 0;

  const perKeyword = new Map<string, number>();
  for (const n of norm) if (n.keyword) perKeyword.set(n.keyword, (perKeyword.get(n.keyword) ?? 0) + 1);

  const lines: string[] = [];
  lines.push(`### ${meta.actor}  (run ${meta.runId}, ${meta.startedAt})`);
  lines.push('');
  lines.push(`- Status: ${meta.status}. Keywords: ${meta.keywords.length}. Wanted per keyword: ${meta.perKeyword}. Items returned: ${items.length} (usable: ${norm.length}).`);
  lines.push(`- Cost: $${meta.costUsd} actual vs $${meta.estimateUsd} estimated. Cost per 1,000 items: $${items.length ? ((meta.costUsd / items.length) * 1000).toFixed(2) : 'n/a'}.`);
  lines.push(`- Duplicates: ${pct(norm.length - ids.size, norm.length)} by id, ${pct(norm.length - texts.size, norm.length)} by identical text.`);
  lines.push(`- Fields present on at least half the items: ${commonFields.join(', ') || 'none'}.`);
  lines.push(`- Have username: ${pct(withUser, norm.length)}, url: ${pct(withUrl, norm.length)}, timestamp: ${pct(withTime, norm.length)}, bio present: ${pct(withBio, norm.length)}; bio with a contact hint (link, email, phone, WhatsApp): ${pct(bioWithContact, norm.length)}; median follower count: ${median(followers) ?? 'n/a'}.`);
  lines.push(`- Freshness: newest ${newest === null ? 'n/a' : newest.toFixed(1)} days old, median ${median(ageDays)?.toFixed(1) ?? 'n/a'}, oldest ${oldest === null ? 'n/a' : oldest.toFixed(1)} days.`);
  lines.push(`- Text contains one of the searched phrases (relevance proxy): ${pct(containsPhrase, norm.length)}.`);
  lines.push(`- Contains a seller-style phrase ("we offer", "hire us", ...): ${pct(sellerish, norm.length)}.`);
  lines.push(`- Average text length: ${avgLen} characters.`);
  if (perKeyword.size) {
    lines.push(`- Items per keyword: ${[...perKeyword.entries()].map(([k, c]) => `${k}: ${c}`).join('; ')}.`);
  } else {
    lines.push('- Items per keyword: not available (this Actor does not say which keyword found each item).');
  }
  lines.push('');
  return lines;
}

// Rough text signals, only to rank keywords before the LLM and the owner label anything.
// They are a proxy, NOT the genuine-buyer rate.
const BUYER_RE = /\b(need|needs|needed|looking for|looking to|require|required|hiring|recommend\w*|suggest\w*|anyone know|anybody know|who can|who makes|budget|dm me|dm us|paying|want)\b|chahiye|banwan|banane|dhundh|dhoondh/i;
const SELLER_RE = /\b(we offer|hire us|hire me|for hire|available for|open for work|open to work|we provide|our services|our team|we are a|dm for|starting at|portfolio|offering)\b/i;

/** Per keyword: unique posts across all runs, rough buyer-like and seller-like shares, and keywords that returned nothing. */
function perKeyword(runs: SavedRun[]): string[] {
  const seen = new Set<string>();
  const uniq = normalizedPosts(runs).filter((p) => {
    const k = `${p.actor}:${p.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const groups = new Map<string, NormalizedPost[]>();
  for (const p of uniq) {
    const key = `${p.actor} | ${p.keyword ?? '(unknown)'}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const lines: string[] = ['## Per keyword (unique posts across all runs)', ''];
  lines.push('Buyer-like and seller-like shares are rough text patterns (words such as need, looking for, required, budget, chahiye vs. we offer, hire me, portfolio). They are a proxy, not the genuine-buyer rate.', '');
  lines.push('| Actor | Keyword | Unique posts | Buyer-like | Seller-like | Very short (<25 chars) |', '| --- | --- | --- | --- | --- | --- |');
  const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, posts] of rows) {
    const [actor, kw] = key.split(' | ');
    const buyer = posts.filter((p) => BUYER_RE.test(p.text) && !SELLER_RE.test(p.text)).length;
    const seller = posts.filter((p) => SELLER_RE.test(p.text)).length;
    const short = posts.filter((p) => p.text.trim().length < 25).length;
    lines.push(`| ${actor} | ${kw} | ${posts.length} | ${pct(buyer, posts.length)} | ${pct(seller, posts.length)} | ${pct(short, posts.length)} |`);
  }
  const returned = new Map<string, Set<string>>();
  for (const [key] of groups) {
    const [actor, kw] = key.split(' | ');
    returned.set(actor, (returned.get(actor) ?? new Set()).add(kw));
  }
  const asked = new Map<string, Set<string>>();
  for (const r of runs) {
    if (r.meta.itemCount === 0) continue;
    const s = asked.get(r.meta.actorKey) ?? new Set<string>();
    for (const k of r.meta.keywords) s.add(k);
    asked.set(r.meta.actorKey, s);
  }
  lines.push('', '### Keywords that returned nothing (per Actor that returned data)', '');
  for (const [actor, kws] of asked) {
    const got = returned.get(actor) ?? new Set<string>();
    const none = [...kws].filter((k) => !got.has(k));
    lines.push(`- ${actor}: ${none.length ? none.join(' | ') : 'none'}`);
  }
  lines.push('');
  return lines;
}

function main() {
  const runs = loadRuns();
  if (!runs.length) {
    console.log('No saved Apify runs in out/apify yet. Run "npm run apify" first.');
    return;
  }
  const kw = readJson<KeywordFile>(path.join(ROOT, 'keywords.json'));
  const md: string[] = ['# Phase 0: Apify run summary', '', `Generated ${new Date().toISOString()}`, ''];
  for (const run of runs.sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt))) {
    md.push(...analyzeRun(run, kw.negative ?? []));
  }
  md.push(...perKeyword(runs));
  const out = path.join(OUT, 'summary.md');
  fs.writeFileSync(out, md.join('\n'));
  console.log(md.join('\n'));
  console.log(`\nSaved: ${path.relative(ROOT, out)}`);
}

main();
