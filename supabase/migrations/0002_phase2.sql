-- Phase 2: dashboard support.
--  * workspace_sources: per-workspace source switches and hard limits (docs/design.md 4.6)
--  * lead_inbox and hidden_posts views: flat, filterable rows for the dashboard. security_invoker = true, so the caller's
--    Row Level Security applies (a user only ever sees their own workspace)
--  * triggers that keep leads.updated_at fresh and write lead_events for status, label and notes changes

-- Sources ---------------------------------------------------------------------------------------
create table workspace_sources (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('apify_threads','threads_api')),
  enabled boolean not null default true,
  max_results int not null default 100 check (max_results between 1 and 1000),
  max_spend_usd numeric(8,2) not null default 0.50 check (max_spend_usd >= 0 and max_spend_usd <= 50),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source)
);
alter table workspace_sources enable row level security;
create policy "members read" on workspace_sources for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
create policy "members write" on workspace_sources for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- Existing workspaces get the two default rows. The official API stays off until it is connected and approved.
insert into workspace_sources (workspace_id, source, enabled)
select w.id, s.source, s.enabled from workspaces w
cross join (values ('apify_threads', true), ('threads_api', false)) as s(source, enabled)
on conflict do nothing;

-- Views -----------------------------------------------------------------------------------------
create view lead_inbox with (security_invoker = true) as
select
  l.id, l.workspace_id, l.status, l.needs_review, l.review_label, l.notes, l.reply_draft_edited,
  l.created_at, l.updated_at,
  p.id as post_id, p.source, p.url as post_url, p.text, p.author_handle, p.author_name, p.author_profile_url, p.author_bio,
  p.posted_at, p.reply_count, p.matched_keyword,
  c.id as classification_id, c.author_type, c.service, c.intent_score, c.urgency, c.budget, c.timeline, c.language,
  c.reason, c.reply_draft, c.confidence, c.matched_offering_id, c.fit, c.model, c.prompt_version
from leads l
join posts p on p.id = l.post_id
join classifications c on c.id = l.classification_id;

-- Posts the AI classified but did not turn into leads ("Hidden by AI"), so the owner can spot missed buyers.
create view hidden_posts with (security_invoker = true) as
select
  p.id as post_id, p.workspace_id, p.source, p.url as post_url, p.text, p.author_handle, p.author_name, p.posted_at, p.matched_keyword,
  c.id as classification_id, c.author_type, c.service, c.intent_score, c.language, c.reason, c.confidence, c.reply_draft, c.error,
  c.created_at as classified_at
from classifications c
join posts p on p.id = c.post_id
where not exists (select 1 from leads l where l.post_id = c.post_id and l.workspace_id = c.workspace_id);

-- Triggers --------------------------------------------------------------------------------------
create function leads_track_changes() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into lead_events (lead_id, workspace_id, event, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'status_changed', old.status, new.status, auth.uid());
  end if;
  if new.review_label is distinct from old.review_label then
    insert into lead_events (lead_id, workspace_id, event, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'labeled', old.review_label, new.review_label, auth.uid());
  end if;
  if new.notes is distinct from old.notes then
    insert into lead_events (lead_id, workspace_id, event, actor) values (new.id, new.workspace_id, 'note_updated', auth.uid());
  end if;
  return new;
end;
$$;
create trigger leads_track_changes before update on leads for each row execute function leads_track_changes();
