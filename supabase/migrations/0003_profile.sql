-- Phase 2: Business Profile support.
--  * keyword_suggestions: keywords the AI proposes from the confirmed offerings. They become real keywords only when approved.
--  * business_profiles.pending_scan: the result of a re-scan, kept until the user accepts or discards it (docs/prd.md FR-P8)

create table keyword_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  term text not null check (char_length(term) between 2 and 120),
  language text not null check (language in ('en','hinglish','hi')),
  is_negative boolean not null default false,
  service_slug text,
  created_at timestamptz not null default now(),
  unique (workspace_id, term, is_negative)
);
alter table keyword_suggestions enable row level security;
create policy "members read" on keyword_suggestions for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create policy "members write" on keyword_suggestions for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

alter table business_profiles add column pending_scan jsonb;
alter table business_profiles add column scan_notes text;

-- The inbox also shows which confirmed offering a post matches (columns are only added at the end of the view).
create or replace view lead_inbox with (security_invoker = true) as
select
  l.id, l.workspace_id, l.status, l.needs_review, l.review_label, l.notes, l.reply_draft_edited,
  l.created_at, l.updated_at,
  p.id as post_id, p.source, p.url as post_url, p.text, p.author_handle, p.author_name, p.author_profile_url, p.author_bio,
  p.posted_at, p.reply_count, p.matched_keyword,
  c.id as classification_id, c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language,
  c.reason, c.reply_draft, c.confidence, c.matched_offering_id, c.fit, c.model, c.prompt_version,
  o.name as matched_offering_name
from leads l
join posts p on p.id = l.post_id
join classifications c on c.id = l.classification_id
left join business_offerings o on o.id = c.matched_offering_id;
