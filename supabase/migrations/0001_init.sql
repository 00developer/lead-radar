-- Lead Radar: initial schema (Phase 1, decision D-30: the full schema is created now).
-- Phase 1 code uses: workspaces, workspace_members, workspace_settings, workspace_services, keywords,
-- collector_runs, posts, classifications, leads, ai_usage.
-- Phase 2 tables (not used by Phase 1 code): lead_events, alerts, threads_connections, business_profiles, business_offerings.
-- Tables are created in dependency order. See docs/data-model.md.
--
-- Changes against the first draft in data-model.md (see decisions D-34 and D-36):
--  * workspace_settings.allowed_languages (language filter)
--  * posts.prefilter_status also allows 'dropped_short' and 'dropped_language'

-- Tenancy ---------------------------------------------------------------------------------------
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  primary key (workspace_id, user_id)
);

create table workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  lead_intent_threshold int not null default 60 check (lead_intent_threshold between 0 and 100),
  alert_intent_threshold int not null default 80 check (alert_intent_threshold between 0 and 100),
  max_post_age_days int not null default 14 check (max_post_age_days > 0),
  allowed_languages text[] not null default array['en','hi','hinglish'],
  alert_email text,
  ai_monthly_ceiling int not null default 2000 check (ai_monthly_ceiling >= 0),
  updated_at timestamptz not null default now()
);

-- Services are data (per workspace). 'other' is built in and is not stored here.
create table workspace_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9_]*$' and slug <> 'other'),
  name text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table keywords (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  service_id uuid references workspace_services(id) on delete set null,
  term text not null,
  language text not null check (language in ('en','hinglish','hi')),
  is_negative boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, term, is_negative)
);

-- Phase 2: official Threads OAuth connection (one per workspace in V1, D-27)
create table threads_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  threads_user_id text not null,
  username text not null,
  access_token_encrypted text,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','needs_reconnect','disconnected')),
  last_error text,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (workspace_id)
);

-- Collection ------------------------------------------------------------------------------------
create table collector_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,
  status text not null check (status in ('running','ok','partial','failed')),
  keywords_used text[] not null default '{}',
  posts_returned int not null default 0,
  posts_new int not null default 0,
  queries_used int not null default 0,
  connection_id uuid references threads_connections(id) on delete set null,
  cost_usd numeric(10,4) not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on collector_runs (workspace_id, started_at desc);

create table posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid references collector_runs(id) on delete set null,
  source text not null,
  external_id text not null,
  url text not null,
  text text not null,
  author_handle text not null,
  author_name text,
  author_profile_url text,
  author_bio text,
  posted_at timestamptz,
  language text,
  reply_count int,
  parent_external_id text,
  matched_keyword text,
  prefilter_status text not null default 'pending'
    check (prefilter_status in ('pending','passed','dropped_old','dropped_negative_keyword','dropped_duplicate','dropped_short','dropped_language')),
  prefilter_reason text,
  raw jsonb,
  collected_at timestamptz not null default now(),
  unique (workspace_id, source, external_id)
);
create index on posts (workspace_id, prefilter_status);
create index on posts (workspace_id, posted_at desc);

-- Phase 2: Business Profile (created now so the schema stays stable). Must exist before classifications.
create table business_profiles (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  website_url text not null,
  business_summary text,
  status text not null default 'draft' check (status in ('draft','confirmed')),
  pages_fetched jsonb,
  last_scanned_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table business_offerings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  service_id uuid references workspace_services(id) on delete set null,
  kind text not null check (kind in ('product','service')),
  name text not null,
  description text,
  source_url text,
  origin text not null default 'ai_extracted' check (origin in ('ai_extracted','manual')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Classification: one row per post per prompt version
create table classifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  prompt_version text not null,
  model text not null,
  author_type text not null check (author_type in ('buyer','seller','spam','irrelevant','unclear')),
  service text,
  intent_score int check (intent_score between 0 and 100),
  urgency text check (urgency in ('low','medium','high')),
  budget text,
  timeline text,
  language text,
  reason text,
  reply_draft text,
  confidence numeric(3,2) check (confidence between 0 and 1),
  matched_offering_id uuid references business_offerings(id) on delete set null,
  fit text check (fit in ('strong','partial','none')),
  needs_review boolean not null default false,
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now(),
  unique (post_id, prompt_version)
);
create index on classifications (workspace_id, post_id);

-- Leads: what the Lead Inbox shows
create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  classification_id uuid not null references classifications(id),
  status text not null default 'new' check (status in ('new','contacted','replied','won','lost','dismissed')),
  review_label text check (review_label in ('genuine','not_genuine')),
  needs_review boolean not null default false,
  notes text,
  reply_draft_edited text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, post_id)
);
create index on leads (workspace_id, status, created_at desc);

-- Phase 2 tables
create table lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  event text not null,
  from_value text,
  to_value text,
  actor uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null check (channel in ('email','telegram','whatsapp')),
  status text not null check (status in ('sent','failed')),
  error text,
  sent_at timestamptz not null default now(),
  unique (lead_id, channel)
);

-- AI usage (monthly ceiling)
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null default 'classify',
  created_at timestamptz not null default now()
);
create index on ai_usage (workspace_id, created_at);

-- Functions -------------------------------------------------------------------------------------
-- Atomic check-and-insert. An advisory transaction lock per workspace stops concurrent callers from
-- exceeding the ceiling. Counts the current UTC calendar month. Call right before each model call.
create function try_record_ai_usage(p_workspace_id uuid, p_kind text, p_ceiling int)
returns boolean
language plpgsql
as $$
declare
  used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  select count(*) into used
    from ai_usage
   where workspace_id = p_workspace_id
     and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  if used >= p_ceiling then
    return false;
  end if;
  insert into ai_usage (workspace_id, kind) values (p_workspace_id, p_kind);
  return true;
end;
$$;

-- Row Level Security ---------------------------------------------------------------------------
-- Pattern: a row is visible and writable only to members of its workspace.
-- Server jobs use a server-side connection that bypasses RLS and must always filter by workspace_id.
alter table workspaces enable row level security;
create policy "members read" on workspaces for select
  using (id in (select workspace_id from workspace_members where user_id = auth.uid()));

alter table workspace_members enable row level security;
create policy "read own membership" on workspace_members for select
  using (user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_settings','workspace_services','keywords','threads_connections','collector_runs','posts',
    'business_profiles','business_offerings','classifications','leads','lead_events','alerts','ai_usage'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "members read" on %I for select using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))', t);
    execute format(
      'create policy "members write" on %I for all using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())) with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))', t);
  end loop;
end $$;

-- Hardening that only applies on Supabase (roles exist there): the encrypted Threads token is never readable
-- through the browser roles, and the usage function is not callable by them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke select on threads_connections from authenticated, anon;
    grant select (id, workspace_id, threads_user_id, username, scopes, token_expires_at, status, last_error, connected_at, last_used_at)
      on threads_connections to authenticated;
    revoke execute on function try_record_ai_usage(uuid, text, int) from public, anon, authenticated;
  end if;
end $$;
