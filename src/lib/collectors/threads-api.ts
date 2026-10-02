// Official Threads keyword search collector (docs/architecture.md 6a).
// Verified against Meta's docs on 2026-09-30 (docs/sources.md): GET graph.threads.net/v1.0/keyword_search with
// q, search_type, fields, limit, since and the access_token query parameter. The response is { "data": [...] } and the
// docs show no paging object, so this collector does NOT paginate. Token lifetime and refresh are not handled here
// (Phase 2 OAuth). Before Meta approves `threads_keyword_search` the API returns only the token owner's own posts.

import type { Collector, CollectorRunInput, CollectorRunResult, RawPost } from './types';

const ENDPOINT = 'https://graph.threads.net/v1.0/keyword_search';
const FIELDS = 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply';
const QUERY_BUDGET_PER_24H = 2200;

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type ThreadsItem = {
  id?: string;
  text?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
  is_reply?: boolean;
};

export function mapThreadsItem(item: ThreadsItem, keyword: string): RawPost | null {
  if (!item.id || !item.text || !item.permalink || !item.username) return null;
  const t = item.timestamp ? new Date(item.timestamp) : undefined;
  return {
    source: 'threads_api',
    externalId: item.id,
    url: item.permalink,
    text: item.text,
    authorHandle: item.username,
    postedAt: t && !Number.isNaN(t.getTime()) ? t.toISOString() : undefined,
    matchedKeyword: keyword,
    raw: item,
  };
}

export type ThreadsApiOptions = {
  accessToken: string;
  /** Username of the account that owns the token, if known. Used to detect "own posts only" results. */
  ownUsername?: string;
  /**
   * TEST MODE. Before Meta approves `threads_keyword_search` the API returns only the token owner's own posts. By default that is
   * reported as a failure so nobody mistakes it for real leads. With this switch on, own posts are returned as normal posts so the
   * pipeline can be tested end to end with a post you wrote yourself. Never turn it on for a real workspace.
   */
  allowOwnPosts?: boolean;
  fetchFn?: FetchLike;
  queriesUsedLast24h?: number;
};

export function createThreadsApiCollector(opts: ThreadsApiOptions): Collector {
  const doFetch: FetchLike = opts.fetchFn ?? ((url) => fetch(url));
  return {
    id: 'threads_api',
    async run(input: CollectorRunInput): Promise<CollectorRunResult> {
      const posts: RawPost[] = [];
      const seen = new Set<string>();
      let queries = 0;
      let partial = false;
      const budgetLeft = QUERY_BUDGET_PER_24H - (opts.queriesUsedLast24h ?? 0);

      for (const keyword of input.keywords) {
        if (queries >= budgetLeft || posts.length >= input.maxResults) {
          partial = true;
          break;
        }
        const params = new URLSearchParams({
          q: keyword,
          search_type: 'RECENT',
          fields: FIELDS,
          limit: String(Math.min(100, input.maxResults - posts.length)),
          access_token: opts.accessToken,
        });
        if (input.sinceIso) params.set('since', String(Math.floor(new Date(input.sinceIso).getTime() / 1000)));

        queries += 1;
        let body: unknown;
        try {
          const res = await doFetch(`${ENDPOINT}?${params.toString()}`);
          if (!res.ok) {
            // Meta's own message helps (for example a missing permission). Never include the URL or the token.
            let detail = '';
            try {
              const errBody = (await res.json()) as { error?: { message?: string } } | null;
              detail = (errBody?.error?.message ?? '').split(opts.accessToken).join('[token]').slice(0, 200);
            } catch {
              // no readable body
            }
            return { posts, costUsd: 0, queriesUsed: queries, status: posts.length ? 'partial' : 'failed', error: `Threads API returned HTTP ${res.status} for keyword "${keyword}"${detail ? `: ${detail}` : ''}.` };
          }
          body = await res.json();
        } catch (err) {
          const msg = err instanceof Error ? err.message.replaceAll(opts.accessToken, '[token]') : 'request failed';
          return { posts, costUsd: 0, queriesUsed: queries, status: posts.length ? 'partial' : 'failed', error: `Threads API request failed: ${msg}` };
        }
        const data = (body as { data?: unknown } | null)?.data;
        if (!Array.isArray(data)) continue; // empty or unexpected: treated as no results, not as an error
        for (const it of data as ThreadsItem[]) {
          const p = mapThreadsItem(it, keyword);
          if (p && !seen.has(p.externalId)) {
            seen.add(p.externalId);
            posts.push(p);
          }
        }
      }

      // Before permission approval the API returns only the token owner's own posts. Fail loudly instead of pretending.
      if (!opts.allowOwnPosts && posts.length > 0 && opts.ownUsername && posts.every((p) => p.authorHandle.toLowerCase() === opts.ownUsername!.toLowerCase())) {
        return { posts: [], costUsd: 0, queriesUsed: queries, status: 'failed', error: 'Threads keyword search permission not approved (results contain only the connected account\'s own posts).' };
      }
      return { posts, costUsd: 0, queriesUsed: queries, status: partial ? 'partial' : 'ok' };
    },
  };
}
