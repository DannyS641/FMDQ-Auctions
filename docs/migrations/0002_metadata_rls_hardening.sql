begin;

alter table public.schema_migrations enable row level security;

drop policy if exists "no direct client access to schema_migrations" on public.schema_migrations;
create policy "no direct client access to schema_migrations"
on public.schema_migrations
for all
to public
using (false)
with check (false);

alter table public.bid_idempotency_keys enable row level security;

drop policy if exists "no direct client access to bid_idempotency_keys" on public.bid_idempotency_keys;
create policy "no direct client access to bid_idempotency_keys"
on public.bid_idempotency_keys
for all
to public
using (false)
with check (false);

insert into public.schema_migrations (version)
values ('0002_metadata_rls_hardening')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
