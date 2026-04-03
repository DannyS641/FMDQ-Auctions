begin;

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

alter table public.notification_queue
  add column if not exists next_attempt_at timestamptz;

alter table public.notification_queue
  add column if not exists attempt_count integer not null default 0;

alter table public.notification_queue
  add column if not exists claim_token text;

alter table public.notification_queue
  add column if not exists claim_expires_at timestamptz;

create index if not exists idx_bids_item_amount_created_at
  on public.bids (item_id, amount desc, created_at desc);

create index if not exists idx_bid_idempotency_keys_expires_at
  on public.bid_idempotency_keys (expires_at);

create index if not exists idx_notification_queue_claim_ready
  on public.notification_queue (status, next_attempt_at, claim_expires_at, created_at);

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

update public.bids b
set bidder_user_id = (a.details_json ->> 'bidderUserId')
from public.audits a
where b.bidder_user_id is null
  and a.event_type = 'BID_PLACED'
  and a.entity_id = b.item_id
  and a.created_at = b.created_at
  and coalesce(a.details_json ->> 'bidderUserId', '') <> '';

update public.notification_queue
set next_attempt_at = created_at,
    attempt_count = 0
where next_attempt_at is null;

insert into public.schema_migrations (version)
values ('0001_bid_queue_hardening')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
