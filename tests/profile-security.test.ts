import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isBlockedIp, isBlockedIPv4, isBlockedIPv6, validateUserUrl } from '../src/lib/profile/net-guard';
import { fetchPage, loadRobots, parseRobots, resolvePublic, type Resolved, type Transport, type TransportResponse } from '../src/lib/profile/safe-fetch';
import { extractLinks, extractPage, parseSitemap } from '../src/lib/profile/html';
import { scanSite } from '../src/lib/profile/scan';
import { createNodeTransport } from '../src/lib/profile/transport';

// ---- helpers ---------------------------------------------------------------------------------------

type Page = { status?: number; type?: string; body?: string; location?: string };
const html = (body: string): Page => ({ type: 'text/html; charset=utf-8', body });

/** A fake network: DNS table plus pages by URL. Records every DNS lookup and every request. */
function fakeNet(pages: Record<string, Page>, dns: Record<string, Resolved[]> = {}) {
  const resolved: string[] = [];
  const requests: { url: string; ip: string; headers: Record<string, string> }[] = [];
  const transport: Transport = {
    async resolve(host) {
      resolved.push(host);
      return dns[host] ?? [{ address: '93.184.216.34', family: 4 }];
    },
    async get({ url, ip, headers }): Promise<TransportResponse> {
      const key = url.toString();
      requests.push({ url: key, ip, headers });
      const p = pages[key];
      if (!p) return { status: 404, headers: {}, body: Buffer.from(''), truncated: false };
      const h: Record<string, string> = {};
      if (p.type) h['content-type'] = p.type;
      if (p.location) h.location = p.location;
      return { status: p.status ?? 200, headers: h, body: Buffer.from(p.body ?? ''), truncated: false };
    },
  };
  return { transport, resolved, requests };
}
const UA = { userAgent: 'LeadRadarBot/1.0 test' };

// ---- address and URL rules -------------------------------------------------------------------------

describe('blocked addresses', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.9.9.9', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '192.0.0.5', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '203.0.113.9',
  ])('blocks IPv4 %s', (ip) => expect(isBlockedIPv4(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1', '100.63.0.1', '100.128.0.1'])('allows public IPv4 %s', (ip) => expect(isBlockedIPv4(ip)).toBe(false));
  it.each([
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:db8::1', '::127.0.0.1', 'fd00:ec2::254',
  ])('blocks IPv6 %s', (ip) => expect(isBlockedIPv6(ip)).toBe(true));
  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('allows public IPv6 %s', (ip) => expect(isBlockedIPv6(ip)).toBe(false));
  it('refuses malformed addresses', () => {
    expect(isBlockedIPv4('1.2.3')).toBe(true);
    expect(isBlockedIPv4('300.1.1.1')).toBe(true);
    expect(isBlockedIPv6('zzzz::1')).toBe(true);
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('user supplied urls', () => {
  it('normalizes a good address', () => {
    expect(validateUserUrl('Example.com/Path?x=1#frag').toString()).toBe('https://example.com/Path?x=1');
    expect(validateUserUrl('http://www.example.com:80/').port).toBe('');
    expect(validateUserUrl('https://example.com.').hostname).toBe('example.com.');
  });
  it.each([
    'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com',
    'http://user:pass@example.com', 'http://example.com:8080', 'https://example.com:22', 'http://example.com:6379',
    'http://localhost', 'http://LOCALHOST:80/admin', 'http://127.0.0.1', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.5/',
    'http://192.168.0.1/router', 'http://169.254.169.254/latest/meta-data/', 'http://[fd00:ec2::254]/',
    'http://2130706433', 'http://0x7f.1', 'http://0177.0.0.1', 'http://127.1',
    'http://db.internal', 'http://printer.local', 'http://intranet', 'http://a.localhost',
    '', '   ', 'http://',
  ])('rejects %s', (u) => expect(() => validateUserUrl(u)).toThrow());
});

// ---- fetching --------------------------------------------------------------------------------------

describe('safe fetch', () => {
  it('connects to the address it checked and sends an honest user agent without asking for compression', async () => {
    const { transport, requests } = fakeNet({ 'https://example.com/': html('<p>hi there friend</p>') }, { 'example.com': [{ address: '93.184.216.34', family: 4 }] });
    const r = await fetchPage('https://example.com/', transport, UA);
    expect(r.ok).toBe(true);
    expect(requests[0].ip).toBe('93.184.216.34');
    expect(requests[0].headers['User-Agent']).toContain('LeadRadarBot');
    expect(requests[0].headers['Accept-Encoding']).toBe('identity');
  });
  it('refuses a public looking name that resolves to a private address (DNS rebinding)', async () => {
    const { transport, requests } = fakeNet({}, { 'evil.example.com': [{ address: '127.0.0.1', family: 4 }] });
    const r = await fetchPage('https://evil.example.com/', transport, UA);
    expect(r).toMatchObject({ ok: false, reason: 'blocked' });
    expect(requests).toHaveLength(0);
  });
  it('refuses when only ONE of several addresses is private', async () => {
    const { transport, requests } = fakeNet({}, { 'mixed.example.com': [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }] });
    expect((await fetchPage('https://mixed.example.com/', transport, UA)).ok).toBe(false);
    expect(requests).toHaveLength(0);
    await expect(resolvePublic('mixed.example.com', transport)).rejects.toThrow(/private or internal/);
  });
  it('re-checks every redirect target: internal addresses and localhost are refused', async () => {
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://localhost/admin', 'http://10.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'http://example.com:8080/']) {
      const { transport, requests } = fakeNet({ 'https://example.com/': { status: 302, location: target } });
      const r = await fetchPage('https://example.com/', transport, UA);
      expect(r, target).toMatchObject({ ok: false });
      expect(requests.every((q) => q.url === 'https://example.com/'), target).toBe(true);
    }
  });
  it('refuses a redirect whose new host name resolves to a private address', async () => {
    const { transport, requests } = fakeNet({ 'https://example.com/': { status: 301, location: 'https://www.example.com/x' } }, { 'www.example.com': [{ address: '192.168.1.5', family: 4 }] });
    expect(await fetchPage('https://example.com/', transport, UA)).toMatchObject({ ok: false, reason: 'blocked' });
    expect(requests).toHaveLength(1);
  });
  it('follows a redirect inside the same site and resolves DNS again for it', async () => {
    const { transport, resolved } = fakeNet({
      'https://example.com/': { status: 301, location: 'https://www.example.com/home' },
      'https://www.example.com/home': html('<p>welcome to the site</p>'),
    });
    const r = await fetchPage('https://example.com/', transport, UA);
    expect(r).toMatchObject({ ok: true, url: 'https://www.example.com/home' });
    expect(resolved).toEqual(['example.com', 'www.example.com']);
  });
  it('does not follow redirects to another site', async () => {
    const { transport } = fakeNet({ 'https://example.com/': { status: 302, location: 'https://other-site.org/' } });
    expect(await fetchPage('https://example.com/', transport, UA)).toMatchObject({ ok: false, reason: 'offsite_redirect' });
  });
  it('gives up after too many redirects', async () => {
    const pages: Record<string, Page> = {};
    for (let i = 0; i < 10; i++) pages[`https://example.com/${i}`] = { status: 302, location: `/${i + 1}` };
    const { transport } = fakeNet(pages);
    expect(await fetchPage('https://example.com/0', transport, UA)).toMatchObject({ ok: false, reason: 'too_many_redirects' });
  });
  it('accepts only HTML, and reports errors and network failures without crashing', async () => {
    const { transport } = fakeNet({
      'https://example.com/a.pdf': { type: 'application/pdf', body: '%PDF' },
      'https://example.com/boom': { status: 500 },
      'https://example.com/plain': { type: 'text/plain', body: 'x' },
    });
    expect(await fetchPage('https://example.com/a.pdf', transport, UA)).toMatchObject({ ok: false, reason: 'unsupported_type' });
    expect(await fetchPage('https://example.com/plain', transport, UA)).toMatchObject({ ok: false, reason: 'unsupported_type' });
    expect(await fetchPage('https://example.com/boom', transport, UA)).toMatchObject({ ok: false, reason: 'http_error', status: 500 });
    expect(await fetchPage('https://example.com/missing', transport, UA)).toMatchObject({ ok: false, reason: 'not_found' });
    const down: Transport = { async resolve() { return [{ address: '93.184.216.34', family: 4 }]; }, async get() { throw new Error('connect ECONNREFUSED'); } };
    expect(await fetchPage('https://example.com/', down, UA)).toMatchObject({ ok: false, reason: 'network' });
    const nx: Transport = { async resolve() { throw new Error('ENOTFOUND'); }, async get() { throw new Error('unreachable'); } };
    expect(await fetchPage('https://nope.example.com/', nx, UA)).toMatchObject({ ok: false, reason: 'no_address' });
  });
  it('blocks a bad start address before any DNS lookup', async () => {
    const { transport, resolved } = fakeNet({});
    expect(await fetchPage('http://127.0.0.1/', transport, UA)).toMatchObject({ ok: false, reason: 'blocked' });
    expect(resolved).toHaveLength(0);
  });
});

describe('robots.txt', () => {
  it('applies the longest matching rule, wildcards and end anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nDisallow: /tmp/*/x\nSitemap: https://e.com/sm.xml');
    expect(r.allowed('/about')).toBe(true);
    expect(r.allowed('/private/data')).toBe(false);
    expect(r.allowed('/private/public/page')).toBe(true);
    expect(r.allowed('/files/a.pdf')).toBe(false);
    expect(r.allowed('/files/a.pdf?x=1')).toBe(true);
    expect(r.allowed('/tmp/1/x')).toBe(false);
    expect(r.sitemaps).toEqual(['https://e.com/sm.xml']);
  });
  it('prefers the group for our own agent, and treats an empty Disallow as allow all', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: LeadRadarBot\nDisallow: /secret\n');
    expect(r.allowed('/')).toBe(true);
    expect(r.allowed('/secret/x')).toBe(false);
    expect(parseRobots('User-agent: *\nDisallow:').allowed('/anything')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /').allowed('/anything')).toBe(false);
  });
  it('4xx means no rules, but 5xx or an unreachable server means do not scan', async () => {
    const origin = new URL('https://example.com/');
    expect((await loadRobots(origin, fakeNet({}).transport, 'ua')).allowed('/x')).toBe(true);
    const err = fakeNet({ 'https://example.com/robots.txt': { status: 503 } }).transport;
    expect((await loadRobots(origin, err, 'ua')).unreachable).toBe(true);
    const down: Transport = { async resolve() { return [{ address: '93.184.216.34', family: 4 }]; }, async get() { throw new Error('reset'); } };
    expect((await loadRobots(origin, down, 'ua')).unreachable).toBe(true);
  });
});

// ---- html ------------------------------------------------------------------------------------------

describe('html extraction', () => {
  const base = new URL('https://www.example.com/');
  it('drops scripts and styles, decodes entities, removes repeated lines and never returns tags', () => {
    const x = extractPage(
      '<html><head><title>Acme &amp; Co</title><meta name="description" content="We build apps"><style>.a{}</style></head><body><script>steal()</script><h1>Web Development</h1><p>Custom &lt;b&gt; sites</p><p>Custom &lt;b&gt; sites</p><!-- hidden --><svg><text>x</text></svg></body></html>',
      base,
    );
    expect(x.title).toBe('Acme & Co');
    expect(x.description).toBe('We build apps');
    expect(x.text).toContain('Web Development');
    expect(x.text.match(/Custom <b> sites/g)).toHaveLength(1);
    expect(x.text).not.toContain('steal');
    expect(x.text).not.toContain('hidden');
    expect(x.text).not.toMatch(/<script|<h1/);
  });
  it('keeps only same-site page links', () => {
    const links = extractLinks(
      '<a href="/services">s</a><a href="https://example.com/about#top">a</a><a href="https://other.org/x">o</a><a href="mailto:a@b.c">m</a><a href="/file.pdf">p</a><a href="javascript:alert(1)">j</a><a href="#x">h</a><a href="/services">dup</a>',
      base,
    );
    expect(links.sort()).toEqual(['https://example.com/about', 'https://www.example.com/services']);
  });
  it('reads sitemap urls', () => {
    expect(parseSitemap('<urlset><url><loc> https://e.com/a </loc></url><url><loc>https://e.com/b?x=1&amp;y=2</loc></url></urlset>')).toEqual(['https://e.com/a', 'https://e.com/b?x=1&y=2']);
  });
});

// ---- scanning a whole site -------------------------------------------------------------------------

const SITE = 'https://acme.example.com';
function siteWith(extra: Record<string, Page> = {}) {
  const longText = (t: string) => `<p>${t} ${'We deliver quality work for growing companies around the world. '.repeat(4)}</p>`;
  return fakeNet({
    [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin\nDisallow: /private' },
    [`${SITE}/`]: html(`<title>Acme</title><a href="/services">Services</a><a href="/blog/post-1">Blog</a><a href="/admin/users">Admin</a><a href="https://evil.example.org/steal">x</a><a href="/about">About</a><a href="/private/plans">Private</a>${longText('Acme software company')}`),
    [`${SITE}/services`]: html(longText('Website development, mobile apps, AI agents')),
    [`${SITE}/about`]: html(longText('About the team')),
    [`${SITE}/blog/post-1`]: html(longText('Blog')),
    [`${SITE}/admin/users`]: html(longText('SECRET ADMIN')),
    [`${SITE}/private/plans`]: html(longText('SECRET PLANS')),
    ...extra,
  });
}

describe('site scan', () => {
  it('reads service pages first, respects robots.txt, ignores other sites and skips the blog', async () => {
    const { transport, requests } = siteWith();
    const r = await scanSite(`${SITE}/`, { transport });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const urls = r.pages.map((p) => p.url);
    expect(urls[0]).toBe(`${SITE}/`);
    expect(urls).toContain(`${SITE}/services`);
    expect(urls).toContain(`${SITE}/about`);
    expect(urls).not.toContain(`${SITE}/blog/post-1`);
    expect(urls).not.toContain(`${SITE}/admin/users`);
    expect(r.pages.map((p) => p.text).join(' ')).not.toContain('SECRET');
    expect(r.notes.join(' ')).toMatch(/robots\.txt/);
    expect(requests.every((q) => new URL(q.url).hostname === 'acme.example.com')).toBe(true);
  });
  it('reads a page only once even when it is linked with a www or trailing-slash variant', async () => {
    const { transport, requests } = siteWith({
      [`${SITE}/`]: html(`<a href="/services">a</a><a href="/services/">b</a><a href="https://www.acme.example.com/services">c</a><p>${'Acme builds software for growing companies. '.repeat(10)}</p>`),
      'https://www.acme.example.com/services': html('<p>Website development for clients. </p>'),
      [`${SITE}/services/`]: html('<p>Website development for clients. </p>'),
    });
    const r = await scanSite(`${SITE}/`, { transport });
    expect(r.ok).toBe(true);
    expect(requests.filter((q) => /\/services\/?$/.test(q.url)).length).toBeLessThanOrEqual(1);
  });
  it('honours the page limit', async () => {
    const { transport } = siteWith();
    const r = await scanSite(`${SITE}/`, { transport, maxPages: 2 });
    expect(r.ok && r.pages.length).toBe(2);
    expect(r.ok && r.notes.join(' ')).toMatch(/page limit/);
  });
  it('stops when the time budget is over', async () => {
    const { transport } = siteWith();
    let t = 0;
    const r = await scanSite(`${SITE}/`, { transport, timeBudgetMs: 10, now: () => (t += 50) });
    expect(r.ok && r.notes.join(' ')).toMatch(/time limit/);
  });
  it('refuses when robots.txt forbids the site or cannot be read', async () => {
    const closed = fakeNet({ [`${SITE}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /' }, [`${SITE}/`]: html('<p>x</p>') });
    expect(await scanSite(`${SITE}/`, { transport: closed.transport })).toMatchObject({ ok: false, error: expect.stringContaining('robots.txt') });
    const broken = fakeNet({ [`${SITE}/robots.txt`]: { status: 500 } });
    expect(await scanSite(`${SITE}/`, { transport: broken.transport })).toMatchObject({ ok: false, error: expect.stringContaining('robots.txt') });
  });
  it('never touches the network for an internal address', async () => {
    const { transport, requests, resolved } = fakeNet({});
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'file:///etc/passwd']) {
      expect(await scanSite(u, { transport })).toMatchObject({ ok: false });
    }
    expect(requests).toHaveLength(0);
    expect(resolved).toHaveLength(0);
  });
  it('refuses a site whose name resolves to a private address', async () => {
    const { transport, requests } = fakeNet({}, { 'sneaky.example.com': [{ address: '10.0.0.7', family: 4 }] });
    expect(await scanSite('https://sneaky.example.com/', { transport })).toMatchObject({ ok: false });
    expect(requests).toHaveLength(0);
  });
  it('tells the user when a site has no readable text (JavaScript only)', async () => {
    const { transport } = fakeNet({ [`${SITE}/`]: html('<div id="root"></div><script src="/app.js"></script>') });
    const r = await scanSite(`${SITE}/`, { transport });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('by hand') });
  });
});

// ---- the real transport, against a local server ------------------------------------------------------

describe('node transport (real sockets, loopback only)', () => {
  function serve(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ port: (s.address() as AddressInfo).port, close: () => new Promise((r) => s.close(() => r())) }));
    });
  }
  const t = createNodeTransport();

  it('is pinned to the given address: the name in the url is never looked up', async () => {
    let seenHost = '';
    const srv = await serve((req, res) => {
      seenHost = String(req.headers.host);
      res.setHeader('content-type', 'text/html');
      res.end('<p>pinned</p>');
    });
    try {
      const r = await t.get({ url: new URL(`http://this-name-does-not-exist.invalid:${srv.port}/x`), ip: '127.0.0.1', family: 4, headers: {}, timeoutMs: 3000, maxBytes: 1000 });
      expect(r.body.toString()).toBe('<p>pinned</p>');
      expect(r.headers['content-type']).toBe('text/html');
      expect(seenHost).toContain('this-name-does-not-exist.invalid');
    } finally {
      await srv.close();
    }
  });
  it('stops reading a huge response at the size limit', async () => {
    const srv = await serve((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.write('a'.repeat(50_000));
      res.end('b'.repeat(50_000));
    });
    try {
      const r = await t.get({ url: new URL(`http://127.0.0.1:${srv.port}/`), ip: '127.0.0.1', family: 4, headers: {}, timeoutMs: 3000, maxBytes: 10_000 });
      expect(r.truncated).toBe(true);
      expect(r.body.length).toBeLessThanOrEqual(10_000);
    } finally {
      await srv.close();
    }
  });
  it('gives up on a server that never answers', async () => {
    const srv = await serve(() => {
      /* never respond */
    });
    try {
      await expect(t.get({ url: new URL(`http://127.0.0.1:${srv.port}/`), ip: '127.0.0.1', family: 4, headers: {}, timeoutMs: 200, maxBytes: 1000 })).rejects.toThrow(/timed out/);
    } finally {
      await srv.close();
    }
  });
});
