# Phase 1 — Postgres → MySQL Schema Mapping (FMDQ Auctions)

Status: **PROPOSAL — awaiting approval. No DDL written yet.**

Source of truth for the Postgres side:
- `docs/supabase-schema.sql` (base schema + `place_auction_bid` RPC)
- `docs/migrations/0001..0003`
- `docs/security-events.sql`, `docs/supabase-hardening.sql`
- ID-generation confirmed in `server/*.ts` (`crypto.randomUUID()`)

## 0. Tables in scope (14)

`schema_migrations`, `items`, `item_files`, `bids`, `audits`, `users`,
`bid_idempotency_keys`, `roles`, `user_roles`, `sessions`,
`email_verification_tokens`, `notification_queue`, `categories`,
`security_events`.

Global defaults proposed: **InnoDB**, **utf8mb4 / utf8mb4_0900_ai_ci**,
**MySQL 8.0.16+** (needed for enforced CHECK constraints, expression
defaults, and DESC indexes).

## 1. Feature/type mapping (the things that do NOT translate 1:1)

| # | Postgres feature | Where used | MySQL proposal | Notes / risk |
|---|---|---|---|---|
| 1 | **`text` PKs holding app-generated UUIDs** | `items.id`, `item_files.id`, `bids.id`, `audits.id`, `users.id`, `sessions.id`, `email_verification_tokens.id`, `notification_queue.id`, `security_events.id` | **`CHAR(36)`** | Values are `randomUUID()` (36 chars). Keep app-side generation in PHP (`ramsey/uuid` or `bin2hex`-based). No DB UUID type needed. |
| 2 | **`text` natural-key PKs / arbitrary text keys** | `schema_migrations.version`, `bid_idempotency_keys.idempotency_key`, `roles.name`, `categories.name` | **`VARCHAR(n)`** (version 255, idempotency_key 255, role name 64, category name 128) | MySQL cannot index unbounded `TEXT` without a prefix length — every PK/unique/FK text column must become bounded `VARCHAR`. All stay well under the 3072-byte InnoDB key limit. |
| 3 | **UUID PKs — no sequences** | (none) | n/a | There are **no Postgres sequences / serial / bigserial** anywhere. `bid_sequence` and `attempt_count` are plain `INT`s computed in app/SQL, not sequence-backed. Nothing to migrate here. |
| 4 | **"enums" as `text` + CHECK** | `item_files.kind` (image/document), `users.status` (pending_verification/active/disabled), `notification_queue.channel` (email), `notification_queue.status` (pending/sent/failed) | **`ENUM(...)`** for these 4 fixed sets | Self-documenting, compact. Alternative = `VARCHAR` + CHECK (matches PG more literally; easier to extend without `ALTER`). Recommend ENUM; happy to switch to CHECK if you prefer. No native PG `CREATE TYPE` enums exist, so either way is clean. |
| 5 | **`numeric(18,2)`** | `start_bid`, `reserve`, `increment_amount`, `current_bid`, `bids.amount`, `bid_idempotency_keys.amount` | **`DECIMAL(18,2)`** | Exact 1:1. |
| 6 | **`integer`** | `bid_sequence`, `attempt_count` | **`INT`** | 1:1. |
| 7 | **`jsonb`** | `audits.details_json`, `notification_queue.payload_json`, `security_events.details_json` | **`JSON`** | MySQL `JSON` is unordered like `jsonb`. The only `->>` usage (`details_json ->> 'bidderUserId'`) is a **one-time backfill in migration 0001** that won't re-run — no runtime dependency. Default `'{}'` → `DEFAULT (JSON_OBJECT())` (needs 8.0.13+). |
| 8 | **`timestamptz` + `now()`** | every `*_at` column | **`DATETIME(6)` storing UTC**, default `CURRENT_TIMESTAMP(6)` | Recommend `DATETIME(6)` over `TIMESTAMP`: no 2038 limit, no implicit session-tz rewriting. App already works in UTC (`randomUUID`/ISO strings). PHP writes/reads UTC explicitly. Microsecond precision preserved. |
| 9 | **`bid_time text` ('HH:MM')** | `bids.bid_time` | **`VARCHAR(8)`** | It's a formatted display string, not a real time. Keep as-is. |
| 10 | **CHECK constraints** | items (`end>start`, positivity), `bids.amount>0`, plus the enum-style checks | **CHECK constraints** (enforced on 8.0.16+) | 1:1 semantics. If we pick ENUM for #4, those particular checks are replaced by the ENUM. |
| 11 | **FK `ON DELETE CASCADE / SET NULL`** | item_files, bids, bid_idempotency_keys, user_roles, sessions, email_verification_tokens | **Same, InnoDB FKs** | 1:1. Requires referencing columns to match parent type+collation exactly (all `CHAR(36)` / matching `VARCHAR`). |
| 12 | **DESC / multi-column indexes** | `idx_items_created_at (created_at desc)`, `idx_bids_item_amount_created_at`, etc. | **Same**, DESC honored on 8.0.12+ | No partial (`WHERE`) or expression indexes exist, so all port directly. |
| 13 | **RPC `place_auction_bid` (plpgsql)** | called by `server/bid-service.ts` | **Reimplement in PHP inside a transaction** (`START TRANSACTION` → `SELECT … FOR UPDATE` on item + idempotency row → validate → `INSERT` bid → `UPDATE` item → `INSERT` idempotency → `COMMIT`) | Recommended over a MySQL stored procedure: keeps all business logic + role checks in the PHP layer (your stated architecture), is testable, and InnoDB row locks give the same atomicity. **Decision point — see §3.** |
| 14 | **`set_updated_at()` trigger fn** | defined in hardening.sql, **not attached to any table** (no `updated_at` columns exist) | **Drop** (latent). If we ever add `updated_at`: `DATETIME(6) … ON UPDATE CURRENT_TIMESTAMP(6)` | No-op today. |
| 15 | **RLS "no direct client access" policies** | `schema_migrations`, `bid_idempotency_keys`, `security_events` | **N/A — drop** | These existed to block Supabase's anonymous PostgREST role from reading metadata tables. In WAMP there is **no direct DB client**: only the PHP API connects, using one MySQL account. The protection is now architectural. |
| 16 | **RLS as authorization** | (general) | **App-level role checks in PHP** (Phase 3) | This schema's only RLS is the deny-all metadata policies above; real authorization already lives in the Express app's role checks, which Phase 3 re-implements per endpoint. Low risk. |
| 17 | **`pgcrypto` extension** | `create extension pgcrypto` | **Drop** | No `gen_random_uuid()`/`crypt()` used in DDL; IDs are app-side and passwords use app-side hashing. In PHP: `password_hash()`/`password_verify()` (already mirrored by `users.password_hash`). |
| 18 | **`notify pgrst, 'reload schema'`** | end of each migration | **Drop** | PostgREST-specific cache reload. Meaningless in WAMP. |
| 19 | **Default on `text`/`jsonb` cols** | `items.description` default `''`, `*_json` default `'{}'` | `description` → **`VARCHAR(4000)`** (or `TEXT` w/ expression default); JSON → `DEFAULT (JSON_OBJECT())` | MySQL allows literal default on `VARCHAR` freely; `TEXT`/`JSON` defaults need 8.0.13+ expression defaults. |

## 2. Per-table column-type sketch (for reference, not final DDL)

- **id columns (UUID):** `CHAR(36)`
- **FK id columns:** `CHAR(36)` matching parent
- **emails / tokens / claim_token:** `VARCHAR(255)` (`users.email` UNIQUE, `email_verification_tokens.token` UNIQUE)
- **role_name / category / kind / status / channel / event_type / entity_type / actor / actor_type / request_id:** `VARCHAR` (lengths TBD in DDL; enum-style ones per §1.4)
- **money:** `DECIMAL(18,2)`
- **counts/sequences:** `INT`
- **json:** `JSON`
- **timestamps:** `DATETIME(6)` UTC
- **descriptions/error_message/subject:** `TEXT` or wide `VARCHAR`

## 3. Decisions (CONFIRMED 2026-06-18)

1. **Engine: MySQL 8.0.16+.** DDL targets MySQL 8 features (enforced CHECK, JSON, DESC indexes, expression defaults).
2. **`place_auction_bid`: reimplemented as a PHP transaction** (`START TRANSACTION` + `SELECT … FOR UPDATE`), not a stored procedure. Logic and role checks live in the PHP API.
3. **Enum-style fields: native `ENUM`** for `item_files.kind`, `users.status`, `notification_queue.channel`, `notification_queue.status`.

## 4. What does translate 1:1 (no action beyond DDL)

FK relationships, `DECIMAL`, `INT`, multi-column indexes, NOT NULL, UNIQUE
(`users.email`, `email_verification_tokens.token`), composite PK
(`user_roles(user_id, role_name)`), and all the positivity/range CHECKs.
