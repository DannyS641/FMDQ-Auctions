create table if not exists public.security_events (
  id text primary key,
  event_type text not null,
  actor text not null,
  request_id text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_created_at
  on public.security_events (created_at desc);

alter table public.security_events enable row level security;

drop policy if exists "no direct client access to security_events" on public.security_events;
create policy "no direct client access to security_events"
on public.security_events
for all
to public
using (false)
with check (false);
