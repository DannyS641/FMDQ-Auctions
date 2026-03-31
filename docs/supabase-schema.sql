begin;

create extension if not exists pgcrypto;

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
create index if not exists idx_item_files_item_kind on public.item_files (item_id, kind);
create index if not exists idx_audits_created_at on public.audits (created_at desc);
create index if not exists idx_sessions_expires_at on public.sessions (expires_at);
create index if not exists idx_email_verification_expires_at on public.email_verification_tokens (expires_at);
create index if not exists idx_notification_queue_status_created_at on public.notification_queue (status, created_at desc);
create index if not exists idx_items_archived_at on public.items (archived_at);

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

commit;
