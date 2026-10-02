// Turns fetched HTML into plain text and a list of same-site links. Website content is untrusted data: it is only ever
// turned into text (never rendered as HTML) and handed to the model as data.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: '(c)' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK_TAGS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|section|article|header|footer|nav|main|aside|tr|td|th|table|blockquote|form|figure|figcaption|dl|dt|dd|hr)\b[^>]*>/gi;

export type ExtractedPage = { title: string; description: string; text: string; links: string[] };

const SKIP_EXT = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|gz|mp4|mp3|mov|avi|css|js|json|xml|txt|docx?|xlsx?|pptx?)(?:$|\?)/i;

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '');
}

export function extractLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript|data|sms):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !sameSite(u.hostname, base.hostname) || SKIP_EXT.test(u.pathname + u.search)) continue;
    u.hash = '';
    out.add(u.toString());
  }
  return [...out];
}

export function extractPage(html: string, base: URL): ExtractedPage {
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ')).trim();
  const desc =
    /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']description["']/i.exec(html)?.[1] ??
    '';
  const links = extractLinks(html, base);

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|select|option)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ');
  body = decodeEntities(body);

  const lines: string[] = [];
  let prev = '';
  for (const raw of body.split('\n')) {
    const line = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 2 || line === prev) continue;
    lines.push(line);
    prev = line;
  }
  return { title, description: decodeEntities(desc).replace(/\s+/g, ' ').trim(), text: lines.join('\n'), links };
}

/** All <loc> URLs of a sitemap (or sitemap index). Only the first 500 are read. */
export function parseSitemap(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    out.push(decodeEntities(m[1]));
    if (out.length >= 500) break;
  }
  return out;
}
