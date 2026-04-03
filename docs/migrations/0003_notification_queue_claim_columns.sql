begin;

alter table public.notification_queue
  add column if not exists processed_at timestamptz;

alter table public.notification_queue
  add column if not exists error_message text;

alter table public.notification_queue
  add column if not exists next_attempt_at timestamptz;

alter table public.notification_queue
  add column if not exists attempt_count integer not null default 0;

alter table public.notification_queue
  add column if not exists claim_token text;

alter table public.notification_queue
  add column if not exists claim_expires_at timestamptz;

update public.notification_queue
set next_attempt_at = coalesce(next_attempt_at, created_at),
    attempt_count = coalesce(attempt_count, 0)
where next_attempt_at is null
   or attempt_count is null;

create index if not exists idx_notification_queue_claim_ready
  on public.notification_queue (status, next_attempt_at, claim_expires_at, created_at);

insert into public.schema_migrations (version)
values ('0003_notification_queue_claim_columns')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
