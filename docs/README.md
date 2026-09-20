# Docs index

**Canonical backend: `api/` (PHP, served via Apache/WAMP).** Frontend is
`src/` (React/Vite) regardless of backend. See [`server/README.md`](../server/README.md)
for why `server/` (Node/Express + Supabase) still exists in the repo but is
deprecated.

## Documents in this folder describe the deprecated Node/Supabase backend

All of the following predate the switch to PHP as canonical and should be
read as historical/reference material, not current operating instructions:

- `project-architecture.md` — Node/Express architecture overview
- `production-hardening.md` — Supabase/Node production checklist
- `DEPLOYMENT.md`, `backup-restore.md`, `SCHEMA_MAPPING.md`, `enterprise-review.md`
- `security-events.sql`, `supabase-schema.sql`, `supabase-hardening.sql`
- `../docs/migrations/` — Supabase (Postgres) SQL migrations

## Where to look for the current (PHP) backend instead

There isn't yet a narrative architecture doc for the PHP backend — the
source of truth today is the code and config directly:

- `api/public/index.php` — router / entry point
- `api/src/` — application code (Auth, Bidding, Admin, Repository, etc.)
- `config/auth.example.php` — annotated config template (copy to `config/auth.php`)
- `database/mysql-schema.sql` — MySQL schema
- `deploy/apache-fmdq.conf`, `deploy/apache-fmdq-local-api.conf` — Apache vhost configs
- `api/tests/` — PHP test scripts (see header comments in each file for how to run)

If you're setting out to write that PHP architecture doc, treat
`project-architecture.md` as a template for the sections worth covering, not
as current fact.
