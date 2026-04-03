begin;

create extension if not exists pgcrypto;

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;

drop policy if exists "no direct client access to schema_migrations" on public.schema_migrations;
create policy "no direct client access to schema_migrations"
on public.schema_migrations
for all
to public
using (false)
with check (false);

create table if not exists public.items (
  id text primary key,
  title text not null,
  category text not null,
  lot text not null,
  sku text not null,
  condition text not null,
  location text not null,
  start_bid numeric(18,2) not null,
  reserve numeric(18,2) not null default 0,
  increment_amount numeric(18,2) not null,
  current_bid numeric(18,2) not null default 0,
  start_time timestamptz not null,
  end_time timestamptz not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint items_end_after_start check (end_time > start_time),
  constraint items_start_bid_positive check (start_bid > 0),
  constraint items_reserve_non_negative check (reserve >= 0),
  constraint items_increment_positive check (increment_amount > 0)
);

create table if not exists public.item_files (
  id text primary key,
  item_id text not null references public.items(id) on delete cascade,
  kind text not null,
  name text not null,
  url text not null,
  constraint item_files_kind_valid check (kind in ('image', 'document'))
);

create table if not exists public.bids (
  id text primary key,
  item_id text not null references public.items(id) on delete cascade,
  bidder_alias text not null,
  amount numeric(18,2) not null,
  bid_time text not null,
  created_at timestamptz not null default now(),
  constraint bids_amount_positive check (amount > 0)
);

create table if not exists public.audits (
  id text primary key,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  actor text not null,
  actor_type text not null,
  request_id text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint users_status_valid check (status in ('pending_verification', 'active', 'disabled'))
);

alter table public.bids
  add column if not exists bidder_user_id text references public.users(id) on delete set null;

create table if not exists public.bid_idempotency_keys (
  idempotency_key text primary key,
  item_id text not null references public.items(id) on delete cascade,
  bid_id text not null references public.bids(id) on delete cascade,
  bidder_user_id text references public.users(id) on delete set null,
  amount numeric(18,2) not null,
  bid_sequence integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.bid_idempotency_keys enable row level security;

drop policy if exists "no direct client access to bid_idempotency_keys" on public.bid_idempotency_keys;
create policy "no direct client access to bid_idempotency_keys"
on public.bid_idempotency_keys
for all
to public
using (false)
with check (false);

create table if not exists public.roles (
  name text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id text not null references public.users(id) on delete cascade,
  role_name text not null references public.roles(name) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_name)
);

create table if not exists public.sessions (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.email_verification_tokens (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.notification_queue (
  id text primary key,
  channel text not null,
  event_type text not null,
  recipient text not null,
  subject text not null,
  status text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer not null default 0,
  claim_token text,
  claim_expires_at timestamptz,
  error_message text,
  constraint notification_queue_channel_valid check (channel in ('email')),
  constraint notification_queue_status_valid check (status in ('pending', 'sent', 'failed'))
);

create table if not exists public.categories (
  name text primary key,
  created_at timestamptz not null default now()
);

create index if not exists idx_items_created_at on public.items (created_at desc);
create index if not exists idx_bids_item_created_at on public.bids (item_id, created_at desc);
create index if not exists idx_bids_item_amount_created_at on public.bids (item_id, amount desc, created_at desc);
create index if not exists idx_item_files_item_kind on public.item_files (item_id, kind);
create index if not exists idx_audits_created_at on public.audits (created_at desc);
create index if not exists idx_sessions_expires_at on public.sessions (expires_at);
create index if not exists idx_email_verification_expires_at on public.email_verification_tokens (expires_at);
create index if not exists idx_notification_queue_status_created_at on public.notification_queue (status, created_at desc);
create index if not exists idx_notification_queue_claim_ready on public.notification_queue (status, next_attempt_at, claim_expires_at, created_at);
create index if not exists idx_items_archived_at on public.items (archived_at);

create or replace function public.place_auction_bid(
  p_item_id text,
  p_bid_id text,
  p_bidder_alias text,
  p_bidder_user_id text,
  p_amount numeric,
  p_expected_current_bid numeric,
  p_idempotency_key text,
  p_created_at timestamptz,
  p_idempotency_expires_at timestamptz
)
returns table (
  item_id text,
  bid_id text,
  bid_sequence integer,
  current_bid numeric,
  previous_bidder_user_id text,
  duplicate boolean
)
language plpgsql
set search_path = public
as $$
declare
  locked_item public.items%rowtype;
  existing_idempotency public.bid_idempotency_keys%rowtype;
  required_bid numeric;
  placed_sequence integer;
  previous_user_id text;
begin
  select *
    into locked_item
    from public.items
    where id = p_item_id
      and archived_at is null
    for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if coalesce(trim(p_idempotency_key), '') <> '' then
    select *
      into existing_idempotency
      from public.bid_idempotency_keys
      where idempotency_key = p_idempotency_key
      for update;

    if found then
      if existing_idempotency.item_id <> p_item_id
        or coalesce(existing_idempotency.bidder_user_id, '') <> coalesce(p_bidder_user_id, '')
        or existing_idempotency.amount <> p_amount then
        raise exception 'IDEMPOTENCY_KEY_CONFLICT';
      end if;

      return query
      select
        existing_idempotency.item_id,
        existing_idempotency.bid_id,
        existing_idempotency.bid_sequence,
        locked_item.current_bid,
        null::text,
        true;
      return;
    end if;
  end if;

  if locked_item.current_bid <> p_expected_current_bid then
    raise exception 'BID_STATE_CHANGED';
  end if;

  if p_created_at < locked_item.start_time or p_created_at > locked_item.end_time then
    raise exception 'BIDDING_CLOSED';
  end if;

  required_bid := greatest(locked_item.current_bid, locked_item.start_bid) + locked_item.increment_amount;

  if p_amount < required_bid then
    raise exception 'BID_TOO_LOW:%', required_bid;
  end if;

  if mod(
    round((p_amount - required_bid) * 100)::bigint,
    round(locked_item.increment_amount * 100)::bigint
  ) <> 0 then
    raise exception 'INVALID_INCREMENT:%', locked_item.increment_amount;
  end if;

  select bidder_user_id
    into previous_user_id
    from public.bids
    where bids.item_id = p_item_id
    order by amount desc, created_at desc
    limit 1;

  select count(*) + 1
    into placed_sequence
    from public.bids
    where bids.item_id = p_item_id;

  insert into public.bids (
    id,
    item_id,
    bidder_alias,
    bidder_user_id,
    amount,
    bid_time,
    created_at
  ) values (
    p_bid_id,
    p_item_id,
    'Bidder-' || lpad(placed_sequence::text, 3, '0'),
    nullif(p_bidder_user_id, ''),
    p_amount,
    to_char(p_created_at at time zone 'UTC', 'HH24:MI'),
    p_created_at
  );

  update public.items
    set current_bid = p_amount
    where id = p_item_id;

  if coalesce(trim(p_idempotency_key), '') <> '' then
    insert into public.bid_idempotency_keys (
      idempotency_key,
      item_id,
      bid_id,
      bidder_user_id,
      amount,
      bid_sequence,
      created_at,
      expires_at
    ) values (
      p_idempotency_key,
      p_item_id,
      p_bid_id,
      nullif(p_bidder_user_id, ''),
      p_amount,
      placed_sequence,
      p_created_at,
      p_idempotency_expires_at
    );
  end if;

  return query
  select
    p_item_id,
    p_bid_id,
    placed_sequence,
    p_amount,
    previous_user_id,
    false;
end;
$$;

insert into public.roles (name)
values
  ('Admin'),
  ('Bidder'),
  ('Observer')
on conflict (name) do nothing;

insert into public.categories (name)
values
  ('Cars'),
  ('Furniture'),
  ('Household Appliances'),
  ('Kitchen Appliances'),
  ('Phones'),
  ('Other')
on conflict (name) do nothing;

insert into public.schema_migrations (version)
values
  ('0001_bid_queue_hardening'),
  ('0002_metadata_rls_hardening')
on conflict (version) do nothing;

commit;
