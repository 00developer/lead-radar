// Seeds the owner's workspace: settings, the four services (as rows, decision D-23) and starting keywords.
// Idempotent: running it twice creates nothing new. Everything seeded here is ordinary data the owner can change.

import type { Db } from './db/types';

export const OWNER_SERVICES = [
  { slug: 'web_dev', name: 'Web development', description: 'Websites and web apps' },
  { slug: 'saas', name: 'SaaS build', description: 'Building a SaaS product or MVP' },
  { slug: 'mobile_app', name: 'Mobile app', description: 'iOS and Android apps' },
  { slug: 'ai_automation', name: 'AI and automation', description: 'AI agents, chatbots, workflow automation' },
];

// English need-statements first (decision D-32). Role-only words returned mostly sellers in Phase 0, so they are seeded disabled.
const KEYWORDS: { term: string; service: string | null; enabled: boolean }[] = [
  { term: 'need a website', service: 'web_dev', enabled: true },
  { term: 'website developer needed', service: 'web_dev', enabled: true },
  { term: 'need a web developer', service: 'web_dev', enabled: true },
  { term: 'app developer needed', service: 'mobile_app', enabled: true },
  { term: 'need an app developer', service: 'mobile_app', enabled: true },
  { term: 'looking for AI developer', service: 'ai_automation', enabled: true },
  { term: 'need a developer', service: null, enabled: true },
  { term: 'looking for a developer', service: null, enabled: true },
  { term: 'developer needed', service: null, enabled: true },
  { term: 'Shopify developer', service: 'web_dev', enabled: false },
  { term: 'WordPress developer', service: 'web_dev', enabled: false },
];

// Multi-word seller phrases only. "portfolio" and "we build" were left out on purpose: buyers write
// "send me your portfolio" and "we build apps and need help", so they would hide real leads.
export const NEGATIVE = ['we offer', 'hire us', 'DM for services', 'our agency', 'available for projects', 'open for work', 'DM for quote', 'starting at'];

export async function seedOwnerWorkspace(db: Db, name = 'My company'): Promise<string> {
  const existing = await db.query<{ id: string }>('select id from workspaces where name = $1 order by created_at limit 1', [name]);
  let id = existing.rows[0]?.id;
  if (!id) {
    id = (await db.query<{ id: string }>('insert into workspaces (name) values ($1) returning id', [name])).rows[0].id;
  }
  await db.query('insert into workspace_settings (workspace_id) values ($1) on conflict (workspace_id) do nothing', [id]);

  for (const s of OWNER_SERVICES) {
    await db.query(
      'insert into workspace_services (workspace_id, slug, name, description) values ($1,$2,$3,$4) on conflict (workspace_id, slug) do nothing',
      [id, s.slug, s.name, s.description],
    );
  }
  for (const k of KEYWORDS) {
    await db.query(
      `insert into keywords (workspace_id, service_id, term, language, is_negative, enabled)
       values ($1, (select id from workspace_services where workspace_id = $1 and slug = $2), $3, 'en', false, $4)
       on conflict (workspace_id, term, is_negative) do nothing`,
      [id, k.service, k.term, k.enabled],
    );
  }
  for (const [source, enabled] of [['apify_threads', true], ['threads_api', false]] as const) {
    await db.query(
      'insert into workspace_sources (workspace_id, source, enabled) values ($1,$2,$3) on conflict (workspace_id, source) do nothing',
      [id, source, enabled],
    );
  }
  // The owner's own workspace may use everything up to the old maximums. Customer workspaces get a restricted plan (phase4/workspaces.ts).
  await db.query(
    "insert into workspace_plans (workspace_id, allow_apify, allow_official_api, max_results_cap, max_spend_cap_usd, ai_monthly_cap, note) values ($1, true, true, 1000, 50, 100000, 'Owner workspace') on conflict do nothing",
    [id],
  );
  for (const term of NEGATIVE) {
    await db.query(
      "insert into keywords (workspace_id, term, language, is_negative) values ($1,$2,'en',true) on conflict (workspace_id, term, is_negative) do nothing",
      [id, term],
    );
  }
  return id;
}
