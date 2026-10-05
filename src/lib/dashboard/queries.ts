// Read queries for the dashboard. They run as the logged-in user (RLS), so a user can only ever read their own workspace.
// Every query still filters by workspace_id explicitly (defence in depth).

import type { Session } from '../auth';

export const PAGE_SIZE = 50;
export const STATUSES = ['new', 'contacted', 'replied', 'won', 'lost', 'dismissed'] as const;
export type LeadStatus = (typeof STATUSES)[number];

export type LeadRow = {
  id: string;
  workspace_id: string;
  status: LeadStatus;
  needs_review: boolean;
  review_label: 'genuine' | 'not_genuine' | null;
  notes: string | null;
  reply_draft_edited: string | null;
  created_at: string;
  updated_at: string;
  post_id: string;
  source: string;
  post_url: string;
  text: string;
  author_handle: string;
  author_name: string | null;
  author_profile_url: string | null;
  author_bio: string | null;
  posted_at: string | null;
  reply_count: number | null;
  matched_keyword: string | null;
  classification_id: string;
  author_type: string;
  service: string | null;
  intent_score: number | null;
  urgency: string | null;
  budget: string | null;
  timeline: string | null;
  language: string | null;
  reason: string | null;
  reply_draft: string | null;
  confidence: number | null;
  matched_offering_id: string | null;
  fit: string | null;
  model: string;
  prompt_version: string;
};

export type LeadFilters = {
  service?: string;
  minIntent?: number;
  status?: string;
  needsReview?: boolean;
  source?: string;
  days?: number;
  /** 'none' = not labeled yet. */
  label?: 'none' | 'genuine' | 'not_genuine';
  page?: number;
};

const LIST_COLUMNS =
  'id,status,needs_review,review_label,created_at,post_url,text,author_handle,author_name,source,service,intent_score,urgency,language,reason,posted_at';

export async function listLeads(s: Session, f: LeadFilters) {
  const page = Math.max(1, f.page ?? 1);
  let q = s.supabase.from('lead_inbox').select(LIST_COLUMNS, { count: 'exact' }).eq('workspace_id', s.workspaceId);
  if (f.service) q = q.eq('service', f.service);
  if (f.minIntent) q = q.gte('intent_score', f.minIntent);
  if (f.status) q = q.eq('status', f.status);
  if (f.needsReview) q = q.eq('needs_review', true);
  if (f.source) q = q.eq('source', f.source);
  if (f.label === 'none') q = q.is('review_label', null);
  else if (f.label) q = q.eq('review_label', f.label);
  if (f.days) {
    // Same date the lead card shows ("3 days ago" is the post's age): when the post was written, or when the lead was
    // created if the source gave no post time. The values are quoted because an ISO time contains ":" and ".".
    const since = new Date(Date.now() - f.days * 86_400_000).toISOString();
    q = q.or(`posted_at.gte."${since}",and(posted_at.is.null,created_at.gte."${since}")`);
  }
  const { data, count, error } = await q
    .order('intent_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return { rows: (data ?? []) as unknown as Partial<LeadRow>[], total: count ?? 0, page };
}

export async function listHidden(s: Session, page = 1) {
  const p = Math.max(1, page);
  const { data, count, error } = await s.supabase
    .from('hidden_posts')
    .select('post_id,post_url,text,author_handle,author_type,service,intent_score,language,reason,error,classified_at', { count: 'exact' })
    .eq('workspace_id', s.workspaceId)
    .order('intent_score', { ascending: false, nullsFirst: false })
    .order('classified_at', { ascending: false })
    .range((p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load hidden posts: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0, page: p };
}

export async function getLead(s: Session, id: string) {
  const { data, error } = await s.supabase.from('lead_inbox').select('*').eq('workspace_id', s.workspaceId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load the lead: ${error.message}`);
  if (!data) return null;
  const { data: events } = await s.supabase
    .from('lead_events')
    .select('id,event,from_value,to_value,created_at')
    .eq('workspace_id', s.workspaceId)
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  return { lead: data as unknown as LeadRow, events: events ?? [] };
}

/** The highest-intent lead that has no label yet, other than the current one. Used by the "next unlabeled lead" link. */
export async function nextUnlabeledLeadId(s: Session, currentId: string): Promise<string | null> {
  const { data } = await s.supabase
    .from('lead_inbox')
    .select('id')
    .eq('workspace_id', s.workspaceId)
    .is('review_label', null)
    .neq('id', currentId)
    .order('intent_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function listServices(s: Session) {
  const { data, error } = await s.supabase
    .from('workspace_services')
    .select('id,slug,name,description,enabled')
    .eq('workspace_id', s.workspaceId)
    .order('created_at');
  if (error) throw new Error(`Could not load services: ${error.message}`);
  return data ?? [];
}

export async function listKeywords(s: Session) {
  const { data, error } = await s.supabase
    .from('keywords')
    .select('id,service_id,term,language,is_negative,enabled')
    .eq('workspace_id', s.workspaceId)
    .order('term');
  if (error) throw new Error(`Could not load keywords: ${error.message}`);
  return data ?? [];
}

export async function getSettings(s: Session) {
  const { data, error } = await s.supabase.from('workspace_settings').select('*').eq('workspace_id', s.workspaceId).maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data;
}

export async function getAiUsageThisMonth(s: Session): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await s.supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', s.workspaceId)
    .gte('created_at', start.toISOString());
  return count ?? 0;
}

export async function listSources(s: Session) {
  const { data, error } = await s.supabase.from('workspace_sources').select('*').eq('workspace_id', s.workspaceId).order('source');
  if (error) throw new Error(`Could not load sources: ${error.message}`);
  return data ?? [];
}

export async function listRuns(s: Session, limit = 20) {
  const { data, error } = await s.supabase
    .from('collector_runs')
    .select('id,source,status,posts_returned,posts_new,queries_used,cost_usd,error,started_at,finished_at')
    .eq('workspace_id', s.workspaceId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load runs: ${error.message}`);
  return data ?? [];
}

export type Overview = {
  newLeads: number;
  totalLeads: number;
  needsReview: number;
  hidden: number;
  labeled: number;
  genuine: number;
  perDay: { day: string; n: number }[];
  perSource: { source: string; leads: number; spendUsd: number }[];
  aiUsed: number;
  aiCeiling: number;
};

export async function getOverview(s: Session): Promise<Overview> {
  const ws = s.workspaceId;
  const head = (table: string) => s.supabase.from(table).select('*', { count: 'exact', head: true }).eq('workspace_id', ws);
  const [newQ, totalQ, reviewQ, hiddenQ, labeledQ, genuineQ] = await Promise.all([
    head('leads').eq('status', 'new'),
    head('leads'),
    head('leads').eq('needs_review', true),
    head('hidden_posts'),
    head('leads').not('review_label', 'is', null),
    head('leads').eq('review_label', 'genuine'),
  ]);

  const since = new Date(Date.now() - 13 * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const { data: recent } = await s.supabase
    .from('lead_inbox')
    .select('created_at,source')
    .eq('workspace_id', ws)
    .gte('created_at', since.toISOString())
    .limit(2000);
  const perDayMap = new Map<string, number>();
  for (let i = 0; i < 14; i++) perDayMap.set(new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10), 0);
  for (const r of recent ?? []) {
    const d = String(r.created_at).slice(0, 10);
    if (perDayMap.has(d)) perDayMap.set(d, (perDayMap.get(d) ?? 0) + 1);
  }

  const { data: leadSources } = await s.supabase.from('lead_inbox').select('source').eq('workspace_id', ws).limit(5000);
  const { data: runs } = await s.supabase.from('collector_runs').select('source,cost_usd').eq('workspace_id', ws).limit(2000);
  const sources = new Map<string, { leads: number; spendUsd: number }>();
  for (const r of leadSources ?? []) {
    const e = sources.get(r.source) ?? { leads: 0, spendUsd: 0 };
    e.leads += 1;
    sources.set(r.source, e);
  }
  for (const r of runs ?? []) {
    const e = sources.get(r.source) ?? { leads: 0, spendUsd: 0 };
    e.spendUsd += Number(r.cost_usd ?? 0);
    sources.set(r.source, e);
  }

  const settings = await getSettings(s);
  return {
    newLeads: newQ.count ?? 0,
    totalLeads: totalQ.count ?? 0,
    needsReview: reviewQ.count ?? 0,
    hidden: hiddenQ.count ?? 0,
    labeled: labeledQ.count ?? 0,
    genuine: genuineQ.count ?? 0,
    perDay: [...perDayMap].map(([day, n]) => ({ day, n })),
    perSource: [...sources].map(([source, v]) => ({ source, ...v })),
    aiUsed: await getAiUsageThisMonth(s),
    aiCeiling: settings?.ai_monthly_ceiling ?? 0,
  };
}
