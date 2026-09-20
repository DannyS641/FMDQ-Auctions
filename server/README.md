# Deprecated — legacy Node backend

This directory (`server/`) is a Node.js + Express + Supabase implementation of
the FMDQ Auctions API. As of 2026-08-12 it is **no longer the canonical
backend**.

**The canonical backend is `api/` (PHP, served via Apache/WAMP).** New
features, bug fixes, and security patches should go there. See
`api/public/index.php` for the router and `api/src/` for the application
code.

## Why this exists but isn't deleted

This was an earlier/parallel implementation of the same API. It's kept in
the repo for reference (data-model comparisons, past design decisions) but
is not run in production and should not be extended. If you're not sure
whether something belongs here or in `api/`, it belongs in `api/`.

## What still points at this backend

- `docs/project-architecture.md` describes this stack in detail — treat it
  as a historical description of the Node backend, not the current system.
- `tests/api-routes.test.ts` and `tests/security-logic.test.ts` test this
  backend's internals (`server/register-auth-routes.ts`,
  `server/security-logic.ts`). They still pass and are harmless to run, but
  they are not covering the code that actually serves traffic.
- `shared/permissions.ts` is **not** part of this deprecation — it's used by
  both the frontend and this backend, and has an equivalent port at
  `api/src/Auth/Permissions.php` for the PHP side.
