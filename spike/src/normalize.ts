// Maps different Actor output shapes to one shape. Field names are taken from each Actor's page
// (2026-09-30). Unknown or missing fields become null, and the raw item is always kept.
// Phase 0 finding to record: which fields each Actor really returns (see analyze.ts).

export type NormalizedPost = {
  actor: string;
  id: string;
  url: string | null;
  text: string;
  username: string | null;
  postedAt: string | null;
  replyCount: number | null;
  keyword: string | null;
  bio?: string | null;
  followers?: number | null;
  language?: string | null;
  raw: Record<string, unknown>;
};

function get(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function first(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function toIso(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v; // seconds or milliseconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function normalize(actor: string, item: Record<string, unknown>): NormalizedPost | null {
  const text = first(item, ['text', 'caption', 'content', 'post.text']);
  const idRaw = first(item, ['postId', 'id', 'pk', 'postCode', 'code', 'post.id']);
  if (typeof text !== 'string' || idRaw === null) return null;
  const replyRaw = first(item, ['replyCount', 'repliesCount', 'replies', 'directReplyCount']);
  const kwRaw = first(item, ['keywordMatched', 'searchQuery', 'search_query', 'query', 'keyword']);
  return {
    actor,
    id: String(idRaw),
    url: (first(item, ['url', 'permalink', 'postUrl']) as string | null) ?? null,
    text,
    username: (first(item, ['username', 'handle', 'author.username', 'user.username']) as string | null) ?? null,
    postedAt: toIso(first(item, ['takenAt', 'date', 'publishedAt', 'publishedAtTs', 'timestamp', 'createdAt', 'postedAt'])),
    replyCount: typeof replyRaw === 'number' ? replyRaw : null,
    keyword: typeof kwRaw === 'string' ? kwRaw : null,
    bio: (first(item, ['bio', 'biography', 'author.bio']) as string | null) ?? null,
    followers: typeof first(item, ['followers', 'followerCount']) === 'number' ? (first(item, ['followers', 'followerCount']) as number) : null,
    language: (first(item, ['language']) as string | null) ?? null,
    raw: item,
  };
}
