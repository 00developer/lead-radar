// Scans a website for the Business Profile: a few pages, safely (docs/architecture.md section 16). Plain HTML only:
// If a site builds its pages with JavaScript (a single-page app), the copy is read from its own script files as plain text
// (never executed, same site only). If that finds nothing either, the user is told to paste the text or add items by hand.

import { extractPage, parseSitemap } from './html';
import { fetchPage, loadRobots, userAgent, type FetchLimits, type Transport } from './safe-fetch';
import { validateUserUrl } from './net-guard';
import { readSpaText } from './spa';

export type ScannedPage = { url: string; title: string; description: string; text: string };

export type ScanOptions = {
  transport: Transport;
  appUrl?: string;
  maxPages?: number; // proposed 10 to 20 (open question); default 12
  maxTotalBytes?: number;
  timeBudgetMs?: number;
  limits?: Partial<FetchLimits>;
  now?: () => number;
};

export type ScanResult = { ok: true; pages: ScannedPage[]; notes: string[] } | { ok: false; error: string };

// Pages that usually describe what a business sells come first.
const HINTS = ['service', 'solution', 'product', 'what-we-do', 'offering', 'work', 'capabilit', 'expertise', 'development', 'pricing', 'portfolio', 'about', 'industr', 'platform', 'app', 'web', 'ai', 'automation'];
const AVOID = ['blog', 'news', 'privacy', 'terms', 'cookie', 'login', 'signin', 'sign-in', 'register', 'cart', 'checkout', 'career', 'job', 'tag/', 'category/', 'author/', 'wp-json', 'feed'];

export function scoreUrl(u: URL): number {
  const p = (u.pathname + u.search).toLowerCase();
  if (AVOID.some((a) => p.includes(a))) return -1;
  let s = 0;
  for (const h of HINTS) if (p.includes(h)) s += 2;
  s -= Math.min(3, p.split('/').filter(Boolean).length - 1); // shallow pages first
  return s;
}

const pageKey = (u: string) => {
  const x = new URL(u);
  return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`;
};

export async function scanSite(input: string, o: ScanOptions): Promise<ScanResult> {
  const now = o.now ?? Date.now;
  const started = now();
  const deadline = started + (o.timeBudgetMs ?? 60_000);
  const maxPages = Math.min(20, Math.max(1, o.maxPages ?? 12));
  const maxBytes = o.maxTotalBytes ?? 5_000_000;
  const ua = userAgent(o.appUrl);
  const notes: string[] = [];

  let root: URL;
  try {
    root = validateUserUrl(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'That address cannot be used.' };
  }

  const robots = await loadRobots(root, o.transport, ua);
  if (robots.unreachable) return { ok: false, error: "The site's robots.txt could not be read, so the site was not scanned. Try again later or add offerings by hand." };

  const path = (u: URL) => u.pathname + u.search;
  if (!robots.allowed(path(root))) return { ok: false, error: "The site's robots.txt does not allow scanning this address. Add offerings by hand." };

  const home = await fetchPage(root, o.transport, { userAgent: ua, limits: o.limits });
  if (!home.ok) return { ok: false, error: home.message };
  const homeUrl = new URL(home.url);

  const pages: ScannedPage[] = [];
  let bytes = 0;
  const seen = new Set<string>();
  const take = (url: string, html: string) => {
    seen.add(pageKey(url));
    const x = extractPage(html, new URL(url));
    bytes += html.length;
    pages.push({ url, title: x.title, description: x.description, text: x.text });
    return x;
  };
  const homePage = take(home.url, home.text);

  // Candidate pages: links from the home page and the sitemap (same site only, allowed by robots.txt).
  const candidates = new Set<string>(homePage.links);
  // Only sitemaps on the site itself are fetched. A robots.txt that points to another address must not be able to make this
  // server call that address (it is also usually a typo or an old domain).
  const siteHost = homeUrl.hostname.replace(/^www./, '');
  const onSite = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www./, '') === siteHost;
    } catch {
      return false;
    }
  };
  const offSite = robots.sitemaps.filter((u) => !onSite(u));
  for (const u of offSite.slice(0, 1)) {
    try {
      notes.push(`The sitemap named in robots.txt is on another address (${new URL(u).hostname}), so it was not used.`);
    } catch {
      // ignore
    }
  }
  const sitemapUrls = robots.sitemaps.filter(onSite);
  if (sitemapUrls.length === 0) sitemapUrls.push(new URL('/sitemap.xml', homeUrl).toString());
  for (const sm of sitemapUrls.slice(0, 2)) {
    if (now() > deadline) break;
    const r = await fetchPage(sm, o.transport, { userAgent: ua, accept: 'xml', limits: { ...o.limits, maxBytes: 500_000 } });
    if (!r.ok) continue;
    for (const loc of parseSitemap(r.text)) {
      try {
        const u = new URL(loc);
        if (u.hostname.replace(/^www./, '') === siteHost && !/.xml$/i.test(u.pathname)) candidates.add(u.toString());
      } catch {
        // ignore bad entries
      }
    }
  }

  let skippedByRobots = 0;
  const ranked = [...candidates]
    .map((c) => {
      try {
        return { url: c, u: new URL(c) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { url: string; u: URL } => x !== null && !seen.has(pageKey(x.url)))
    .filter((x) => {
      if (!robots.allowed(path(x.u))) {
        skippedByRobots += 1;
        return false;
      }
      return true;
    })
    .map((x) => ({ ...x, score: scoreUrl(x.u) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);

  for (const c of ranked) {
    if (pages.length >= maxPages) {
      notes.push(`Stopped at the page limit of ${maxPages} pages.`);
      break;
    }
    if (now() > deadline) {
      notes.push('Stopped because the time limit for a scan was reached.');
      break;
    }
    if (bytes > maxBytes) {
      notes.push('Stopped because the size limit for a scan was reached.');
      break;
    }
    if (seen.has(pageKey(c.url))) continue; // the same page reached through a www or trailing-slash variant
    const r = await fetchPage(c.url, o.transport, { userAgent: ua, limits: o.limits });
    if (r.ok && !seen.has(pageKey(r.url))) take(r.url, r.text);
  }
  if (skippedByRobots > 0) notes.push(`${skippedByRobots} page(s) were skipped because robots.txt does not allow them.`);

  const totalText = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalText < 200) {
    // The pages hold no text: most likely a JavaScript app. Read the text out of its own script files.
    const spa = await readSpaText(home.text, homeUrl, { transport: o.transport, userAgent: ua, robots, limits: o.limits, now, deadline });
    notes.push(...spa.notes);
    if (spa.text.length >= 200) {
      pages.push({ url: spa.scripts[0], title: "Text found in the site's own script files", description: '', text: spa.text });
      notes.push(`This site builds its pages with JavaScript, so the text was read from ${spa.scripts.length} of its script file(s) (the scripts were not run). Check the list carefully.`);
      return { ok: true, pages, notes };
    }
    return {
      ok: false,
      error: 'This site builds its content with JavaScript and almost no text could be read from it. Paste the text of your services page into the box below, or add your products and services by hand.',
    };
  }
  return { ok: true, pages, notes };
}
