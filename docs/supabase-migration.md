# Supabase Migration Guide

This project currently runs on local SQLite at [server/data/auctions.sqlite](/Users/wksadmin/FMDQ-Auctions/server/data/auctions.sqlite). To move to Supabase, use the steps below.

## 1. Create the database schema

Open the Supabase SQL Editor and run:

- [docs/supabase-schema.sql](/Users/wksadmin/FMDQ-Auctions/docs/supabase-schema.sql)

That creates the current app tables:

- `users`
- `roles`
- `user_roles`
- `sessions`
- `email_verification_tokens`
- `items`
- `item_files`
- `bids`
- `audits`
- `notification_queue`
- `categories`

It also seeds the default roles and categories.

## 2. Export the current SQLite data

Your local source database is:

- [server/data/auctions.sqlite](/Users/wksadmin/FMDQ-Auctions/server/data/auctions.sqlite)

Recommended export order:

1. `roles`
2. `categories`
3. `users`
4. `user_roles`
5. `sessions`
6. `email_verification_tokens`
7. `items`
8. `item_files`
9. `bids`
10. `audits`
11. `notification_queue`

This order preserves foreign-key dependencies.

## 3. Import the data into Supabase

Use one of these approaches:

- CSV import per table in the Supabase dashboard
- SQL `INSERT` statements generated from SQLite
- a one-off migration script using Node.js

If you use CSV import, map these SQLite text timestamps to Postgres `timestamptz` columns:

- `created_at`
- `last_login_at`
- `start_time`
- `end_time`
- `archived_at`
- `expires_at`
- `processed_at`

## 4. Update app configuration

Once the schema and data are in Supabase, the backend should stop using `node:sqlite` and start using Postgres.

You will need these environment values from Supabase:

- project URL
- database connection string
- service role key if you later use Supabase APIs server-side

Suggested `.env` additions:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://...
```

## 5. Recommended backend migration order

1. Replace SQLite connection setup in [server/index.ts](/Users/wksadmin/FMDQ-Auctions/server/index.ts)
2. Replace prepared statements with Postgres queries
3. Keep the API contract unchanged while swapping persistence
4. Test:
   - sign up
   - verify email
   - sign in / sign out
   - create item
   - edit item
   - archive / restore
   - bid placement
   - exports
   - operations page

## 6. Important note about auth

Right now the app uses its own `users`, `sessions`, and password hashes inside the app database.

That means you have two options:

- keep the current custom auth model and store those tables in Supabase Postgres
- later replace it with Supabase Auth

For the safest migration, keep the current custom auth first, then consider Supabase Auth later.

## 7. Recommendation

Do this in two phases:

1. Move the data layer from SQLite to Supabase Postgres
2. Only after that, decide whether to keep custom auth or move to Supabase Auth
