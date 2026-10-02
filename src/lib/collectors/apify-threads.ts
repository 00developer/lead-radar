// Apify Threads collector: the bridge until the official Threads keyword search is approved (docs/architecture.md 6b).
// Actor, input shape and price come from the Phase 0 report (docs/reports/phase-0-report.md):
// webdata_labs/threads-scraper, mode "search", about $3.00 per 1,000 posts, no author bio.

import { ApifyClient } from 'apify-client';
import type { Collector, CollectorRunInput, CollectorRunResult, RawPost } from './types';

export type ActorRunOutcome = { status: string; usageTotalUsd: number | null; items: Record<string, unknown>[] };

/** Small seam around the Apify client so tests and dry runs never touch the network. */
export interface ActorRunner {
  runActor(actorId: string, input: Record<string, unknown>, limits: { maxItems: number; maxTotalChargeUsd: number }): Promise<ActorRunOutcome>;
}

export function createApifyRunner(token: string): ActorRunner {
  const client = new ApifyClient({ token });
  return {
    async runActor(actorId, input, limits) {
      const run = await client.actor(actorId).call(input, {
        waitSecs: 600,
        // Hard caps enforced by Apify itself.
        maxItems: limits.maxItems,
        maxTotalChargeUsd: limits.maxTotalChargeUsd,
      });
      const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: limits.maxItems + 50 });
      return { status: run.status, usageTotalUsd: run.usageTotalUsd ?? null, items: items as Record<string, unknown>[] };
    },
  };
}

const MAX_QUERIES_PER_RUN = 20; // the Actor accepts up to 20 search queries per run
const PER_KEYWORD_CAP = 20; // the Actor returns about one page (about 20 posts) per keyword

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Maps one webdata_labs item to a RawPost. Returns null for items that are not usable posts. */
export function mapWebdataItem(item: Record<string, unknown>): RawPost | null {
  if (item.type !== undefined && item.type !== 'post') return null;
  if (item.isRepost === true) return null; // the author did not write a repost
  const text = str(item.text);
  const id = str(item.postId) ?? (typeof item.postId === 'number' ? String(item.postId) : undefined);
  const url = str(item.url);
  const handle = str(item.username);
  if (!text || !id || !url || !handle) return null;
  const date = str(item.date);
  const postedAt = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : undefined;
  const profileUrl = url.includes('/post/') ? url.split('/post/')[0] : undefined;
  return {
    source: 'apify_threads',
    externalId: id,
    url,
    text,
    authorHandle: handle,
    authorName: str(item.fullName),
    authorProfileUrl: profileUrl,
    postedAt,
    replyCount: typeof item.replyCount === 'number' ? item.replyCount : undefined,
    matchedKeyword: str(item.searchQuery),
    raw: item,
  };
}

export type ApifyThreadsOptions = {
  runner: ActorRunner;
  actorId: string;
  pricePer1kUsd: number;
};

export function createApifyThreadsCollector(opts: ApifyThreadsOptions): Collector {
  return {
    id: 'apify_threads',
    async run(input: CollectorRunInput): Promise<CollectorRunResult> {
      const keywords = input.keywords.slice(0, MAX_QUERIES_PER_RUN);
      if (keywords.length === 0) return { posts: [], costUsd: 0, queriesUsed: 0, status: 'failed', error: 'No enabled keywords.' };

      // Hard limits: results and money. The cheaper of the two wins.
      const affordableItems = Math.floor((input.maxSpendUsd * 1000) / opts.pricePer1kUsd);
      const maxItems = Math.min(input.maxResults, affordableItems);
      if (maxItems < 1) {
        return { posts: [], costUsd: 0, queriesUsed: 0, status: 'failed', error: `Spend limit $${input.maxSpendUsd} is too low for even one result.` };
      }
      const perKeyword = Math.max(1, Math.min(PER_KEYWORD_CAP, Math.ceil(maxItems / keywords.length)));

      try {
        const out = await opts.runner.runActor(
          opts.actorId,
          { mode: 'search', searchQueries: keywords, maxPosts: perKeyword },
          { maxItems, maxTotalChargeUsd: input.maxSpendUsd },
        );
        const seen = new Set<string>();
        const posts: RawPost[] = [];
        for (const item of out.items.slice(0, maxItems)) {
          const p = mapWebdataItem(item);
          if (!p || seen.has(p.externalId)) continue;
          seen.add(p.externalId);
          posts.push(p);
        }
        const costUsd = out.usageTotalUsd ?? Number(((out.items.length * opts.pricePer1kUsd) / 1000).toFixed(4));
        const succeeded = out.status === 'SUCCEEDED';
        const capped = keywords.length < input.keywords.length || out.items.length >= maxItems;
        return {
          posts,
          costUsd,
          queriesUsed: 0,
          status: !succeeded ? (posts.length > 0 ? 'partial' : 'failed') : capped ? 'partial' : 'ok',
          error: succeeded ? undefined : `Actor run ended with status ${out.status}.`,
        };
      } catch (err) {
        return { posts: [], costUsd: 0, queriesUsed: 0, status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
