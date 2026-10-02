// Collector interface (docs/architecture.md section 6). A collector never writes to the database:
// the runner does, so every source is stored the same way.

export type SourceId = 'threads_api' | 'apify_threads';

export type RawPost = {
  source: SourceId;
  externalId: string;
  url: string;
  text: string;
  authorHandle: string;
  authorName?: string;
  authorProfileUrl?: string;
  authorBio?: string;
  postedAt?: string; // ISO 8601
  language?: string;
  replyCount?: number;
  parentExternalId?: string;
  matchedKeyword?: string;
  raw: unknown;
};

export type CollectorRunInput = {
  workspaceId: string;
  keywords: string[];
  maxResults: number;
  maxSpendUsd: number;
  sinceIso?: string;
};

export type CollectorRunResult = {
  posts: RawPost[];
  costUsd: number;
  /** Official API queries spent (budget: 2,200 per rolling 24 hours per Threads account). 0 for other sources. */
  queriesUsed: number;
  status: 'ok' | 'partial' | 'failed';
  error?: string;
};

export interface Collector {
  id: SourceId;
  run(input: CollectorRunInput): Promise<CollectorRunResult>;
}
