-- Workspace settings table alteration for user-configurable toggles
alter table workspace_settings add column auto_reply_enabled boolean not null default false;

-- Message queue table
create type outbound_message_status as enum ('pending', 'sent', 'failed');

create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references posts(id) on delete cascade,
  post_id text not null, -- The external ID of the post to reply to
  message_text text not null,
  status outbound_message_status not null default 'pending',
  error_note text,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(lead_id) -- only one automated reply per lead
);
alter table outbound_messages enable row level security;
create policy "members manage outbound messages" on outbound_messages for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));
