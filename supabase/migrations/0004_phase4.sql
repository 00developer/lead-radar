-- Phase 4 (first part): invite-only signup and owner-controlled limits per workspace.
--  * platform_admins: the people who may create invites and set limits (the app owner).
--  * workspace_plans: what a workspace may spend. Members can READ their plan but nobody can change it through the
--    browser: there is no write policy, so only the server connection (which bypasses RLS) can write it.
--  * invites: one-time signup links. Only the SHA-256 hash of the token is stored.
-- Server jobs use a server-side connection that bypasses RLS and always filter by workspace_id.

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- No policies: not readable or writable through the browser roles.

create table workspace_plans (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  allow_apify boolean not null default false,
  allow_official_api boolean not null default false,
  max_results_cap int not null default 100 check (max_results_cap between 1 and 1000),
  max_spend_cap_usd numeric(8,2) not null default 0.50 check (max_spend_cap_usd >= 0 and max_spend_cap_usd <= 50),
  ai_monthly_cap int not null default 200 check (ai_monthly_cap >= 0),
  note text,
  updated_at timestamptz not null default now()
);
alter table workspace_plans enable row level security;
create policy "members read plan" on workspace_plans for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
-- Deliberately no insert, update or delete policy.

-- Workspaces that already exist (the owner's own) keep what they have today: everything allowed up to the old maximums.
insert into workspace_plans (workspace_id, allow_apify, allow_official_api, max_results_cap, max_spend_cap_usd, ai_monthly_cap, note)
select id, true, true, 1000, 50, 100000, 'Owner workspace' from workspaces
on conflict do nothing;

create table invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_workspace_id uuid references workspaces(id) on delete set null,
  revoked_at timestamptz
);
alter table invites enable row level security;
-- No policies: invites are managed only by the server.
