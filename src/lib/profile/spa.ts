// Fallback for websites that build their pages with JavaScript (React, Vue and similar single-page apps).
// Their HTML holds no text, but their own script files contain the page copy as text strings. We read those strings with
// plain pattern matching. The scripts are NEVER executed. Only scripts from the same site are fetched, through safe-fetch
// (same address checks, size and time limits, robots.txt).

import { fetchPage, type FetchLimits, type Robots, type Transport } from './safe-fetch';

const MAX_SCRIPTS = 8;
const MAX_SCRIPT_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 6_000_000;
const MAX_STRINGS = 500;
const MAX_TEXT_CHARS = 30_000;

// Library bundles hold no page copy.
const LIBRARY_NAME = /(?:^|[\\/._-])(vendor|polyfill|runtime|framework|react|vue|angular|lodash|jquery|moment|chunk-vendors|icons?|motion|utils?)(?:[._-]|$)/i;

const sameSite = (a: string, b: string) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** Script files referenced by the page itself: <script src> and <link rel="modulepreload">. Same site only. */
export function findScriptUrls(html: string, base: URL): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    try {
      const u = new URL(raw.trim(), base);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && sameSite(u.hostname, base.hostname) && /\.m?js(?:$|\?)/i.test(u.pathname + u.search)) {
        u.hash = '';
        out.add(u.toString());
      }
    } catch {
      // ignore bad urls
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2] ?? '');
  for (const m of html.matchAll(/<link\b[^>]*?\brel\s*=\s*["']modulepreload["'][^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2] ?? '');
  return [...out];
}

/** Lazy-loaded route files that an entry script points to, for example "./About-Dk3j2.js". Same directory only. */
export function findChunkRefs(js: string, scriptUrl: URL): string[] {
  const out = new Set<string>();
  for (const m of js.matchAll(/["'`]((?:\.\/|assets\/)?[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,12}\.m?js)["'`]/g)) {
    try {
      const u = new URL(m[1], scriptUrl);
      if (sameSite(u.hostname, scriptUrl.hostname)) out.add(u.toString());
    } catch {
      // ignore
    }
  }
  return [...out];
}

function unescapeJs(s: string): string {
  return s
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/\\u([0-9a-f]{4})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n|\\t|\\r/g, ' ')
    .replace(/\\(["'`\\/])/g, '$1');
}

const CODE_MARKERS = /[{}<>=;|]|=>|function\b|return\b|\.push\(|\bconst\b|\bvar\b|\bnull\b|\bundefined\b|https?:|\.js\b|\.css\b|\bimport\b|Invariant|Minified|\bwebpack\b|sourceMappingURL|\bTypeError\b|\bnew \w+\(/;

/** True for text that reads like human copy rather than code, CSS class lists or library messages. */
export function looksLikeCopy(s: string): boolean {
  const t = s.trim();
  if (t.length < 14 || t.length > 400) return false;
  if (CODE_MARKERS.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 3) return false;
  // CSS class lists ("mt-4 grid gap-4 md:grid-cols-2") and similar tokens: mostly lowercase words with -, :, / or digits.
  const codeish = words.filter((w) => /[:/\[\]()%]|^[a-z]+-[a-z0-9./-]+$|^-?[a-z]+-\d|^\d+(?:px|rem|em|%)?$/.test(w)).length;
  if (codeish / words.length > 0.3) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters / t.length < 0.6) return false;
  // Human copy has capital letters or sentence punctuation; a run of plain lowercase identifiers does not.
  if (!/\p{Lu}/u.test(t) && !/[.!?]/.test(t)) return false;
  return true;
}

/** Text strings that look like page copy, in order of first appearance, without duplicates. */
export function extractCopyStrings(js: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of js.matchAll(/"((?:[^"\\\n]|\\.){14,500})"|'((?:[^'\\\n]|\\.){14,500})'|`((?:[^`\\$]|\\.){14,500})`/g)) {
    const s = unescapeJs(m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, ' ').trim();
    if (!looksLikeCopy(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_STRINGS) break;
  }
  return out;
}

export type SpaText = { text: string; scripts: string[]; notes: string[] };

export async function readSpaText(
  homeHtml: string,
  homeUrl: URL,
  o: { transport: Transport; userAgent: string; robots: Robots; limits?: Partial<FetchLimits>; now: () => number; deadline: number },
): Promise<SpaText> {
  const notes: string[] = [];
  const queue = findScriptUrls(homeHtml, homeUrl).filter((u) => !LIBRARY_NAME.test(new URL(u).pathname.split('/').pop() ?? ''));
  const done = new Set<string>();
  const used: string[] = [];
  const strings: string[] = [];
  const seenText = new Set<string>();
  let bytes = 0;

  while (queue.length > 0 && used.length < MAX_SCRIPTS) {
    if (o.now() > o.deadline) {
      notes.push('Stopped reading script files because the time limit was reached.');
      break;
    }
    if (bytes > MAX_TOTAL_BYTES) {
      notes.push('Stopped reading script files because the size limit was reached.');
      break;
    }
    const url = queue.shift()!;
    if (done.has(url)) continue;
    done.add(url);
    const u = new URL(url);
    if (!o.robots.allowed(u.pathname + u.search)) continue;

    const r = await fetchPage(u, o.transport, { userAgent: o.userAgent, accept: 'js', limits: { ...o.limits, maxBytes: MAX_SCRIPT_BYTES } });
    if (!r.ok) continue;
    bytes += r.text.length;
    used.push(r.url);
    for (const s of extractCopyStrings(r.text)) {
      if (!seenText.has(s)) {
        seenText.add(s);
        strings.push(s);
      }
    }
    // Follow lazy-loaded route files from the entry scripts, skipping libraries.
    for (const c of findChunkRefs(r.text, new URL(r.url))) {
      if (!done.has(c) && !LIBRARY_NAME.test(new URL(c).pathname.split('/').pop() ?? '')) queue.push(c);
    }
  }

  let text = '';
  for (const s of strings) {
    if (text.length + s.length + 1 > MAX_TEXT_CHARS) break;
    text += `${s}\n`;
  }
  return { text: text.trim(), scripts: used, notes };
}
