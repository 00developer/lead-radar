import type { Db } from '../db/types';
import { promptVersionFor, type PromptService } from '../classifier/prompt';
import { loadConfirmedProfile } from '../profile/store';
import { effectiveAiCeiling, getPlan } from '../phase4/workspaces';

export type WorkspaceContext = {
  id: string;
  name: string;
  settings: {
    leadThreshold: number;
    alertThreshold: number;
    maxPostAgeDays: number;
    allowedLanguages: string[];
    aiMonthlyCeiling: number;
    alertEmail: string | null;
    autoReplyEnabled: boolean;
  };
  /** Enabled services, read from workspace_services (never hard-coded). */
  services: PromptService[];
  /** Enabled search keywords (positive). */
  keywords: { term: string; language: string }[];
  /** Enabled negative keywords. */
  negativeTerms: string[];
  /** The confirmed Business Profile (offerings the business sells), or null. Drafts never appear here. */
  profile: { summary: string | null; offerings: { id: string; name: string; kind: string; description: string | null }[] } | null;
  /** v3 when a confirmed profile is part of the prompt, otherwise v2. */
  promptVersion: string;
};

type SettingsRow = {
  lead_intent_threshold: number;
  alert_intent_threshold: number;
  max_post_age_days: number;
  allowed_languages: string[];
  ai_monthly_ceiling: number;
  alert_email: string | null;
  auto_reply_enabled: boolean;
};

export async function resolveWorkspaceId(db: Db, requested?: string): Promise<string> {
  if (requested) {
    const r = await db.query<{ id: string }>('select id from workspaces where id = $1', [requested]);
    if (!r.rows[0]) throw new Error(`Workspace ${requested} not found.`);
    return r.rows[0].id;
  }
  const all = await db.query<{ id: string; name: string }>('select id, name from workspaces order by created_at');
  if (all.rows.length === 0) throw new Error('No workspace exists. Run: npm run seed');
  if (all.rows.length > 1) {
    throw new Error(`More than one workspace exists. Pass --workspace <id>. Found: ${all.rows.map((w) => `${w.name} (${w.id})`).join(', ')}`);
  }
  return all.rows[0].id;
}

export async function loadWorkspace(db: Db, workspaceId: string): Promise<WorkspaceContext> {
  const ws = await db.query<{ id: string; name: string }>('select id, name from workspaces where id = $1', [workspaceId]);
  if (!ws.rows[0]) throw new Error(`Workspace ${workspaceId} not found.`);
  const st = await db.query<SettingsRow>(
    'select lead_intent_threshold, alert_intent_threshold, max_post_age_days, allowed_languages, ai_monthly_ceiling, alert_email, auto_reply_enabled from workspace_settings where workspace_id = $1',
    [workspaceId],
  );
  const s = st.rows[0];
  if (!s) throw new Error(`Workspace ${workspaceId} has no settings row. Run: npm run seed`);
  const services = await db.query<{ slug: string; name: string; description: string | null }>(
    'select slug, name, description from workspace_services where workspace_id = $1 and enabled order by created_at, slug',
    [workspaceId],
  );
  const profile = await loadConfirmedProfile(db, workspaceId);
  const plan = await getPlan(db, workspaceId);
  const kws = await db.query<{ term: string; language: string; is_negative: boolean }>(
    'select term, language, is_negative from keywords where workspace_id = $1 and enabled order by created_at, term',
    [workspaceId],
  );
  return {
    id: ws.rows[0].id,
    name: ws.rows[0].name,
    settings: {
      leadThreshold: s.lead_intent_threshold,
      alertThreshold: s.alert_intent_threshold,
      maxPostAgeDays: s.max_post_age_days,
      allowedLanguages: s.allowed_languages,
      // Never more than the owner-controlled plan allows (a workspace without a plan gets no AI calls).
      aiMonthlyCeiling: effectiveAiCeiling(s.ai_monthly_ceiling, plan),
      alertEmail: s.alert_email,
      autoReplyEnabled: s.auto_reply_enabled,
    },
    services: services.rows,
    keywords: kws.rows.filter((k) => !k.is_negative).map((k) => ({ term: k.term, language: k.language })),
    negativeTerms: kws.rows.filter((k) => k.is_negative).map((k) => k.term),
    profile,
    promptVersion: promptVersionFor(profile !== null),
  };
}
