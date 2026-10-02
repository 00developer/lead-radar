// Registry: source id -> collector. The pipeline only knows the Collector interface (docs/architecture.md section 6).

import type { Env } from '../env';
import { requireValue } from '../env';
import { createApifyRunner, createApifyThreadsCollector } from './apify-threads';
import { createThreadsApiCollector } from './threads-api';
import type { Collector, SourceId } from './types';

export const SOURCE_IDS: SourceId[] = ['apify_threads', 'threads_api'];

export function isSourceId(v: string): v is SourceId {
  return (SOURCE_IDS as string[]).includes(v);
}

export function createCollector(id: SourceId, env: Env): Collector {
  switch (id) {
    case 'apify_threads':
      return createApifyThreadsCollector({
        runner: createApifyRunner(requireValue(env.APIFY_TOKEN, 'APIFY_TOKEN')),
        actorId: env.APIFY_ACTOR_ID,
        pricePer1kUsd: env.APIFY_PRICE_PER_1K_USD,
      });
    case 'threads_api':
      // Phase 1 shortcut: a single development token from .env. Real leads only after Meta approves threads_keyword_search.
      return createThreadsApiCollector({ accessToken: requireValue(env.THREADS_ACCESS_TOKEN, 'THREADS_ACCESS_TOKEN') });
  }
}
