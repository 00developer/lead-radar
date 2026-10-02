// Candidate Apify Threads search Actors for the Phase 0 comparison.
// Facts (input fields, prices) come from each Actor's Apify page opened on 2026-09-30.
// They can change at any time: check the Actor page again before spending money.

export type ActorKey = 'ethereal' | 'webdata' | 'easyapi';

export type ActorConfig = {
  key: ActorKey;
  id: string;
  /** Listed price in USD per 1,000 results. Used only for the pre-run estimate. */
  pricePer1kUsd: number;
  pricingModel: 'pay-per-result' | 'pay-per-event';
  notes: string;
  buildInput(keywords: string[], perKeyword: number): Record<string, unknown>;
};

export const ACTORS: Record<ActorKey, ActorConfig> = {
  ethereal: {
    key: 'ethereal',
    id: 'ethereal_wool/threads-search-scraper',
    pricePer1kUsd: 2.5,
    pricingModel: 'pay-per-result',
    notes: 'maxItems is the total across all keywords. sort: top | recent. English keywords work best (per Actor page). Only ~9 users at time of writing.',
    buildInput: (keywords, perKeyword) => ({
      searchKeywords: keywords,
      sort: 'recent',
      maxItems: keywords.length * perKeyword,
    }),
  },
  webdata: {
    key: 'webdata',
    id: 'webdata_labs/threads-scraper',
    pricePer1kUsd: 3.0,
    pricingModel: 'pay-per-result',
    notes: 'mode=search, up to 20 queries. Actor page says keyword search returns about one page (~20 posts) per keyword regardless of maxPosts.',
    buildInput: (keywords, perKeyword) => ({
      mode: 'search',
      searchQueries: keywords.slice(0, 20),
      maxPosts: perKeyword,
    }),
  },
  easyapi: {
    key: 'easyapi',
    id: 'easyapi/threads-search-scraper',
    pricePer1kUsd: 4.99,
    pricingModel: 'pay-per-event',
    notes: 'keywords max 20, maxPostsPerKeyword minimum 10. Pay-per-event: there may be extra start events on top of the per-result price.',
    buildInput: (keywords, perKeyword) => ({
      keywords: keywords.slice(0, 20),
      sortBy: 'recent',
      maxPostsPerKeyword: Math.max(10, perKeyword),
    }),
  },
};

export function isActorKey(v: string): v is ActorKey {
  return v in ACTORS;
}
