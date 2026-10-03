// What a new customer still has to do before leads can appear. Computed from the data, so the checklist is always right
// and each step links to the page that already does the work (Business Profile, Keywords, Sources).

import type { Db } from '../db/types';
import { getPlan } from './workspaces';

export type OnboardingStep = { key: string; title: string; detail: string; done: boolean; href: string; cta: string; optional?: boolean };

export async function getOnboardingSteps(db: Db, workspaceId: string): Promise<OnboardingStep[]> {
  const profile = await db.query<{ status: string; offerings: string; confirmed: string }>(
    `select p.status,
       (select count(*) from business_offerings o where o.workspace_id = p.workspace_id) as offerings,
       (select count(*) from business_offerings o where o.workspace_id = p.workspace_id and o.confirmed) as confirmed
     from business_profiles p where p.workspace_id = $1`,
    [workspaceId],
  );
  const p = profile.rows[0];
  const scanned = Boolean(p) && Number(p.offerings) > 0;
  const confirmed = Boolean(p) && p.status === 'confirmed' && Number(p.confirmed) > 0;

  const kw = await db.query<{ n: string }>('select count(*) as n from keywords where workspace_id = $1 and enabled and not is_negative', [workspaceId]);
  const hasKeywords = Number(kw.rows[0].n) > 0;

  const conn = await db.query<{ status: string }>('select status from threads_connections where workspace_id = $1', [workspaceId]);
  const connected = conn.rows[0] !== undefined && conn.rows[0].status !== 'disconnected';

  const plan = await getPlan(db, workspaceId);
  const src = await db.query<{ n: string }>('select count(*) as n from workspace_sources where workspace_id = $1 and enabled', [workspaceId]);
  const collecting = plan !== null && (plan.allowApify || plan.allowOfficialApi) && Number(src.rows[0].n) > 0;

  return [
    { key: 'scan', title: 'Tell us what you sell', detail: 'Enter your website address. We read it and list your products and services. No website? Paste a short description instead.', done: scanned, href: '/profile', cta: 'Open Business Profile' },
    { key: 'confirm', title: 'Check and confirm the list', detail: 'Fix anything that is wrong, remove what you do not sell, then press Confirm. Leads are matched against this list.', done: confirmed, href: '/profile', cta: 'Review the list' },
    { key: 'keywords', title: 'Choose search keywords', detail: 'Ask for keyword suggestions and approve the ones that sound like a customer asking for your service.', done: hasKeywords, href: '/profile', cta: 'Get keyword suggestions' },
    { key: 'threads', title: 'Connect a Threads account', detail: 'Optional now. It is used only to search public posts through the official API. Nothing is ever posted from it.', done: connected, href: '/sources', cta: 'Open Sources', optional: true },
    { key: 'collection', title: 'Switch on lead collection', detail: 'Collection costs money, so the app owner switches it on for you once your setup is ready. You will see it here.', done: collecting, href: '/sources', cta: 'See Sources' },
  ];
}
