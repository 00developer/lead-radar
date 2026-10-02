// URL and address checks for fetching user-supplied websites (docs/architecture.md section 16, AGENTS.md rule 12).
// This is a security boundary: a user must never be able to make the server call an internal address.
// Pure functions, no network.

import net from 'node:net';

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home', '.corp', '.private'];

/** True when the IPv4 address (dotted quad) is not a normal public internet address. */
export function isBlockedIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed: refuse
  const [a, b, c] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // documentation
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands an IPv6 address to 8 groups of 16 bits. Returns null when it cannot be parsed. */
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 in the last 32 bits, for example ::ffff:127.0.0.1
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const q = v4[1].split('.').map(Number);
    if (q.some((n) => n > 255)) return null;
    s = s.slice(0, s.length - v4[1].length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** True when the IPv6 address is not a normal public internet address. IPv4-mapped and NAT64 forms are checked as IPv4. */
export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // malformed: refuse
  const allZeroExceptLast = g.slice(0, 7).every((x) => x === 0);
  if (allZeroExceptLast && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedIPv4(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0) return true; // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIPv4(embedded(g[6], g[7])); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return isBlockedIPv4(embedded(g[1], g[2])); // 6to4 embeds an IPv4 address
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // not an IP address at all
}

/**
 * Validates a URL typed by a user. Only http and https, no credentials, only the standard ports, and never a private or
 * internal host name or address literal. Returns the normalized URL. DNS results are checked separately (safe-fetch).
 */
export function validateUserUrl(input: string): URL {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 2000) throw new BlockedUrlError('Enter a website address.');
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new BlockedUrlError('That is not a valid web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedUrlError('Only http and https addresses are allowed.');
  if (u.username || u.password) throw new BlockedUrlError('Addresses with a user name or password are not allowed.');
  const port = u.port === '' ? (u.protocol === 'https:' ? '443' : '80') : u.port;
  if (port !== '80' && port !== '443') throw new BlockedUrlError('Only the standard ports 80 and 443 are allowed.');
  u.port = '';
  u.hash = '';

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new BlockedUrlError('That is not a valid web address.');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError('That address points to a private or internal network and cannot be fetched.');
  } else {
    if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new BlockedUrlError('That address points to a private or internal network and cannot be fetched.');
    if (!host.includes('.')) throw new BlockedUrlError('Enter a full website address such as example.com.');
    // Odd numeric forms such as 2130706433 or 0x7f.1 are turned into an IP by URL parsing, so they are caught above.
    if (/^[0-9.x]+$/i.test(host)) throw new BlockedUrlError('That address is not allowed.');
  }
  return u;
}
