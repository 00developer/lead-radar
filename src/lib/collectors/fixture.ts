// Fixture collector for dry runs and tests: maps saved raw Apify items with the real mapper. No network, no cost.

import type { Collector, CollectorRunInput, CollectorRunResult } from './types';
import { mapWebdataItem } from './apify-threads';

export function createFixtureCollector(items: Record<string, unknown>[]): Collector {
  return {
    id: 'apify_threads',
    async run(input: CollectorRunInput): Promise<CollectorRunResult> {
      const posts = items
        .map((i) => mapWebdataItem(i))
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .slice(0, input.maxResults);
      return { posts, costUsd: 0, queriesUsed: 0, status: 'ok' };
    },
  };
}
