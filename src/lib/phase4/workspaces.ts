// Customer workspaces and their plans (Phase 4, first part).
// A new workspace starts with every source switched off and small limits, because the app owner pays for Apify and the AI.
// The owner raises limits per workspace on the Admin page. Members can read their plan but never change it.

import type { Db } from '../db/types';
import type { SourceId } from '../collectors/types';
import { NEGATIVE } from '../seed';

export type Plan = {
  allowApify: boolean;
  allowOfficialApi: boolean;
  maxResultsCap: number;
  maxSpendCapUsd: number;
  aiMonthlyCap: number;
  note: string | null;
};

/** What a new customer workspace gets until the owner changes it. */
export const NEW_WORKSPACE_PLAN: Plan = { allowApify: false, allowOfficialApi: false, maxResultsCap: 100, maxSpendCapUsd: 0.5, aiMonthlyCap: 200, note: null };

type PlanRow = { allow_apify: boolean; allow_official_api: boolean; max_results_cap: number; max_spend_cap_usd: string; ai_monthly_cap: number; note: string | null };

const toPlan = (r: PlanRow): Plan => ({
  allowApify: r.allow_apify,
  allowOfficialApi: r.allow_official_api,
  maxResultsCap: r.max_results_cap,
  maxSpendCapUsd: Number(r.max_spend_cap_usd),
  aiMonthlyCap: r.ai_monthly_cap,
  note: r.note,
});

/** The plan of a workspace. A workspace without a plan row gets nothing (fails closed). */
export async function getPlan(db: Db, workspaceId: string): Promise<Plan | null> {
  const r = await db.query<PlanRow>(
    'select allow_apify, allow_official_api, max_results_cap, max_spend_cap_usd, ai_monthly_cap, note from workspace_plans where workspace_id = $1',
    [workspaceId],
  );
  return r.rows[0] ? toPlan(r.rows[0]) : null;
}

export const sourceAllowed = (plan: Plan | null, source: SourceId): boolean =>
  plan !== null && (source === 'apify_threads' ? plan.allowApify : plan.allowOfficialApi);

/** The limits a run really uses: what the workspace asked for, never more than the plan allows. */
export function effectiveLimits(plan: Plan, asked: { maxResults: number; maxSpendUsd: number }): { maxResults: number; maxSpendUsd: number } {
  return { maxResults: Math.min(asked.maxResults, plan.maxResultsCap), maxSpendUsd: Math.min(asked.maxSpendUsd, plan.maxSpendCapUsd) };
}

/** The monthly AI ceiling a workspace really has: its own setting, never more than the plan allows. */
export function effectiveAiCeiling(settingsCeiling: number, plan: Plan | null): number {
  return plan ? Math.min(settingsCeiling, plan.aiMonthlyCap) : 0;
}

export async function savePlan(db: Db, workspaceId: string, p: Omit<Plan, 'note'> & { note?: string | null }): Promise<void> {
  await db.query(
    `insert into workspace_plans (workspace_id, allow_apify, allow_official_api, max_results_cap, max_spend_cap_usd, ai_monthly_cap, note)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (workspace_id) do update set allow_apify = excluded.allow_apify, allow_official_api = excluded.allow_official_api,
       max_results_cap = excluded.max_results_cap, max_spend_cap_usd = excluded.max_spend_cap_usd, ai_monthly_cap = excluded.ai_monthly_cap,
       note = excluded.note, updated_at = now()`,
    [workspaceId, p.allowApify, p.allowOfficialApi, p.maxResultsCap, p.maxSpendCapUsd, p.aiMonthlyCap, p.note ?? null],
  );
}

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const r = await db.query('select 1 from platform_admins where user_id = $1', [userId]);
  return r.rows.length > 0;
}

/**
 * Creates an empty customer workspace for a new user: settings, restricted plan, both sources OFF, the user as owner,
 * one generic service (the customer edits it, or adds more, in Settings) and the shared negative keywords.
 * Positive keywords come from the customer's confirmed Business Profile during onboarding.
 */
export async function createCustomerWorkspace(db: Db, v: { name: string; userId: string }): Promise<string> {
  const name = v.name.trim().slice(0, 80);
  if (name.length < 2) throw new Error('The business name needs at least 2 characters.');
  return db.transaction(async (tx) => {
    const id = (await tx.query<{ id: string }>('insert into workspaces (name) values ($1) returning id', [name])).rows[0].id;
    await tx.query('insert into workspace_settings (workspace_id, ai_monthly_ceiling) values ($1, $2)', [id, NEW_WORKSPACE_PLAN.aiMonthlyCap]);
    await savePlanIn(tx, id, NEW_WORKSPACE_PLAN);
    for (const source of ['apify_threads', 'threads_api'] as const) {
      await tx.query('insert into workspace_sources (workspace_id, source, enabled) values ($1,$2,false)', [id, source]);
    }
    await tx.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'owner')", [id, v.userId]);
    await tx.query(
      "insert into workspace_services (workspace_id, slug, name, description) values ($1,'general','General','What this business sells. Rename it or add more services in Settings.')",
      [id],
    );
    for (const term of NEGATIVE) {
      await tx.query("insert into keywords (workspace_id, term, language, is_negative) values ($1,$2,'en',true)", [id, term]);
    }
    return id;
  });
}

const savePlanIn = (tx: Db, workspaceId: string, p: Plan) => savePlan(tx, workspaceId, p);

export type WorkspaceOverview = {
  id: string;
  name: string;
  created_at: Date;
  members: number;
  leads: number;
  runs_this_month: number;
  cost_this_month: string;
  ai_calls_this_month: number;
  plan: Plan | null;
  sources_enabled: number;
  /** A platform admin is a member: the app never offers to delete this workspace. */
  has_admin: boolean;
};

/** One row per workspace for the Admin page (server connection, all workspaces). */
export async function listWorkspaceOverview(db: Db): Promise<WorkspaceOverview[]> {
  const r = await db.query<Omit<WorkspaceOverview, 'plan'> & PlanRow & { has_plan: boolean }>(
    `select w.id, w.name, w.created_at,
       (select count(*)::int from workspace_members m where m.workspace_id = w.id) as members,
       (select count(*)::int from leads l where l.workspace_id = w.id) as leads,
       (select count(*)::int from collector_runs c where c.workspace_id = w.id and c.started_at >= date_trunc('month', now())) as runs_this_month,
       (select coalesce(sum(cost_usd), 0)::text from collector_runs c where c.workspace_id = w.id and c.started_at >= date_trunc('month', now())) as cost_this_month,
       (select count(*)::int from ai_usage a where a.workspace_id = w.id and a.created_at >= date_trunc('month', now())) as ai_calls_this_month,
       (select count(*)::int from workspace_sources s where s.workspace_id = w.id and s.enabled) as sources_enabled,
       exists (select 1 from workspace_members m join platform_admins a on a.user_id = m.user_id where m.workspace_id = w.id) as has_admin,
       p.workspace_id is not null as has_plan,
       p.allow_apify, p.allow_official_api, p.max_results_cap, p.max_spend_cap_usd, p.ai_monthly_cap, p.note
     from workspaces w left join workspace_plans p on p.workspace_id = w.id
     order by w.created_at`,
  );
  return r.rows.map((x) => ({
    id: x.id, name: x.name, created_at: x.created_at, members: x.members, leads: x.leads, runs_this_month: x.runs_this_month,
    cost_this_month: x.cost_this_month, ai_calls_this_month: x.ai_calls_this_month, sources_enabled: x.sources_enabled, has_admin: x.has_admin,
    plan: x.has_plan ? toPlan(x as PlanRow) : null,
  }));
}

/** The monthly AI ceiling for one workspace: its own setting, the plan, and the global safety ceiling, whichever is lowest. */
export async function workspaceAiCeiling(db: Db, workspaceId: string, globalCeiling: number): Promise<number> {
  const r = await db.query<{ ai_monthly_ceiling: number }>('select ai_monthly_ceiling from workspace_settings where workspace_id = $1', [workspaceId]);
  if (!r.rows[0]) return 0;
  return Math.min(effectiveAiCeiling(r.rows[0].ai_monthly_ceiling, await getPlan(db, workspaceId)), globalCeiling);
}
