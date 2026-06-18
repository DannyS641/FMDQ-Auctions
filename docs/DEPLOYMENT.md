# FMDQ Auctions — Deployment Guide (WAMP)

How to run the migrated app in production: React build + PHP API + MySQL on a
single Apache origin, with HTTPS, AD/LDAPS auth, and a scheduled email worker.

## 1. Architecture

```
            ┌──────────────────────── Apache (one HTTPS vhost) ───────────────────────┐
 Browser ──►│  /                -> dist/ (React build, SPA)                            │
            │  /assets/*        -> dist/ static files                                  │
            │  /api/*           -> api/public/index.php  (PHP API) ─► MySQL            │
            │  /uploads/*       -> api/public/index.php  (access-controlled files)     │
            └─────────────────────────────────────────────────────────────────────────┘
                         cron / Task Scheduler ─► api/tools/process_notifications.php ─► SMTP
```

Same origin = **no CORS**, and the session cookie (httpOnly + Secure + SameSite)
also covers CSRF.

**Only `dist/` and `api/public/` are web-exposed.** `config/`, `api/src/`,
`storage/`, and `database/` MUST stay outside the document root (they already are).

## 2. Prerequisites

- Apache 2.4 with **mod_rewrite, mod_headers, mod_ssl**, and PHP enabled.
- **PHP 8.1+** with extensions: `pdo_mysql`, `ldap`, `openssl`, `json`, `mbstring`, `curl`, `zip`.
  - WAMP: enable them in the tray → PHP → PHP extensions.
  - Verify: `php -m | findstr "ldap pdo_mysql openssl zip"`
- **MySQL 8.0.16+**.
- **Node 18+** (only to *build* the frontend; not needed at runtime).

## 3. Build the frontend

```bash
npm ci
npm run build      # outputs dist/
```
Re-run on every frontend change and redeploy `dist/`.

## 4. Lay out the files

Copy the repo to the server (e.g. `C:/wamp64/www/fmdq`). The web root points only
at `dist/`; PHP code is reached via Alias. Ensure these are writable by the
Apache user:
```
storage/uploads/      (item images & documents)
storage/outbox/       (sent-email records, file transport)
storage/deadletter/   (failed emails after retries)
```

## 5. Production config (`config/auth.php`)

Copy `config/auth.example.php` → `config/auth.php` and set:

| Section | Production value |
|---|---|
| `db` | host `127.0.0.1`, **port 3306**, a dedicated MySQL user (not root), the real password |
| `jwt.secret` | a fresh 64-hex secret: `php -r "echo bin2hex(random_bytes(32));"` |
| `jwt.cookie_secure` | **`true`** (HTTPS only) |
| `app.base_url` | `https://auctions.fmdqgroup.com` |
| `auth.internal_email_domains` | `['fmdqgroup.com']` (your AD domain) |
| `notify.transport` | `smtp` |
| `smtp.*` | real host/port/secure/user/pass |
| `notify.from` / `notify.to` | real sender + ops recipient |
| `storage.image_access_policy` | `public` (open item photos) or `bidder_visible` (gated) |
| `admin_api.enabled` | **`false`** (dev-only bypass) |
| `ldap.*` | see §9 |
| `role_map` | your real AD group DNs → app roles |

`config/auth.php` is gitignored — never commit real secrets.

## 6. Database

```sql
CREATE DATABASE fmdq_auctions CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'fmdq_app'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON fmdq_auctions.* TO 'fmdq_app'@'localhost';
```
Load the schema:
```bash
mysql -u root -p fmdq_auctions < database/mysql-schema.sql
```
Data is migrated separately with `php api/tools/migrate_from_supabase.php --confirm`
(see the migration notes; one-time, while Supabase is reachable).

## 7. Apache vhost

Use `deploy/apache-fmdq.conf` (adjust paths + ServerName). Then:
- WAMP: add an `Include` for it (or paste into `httpd-vhosts.conf`), enable
  mod_rewrite/mod_headers/mod_ssl, and **Restart All Services**.
- Confirm: `httpd -t` (syntax) then browse `https://<host>/api/health`.

## 8. HTTPS

- **Commercial cert:** point `SSLCertificateFile`/`KeyFile` at your `.crt`/`.key`.
- **Let's Encrypt on Windows:** use **win-acme** to issue + auto-renew, then set
  the paths it produces.
- **Staging/self-signed** (testing only):
  `openssl req -x509 -newkey rsa:2048 -nodes -keyout fmdq.key -out fmdq-fullchain.crt -days 365 -subj "/CN=auctions.fmdqgroup.com"`

After enabling HTTPS, set `jwt.cookie_secure = true`.

## 9. Active Directory over LDAPS (internal logins)

This is the one piece that needs your domain controller to verify.

1. **Enable** `extension=ldap` in `php.ini` (restart Apache).
2. **Firewall:** allow outbound **TCP 636** from the web server to the DC.
3. **Server certificate:** export the AD root CA cert and set
   `ldap.cacert_file` to it; keep `ldap.tls_require_cert = 'demand'` (validate
   the DC cert — do **not** use `never` in production).
4. **Config** (`config/auth.php` → `ldap`): `enabled = true`, `host` (DC FQDN),
   `port = 636`, `use_ssl = true`, `base_dn`, and a **read-only service account**
   `bind_dn` + `bind_password`.
5. **Map AD groups → roles** in `role_map` (group DNs → Admin/Bidder/Observer).
6. **Test connectivity before going live:**
   ```bash
   openssl s_client -connect dc.fmdqgroup.com:636        # cert chain OK?
   ldapsearch -H ldaps://dc.fmdqgroup.com -D "CN=svc-auction,..." -w '<pass>' \
     -b "DC=fmdqgroup,DC=com" "(userPrincipalName=someone@fmdqgroup.com)" memberOf
   ```
7. **Smoke-test** an internal login at `/signin`; the user is auto-provisioned
   (auth_source=ad) and roles sync from their AD groups on each login.

## 10. Email worker (notification queue)

Drain the queue on a schedule (the old long-running Node worker is replaced by a
run-once PHP script):

- **Windows Task Scheduler** — every 1 minute:
  ```
  schtasks /Create /SC MINUTE /MO 1 /TN "FMDQ Notifications" ^
    /TR "\"C:\wamp64\bin\php\php8.x\php.exe\" \"C:\wamp64\www\fmdq\api\tools\process_notifications.php\""
  ```
- **Linux/macOS cron:**
  ```
  * * * * * /usr/bin/php /var/www/fmdq/api/tools/process_notifications.php >> /var/log/fmdq-notify.log 2>&1
  ```

## 11. Post-deploy verification

- [ ] `https://host/api/health` → `{"ok":true}`
- [ ] React app loads over HTTPS; deep links (e.g. `/bidding/<id>`) work (SPA fallback)
- [ ] **External** login fails until reset; forgot-password email arrives via SMTP
- [ ] **Internal** (AD) login works and lands with the right role
- [ ] Item list + details load; **item images display**; gated documents 403 for the wrong role
- [ ] Place a bid; admin can create/update/archive items and manage users
- [ ] Notification worker runs (check `storage/outbox` empties / emails arrive)

## 12. Cutover notes

- The data migration replaced the dev/test data with real Supabase data.
- **External users must reset passwords** (scrypt hashes weren't carried) — or an
  admin bulk-triggers resets via the operations desk.
- **One item ("Corolla 2018") has a broken image** (it was only on the old
  server's disk) — re-upload it via the admin item form.
- Point DNS (`auctions.fmdqgroup.com`) at the web server once verified.

## Appendix — local preview (macOS / MAMP)

To preview the exact same-origin layout without Apache:
```bash
npm run build
php -S localhost:8080 -t dist deploy/router.php   # uses MAMP's php
```
`deploy/router.php` mirrors the vhost (/api + /uploads → PHP, else SPA). MAMP
vhosts live in `/Applications/MAMP/conf/apache/extra/httpd-vhosts.conf` if you
prefer real Apache locally; paths differ from the Windows examples above, but the
`<Directory>`/Alias/Rewrite structure is identical.
