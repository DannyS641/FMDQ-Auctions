<?php
/**
 * FMDQ Auctions — backend configuration TEMPLATE.
 *
 * Copy this file to `config/auth.php` and fill in real values.
 * `config/auth.php` is gitignored and lives OUTSIDE the web root
 * (DocumentRoot is api/public), so these secrets are never served.
 *
 * Do NOT commit real credentials.
 */

return [
    // -------------------------------------------------------------------------
    // Database (MySQL 8). On MAMP: host 127.0.0.1, port 8889, root/root.
    // -------------------------------------------------------------------------
    'db' => [
        'host'    => '127.0.0.1',
        'port'    => 8889,            // MAMP default; production WAMP is usually 3306
        'dbname'  => 'fmdq_auctions',
        'user'    => 'root',
        'pass'    => 'root',
        'charset' => 'utf8mb4',
        // Optional: connect via unix socket instead of host/port (leave '' to use TCP)
        'unix_socket' => '',
    ],

    // -------------------------------------------------------------------------
    // JWT / session. Generate a strong secret, e.g.:
    //   php -r "echo bin2hex(random_bytes(32));"
    // -------------------------------------------------------------------------
    'jwt' => [
        'secret'      => 'CHANGE_ME_to_a_64_char_hex_secret',
        'issuer'      => 'fmdq-auctions',
        'ttl_seconds' => 60 * 60 * 8,   // session lifetime: 8 hours
        'cookie_name' => 'fmdq_session',
        'cookie_secure'   => false,     // MUST be true in production (HTTPS only)
        'cookie_samesite' => 'Lax',     // 'Lax' for same-origin app; 'Strict' is safer
    ],

    // -------------------------------------------------------------------------
    // How the backend decides INTERNAL (AD) vs EXTERNAL (local) per login.
    // If the login email's domain is in this list -> LDAP/AD path.
    // Otherwise -> local account path.
    // -------------------------------------------------------------------------
    'auth' => [
        'internal_email_domains' => ['fmdq.com'],   // <-- set to your AD domain(s)
        // Role granted to any authenticated internal user even with no group match.
        // Set to null to deny internal users who match no mapped group.
        'default_internal_role'  => 'Observer',
    ],

    // -------------------------------------------------------------------------
    // LDAP / Active Directory (internal users). Uses a service/bind account to
    // search for the user, then re-binds AS the user to verify the password.
    // -------------------------------------------------------------------------
    'ldap' => [
        'enabled'   => false,           // set true once AD connectivity is configured
        'host'      => 'ad.fmdq.com',   // AD domain controller hostname
        'port'      => 636,             // 636 = LDAPS
        'use_ssl'   => true,            // ldaps:// (recommended). Requires valid cert chain.
        'start_tls' => false,           // alternative to use_ssl: ldap:// + STARTTLS on 389
        'base_dn'   => 'DC=fmdq,DC=com',
        // Service/bind account used ONLY to search the directory (read-only is enough):
        'bind_dn'       => 'CN=svc-auction,OU=Service Accounts,DC=fmdq,DC=com',
        'bind_password' => 'CHANGE_ME',
        // %s is replaced with the (escaped) login identifier:
        'user_search_filter' => '(|(userPrincipalName=%s)(mail=%s)(sAMAccountName=%s))',
        // Attributes to read off the user entry:
        'attr_email'       => 'mail',
        'attr_display'     => 'displayName',
        'attr_groups'      => 'memberOf',
        // TLS cert validation. In dev against a self-signed DC you may set 'never',
        // but production MUST be 'demand' (validate the server certificate).
        'tls_require_cert' => 'demand', // 'demand' | 'allow' | 'never'
        'cacert_file'      => '',       // optional path to CA bundle for the AD cert
        'network_timeout'  => 5,        // seconds
    ],

    // -------------------------------------------------------------------------
    // File storage (item images/documents). Lives OUTSIDE the web root; Apache
    // serves it through access-controlled routes (Phase 5). Leave uploads_dir
    // empty to default to <project>/storage/uploads.
    // -------------------------------------------------------------------------
    'storage' => [
        'uploads_dir'    => '',
        'max_file_bytes' => 15 * 1024 * 1024,
    ],

    // Bulk-import (CSV + optional ZIP bundle) safety limits.
    'import' => [
        'max_archive_entries' => 200,
        'max_extracted_bytes' => 50 * 1024 * 1024,
    ],

    // -------------------------------------------------------------------------
    // Notifications. 'to' is the ops recipient for item lifecycle emails
    // (created/updated/archived). Empty = those emails are skipped.
    // -------------------------------------------------------------------------
    'notify' => [
        'to'   => '',
        'from' => 'no-reply@fmdq.com',
    ],

    // -------------------------------------------------------------------------
    // AD group (DN) -> application role. Keys are AD group distinguished names
    // (compared case-insensitively). Values must exist in the `roles` table
    // (Admin | Bidder | Observer). A user gets the UNION of all matches.
    // -------------------------------------------------------------------------
    'role_map' => [
        'CN=Auction-Admins,OU=Groups,DC=fmdq,DC=com'   => 'Admin',
        'CN=Auction-Bidders,OU=Groups,DC=fmdq,DC=com'  => 'Bidder',
        'CN=Auction-Viewers,OU=Groups,DC=fmdq,DC=com'  => 'Observer',
    ],
];
