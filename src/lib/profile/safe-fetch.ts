// SSRF-safe page fetcher (docs/architecture.md section 16, AGENTS.md rule 12).
//
// Rules enforced here:
//  * only http/https on ports 80/443, no credentials, no private or internal names (net-guard)
//  * DNS is resolved by us; EVERY returned address must be public; the connection is pinned to the checked address,
//    so DNS cannot change between the check and the request
//  * redirects are followed manually (max 4), every target goes through all checks again, and only within the same site
//  * only HTML (and XML for sitemaps), response size and time are capped, no compression is requested
//  * robots.txt is respected; an honest User-Agent names the product
// The network is behind the Transport interface so all of this is testable without a network.

import { BlockedUrlError, isBlockedIp, validateUserUrl } from './net-guard';

export type Resolved = { address: string; family: 4 | 6 };

export type TransportResponse = { status: number; headers: Record<string, string>; body: Buffer; truncated: boolean };

export interface Transport {
  resolve(host: string): Promise<Resolved[]>;
  get(req: { url: URL; ip: string; family: 4 | 6; headers: Record<string, string>; timeoutMs: number; maxBytes: number }): Promise<TransportResponse>;
}

export type FetchLimits = { timeoutMs: number; maxBytes: number; maxRedirects: number };
export const DEFAULT_LIMITS: FetchLimits = { timeoutMs: 8_000, maxBytes: 1_000_000, maxRedirects: 4 };

export const USER_AGENT_TOKEN = 'LeadRadarBot';

export function userAgent(appUrl?: string): string {
  return `${USER_AGENT_TOKEN}/1.0 (business profile scan requested by the site's owner or a user; ${appUrl ?? 'no site url'})`;
}

export type FetchResult =
  | { ok: true; url: string; status: number; contentType: string; text: string; truncated: boolean }
  | { ok: false; reason: 'blocked' | 'not_found' | 'http_error' | 'unsupported_type' | 'offsite_redirect' | 'too_many_redirects' | 'network' | 'no_address'; message: string; status?: number };

const sameSite = (a: string, b: string) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/** Resolves the host and refuses it unless every address is public. Returns the address to connect to. */
export async function resolvePublic(host: string, t: Transport): Promise<Resolved> {
  let list: Resolved[];
  try {
    list = await t.resolve(host);
  } catch {
    throw new BlockedUrlError(`The address ${host} could not be found.`);
  }
  if (list.length === 0) throw new BlockedUrlError(`The address ${host} could not be found.`);
  for (const r of list) {
    if (isBlockedIp(r.address)) throw new BlockedUrlError('That address points to a private or internal network and cannot be fetched.');
  }
  return list[0];
}

function contentTypeOf(headers: Record<string, string>): string {
  return (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
}

export async function fetchPage(
  input: string | URL,
  t: Transport,
  o: { userAgent: string; limits?: Partial<FetchLimits>; accept?: 'html' | 'xml' | 'robots' | 'js' } = { userAgent: userAgent() },
): Promise<FetchResult> {
  const limits = { ...DEFAULT_LIMITS, ...o.limits };
  let current: URL;
  try {
    current = validateUserUrl(typeof input === 'string' ? input : input.toString());
  } catch (e) {
    return { ok: false, reason: 'blocked', message: e instanceof Error ? e.message : 'Blocked address.' };
  }
  const origin = current.hostname;

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    let addr: Resolved;
    try {
      addr = await resolvePublic(current.hostname, t);
    } catch (e) {
      return { ok: false, reason: e instanceof BlockedUrlError && /could not be found/.test(e.message) ? 'no_address' : 'blocked', message: e instanceof Error ? e.message : 'Blocked address.' };
    }

    let res: TransportResponse;
    try {
      res = await t.get({
        url: current, ip: addr.address, family: addr.family, timeoutMs: limits.timeoutMs, maxBytes: limits.maxBytes,
        headers: {
          'User-Agent': o.userAgent,
          Accept: o.accept === 'xml' ? 'application/xml,text/xml,*/*;q=0.5' : o.accept === 'robots' ? 'text/plain,*/*;q=0.5' : o.accept === 'js' ? 'application/javascript,text/javascript,*/*;q=0.5' : 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
        },
      });
    } catch (e) {
      return { ok: false, reason: 'network', message: `Could not load ${current.hostname}: ${e instanceof Error ? e.message.slice(0, 120) : 'network error'}` };
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.location;
      if (!loc) return { ok: false, reason: 'http_error', status: res.status, message: 'The site sent a redirect without a target.' };
      let next: URL;
      try {
        next = validateUserUrl(new URL(loc, current).toString()); // every redirect target is checked like a fresh address
      } catch (e) {
        return { ok: false, reason: 'blocked', message: e instanceof Error ? e.message : 'Blocked redirect.' };
      }
      if (!sameSite(next.hostname, origin)) return { ok: false, reason: 'offsite_redirect', message: `The site redirects to another site (${next.hostname}). Enter the final address.` };
      current = next;
      continue;
    }
    if (res.status === 404 || res.status === 410) return { ok: false, reason: 'not_found', status: res.status, message: 'Page not found.' };
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http_error', status: res.status, message: `The site answered with HTTP ${res.status}.` };

    const ct = contentTypeOf(res.headers);
    const okType =
      o.accept === 'robots' ? ct === '' || ct.startsWith('text/')
      : o.accept === 'xml' ? /xml/.test(ct) || ct === 'text/plain'
      : o.accept === 'js' ? /javascript|ecmascript/.test(ct) || ct === 'text/plain'
      : ct === 'text/html' || ct === 'application/xhtml+xml';
    if (!okType) return { ok: false, reason: 'unsupported_type', message: `Unsupported content type: ${ct || 'unknown'}.` };
    return { ok: true, url: current.toString(), status: res.status, contentType: ct, text: res.body.toString('utf8'), truncated: res.truncated };
  }
  return { ok: false, reason: 'too_many_redirects', message: 'The site redirected too many times.' };
}

// ---- robots.txt ------------------------------------------------------------------------------------

export type Robots = { allowed(pathAndQuery: string): boolean; sitemaps: string[]; unreachable: boolean };

const ALLOW_ALL: Robots = { allowed: () => true, sitemaps: [], unreachable: false };
const DENY_ALL: Robots = { allowed: () => false, sitemaps: [], unreachable: true };

export function parseRobots(text: string, agentToken: string = USER_AGENT_TOKEN): Robots {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (cur && val !== '') cur.rules.push({ allow: key === 'allow', path: val });
    } else if (key === 'sitemap') {
      lastWasAgent = false;
      sitemaps.push(val);
    } else lastWasAgent = false;
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);

  const toRegex = (p: string) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return {
    sitemaps,
    unreachable: false,
    allowed(pathAndQuery: string): boolean {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (toRegex(r.path).test(pathAndQuery)) {
          const len = r.path.length;
          if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
        }
      }
      return best ? best.allow : true;
    },
  };
}

/** 4xx means "no rules" (allowed). Unreachable or 5xx means we cannot tell, so we do not scan. */
export async function loadRobots(origin: URL, t: Transport, ua: string): Promise<Robots> {
  const r = await fetchPage(new URL('/robots.txt', origin), t, { userAgent: ua, accept: 'robots', limits: { maxBytes: 200_000 } });
  if (r.ok) return parseRobots(r.text);
  if (r.reason === 'not_found' || (r.reason === 'http_error' && r.status !== undefined && r.status >= 400 && r.status < 500)) return ALLOW_ALL;
  if (r.reason === 'unsupported_type') return ALLOW_ALL;
  return DENY_ALL;
}
