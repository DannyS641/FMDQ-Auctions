<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Active Directory authentication over LDAPS.
 *
 * Flow (the standard "bind account search, then re-bind as user" pattern):
 *   1. Bind to AD with a read-only SERVICE account.
 *   2. Search for the user by UPN / mail / sAMAccountName.
 *   3. Re-bind AS the found user DN with the supplied password to verify it.
 *   4. Read mail / displayName / memberOf off the entry.
 *
 * Never reveals whether it was the username or password that was wrong.
 */
final class LdapAuth
{
    /** @param array<string,mixed> $cfg the 'ldap' config section */
    public function __construct(private array $cfg)
    {
    }

    /**
     * @return array{email:string,display_name:string,groups:string[]}|null
     *         profile on success, null on any failure (bad creds, not found, etc.)
     */
    public function authenticate(string $identifier, string $password): ?array
    {
        // An empty password must never succeed (AD "unauthenticated bind" quirk).
        if ($password === '') {
            return null;
        }

        $uri = sprintf('%s://%s:%d', $this->cfg['use_ssl'] ? 'ldaps' : 'ldap', $this->cfg['host'], (int) $this->cfg['port']);

        // Cert validation must be set BEFORE connecting.
        $this->applyTlsOptions();

        $conn = @ldap_connect($uri);
        if ($conn === false) {
            error_log('[ldap] ldap_connect failed for ' . $uri);
            return null;
        }
        ldap_set_option($conn, LDAP_OPT_PROTOCOL_VERSION, 3);
        ldap_set_option($conn, LDAP_OPT_REFERRALS, 0);
        ldap_set_option($conn, LDAP_OPT_NETWORK_TIMEOUT, (int) ($this->cfg['network_timeout'] ?? 5));

        if (!empty($this->cfg['start_tls']) && empty($this->cfg['use_ssl'])) {
            if (!@ldap_start_tls($conn)) {
                error_log('[ldap] STARTTLS failed: ' . ldap_error($conn));
                return null;
            }
        }

        // 1. Bind with the service account.
        if (!@ldap_bind($conn, (string) $this->cfg['bind_dn'], (string) $this->cfg['bind_password'])) {
            error_log('[ldap] service bind failed: ' . ldap_error($conn));
            return null;
        }

        // 2. Search for the user.
        $filter = sprintf(
            (string) $this->cfg['user_search_filter'],
            ldap_escape($identifier, '', LDAP_ESCAPE_FILTER),
            ldap_escape($identifier, '', LDAP_ESCAPE_FILTER),
            ldap_escape($identifier, '', LDAP_ESCAPE_FILTER)
        );
        $attrEmail   = (string) $this->cfg['attr_email'];
        $attrDisplay = (string) $this->cfg['attr_display'];
        $attrGroups  = (string) $this->cfg['attr_groups'];

        $search = @ldap_search($conn, (string) $this->cfg['base_dn'], $filter, [$attrEmail, $attrDisplay, $attrGroups]);
        if ($search === false) {
            error_log('[ldap] search failed: ' . ldap_error($conn));
            return null;
        }
        $entries = ldap_get_entries($conn, $search);
        if (!is_array($entries) || ($entries['count'] ?? 0) < 1) {
            return null; // user not found
        }
        $entry  = $entries[0];
        $userDn = $entry['dn'] ?? null;
        if (!is_string($userDn) || $userDn === '') {
            return null;
        }

        // 3. Re-bind AS the user to verify the password.
        if (!@ldap_bind($conn, $userDn, $password)) {
            return null; // wrong password
        }

        // 4. Extract attributes.
        $email = $entry[strtolower($attrEmail)][0] ?? $identifier;
        $name  = $entry[strtolower($attrDisplay)][0] ?? $email;
        $groups = [];
        $rawGroups = $entry[strtolower($attrGroups)] ?? [];
        if (is_array($rawGroups)) {
            for ($i = 0, $n = (int) ($rawGroups['count'] ?? 0); $i < $n; $i++) {
                $groups[] = (string) $rawGroups[$i];
            }
        }

        @ldap_unbind($conn);

        return [
            'email'        => (string) $email,
            'display_name' => (string) $name,
            'groups'       => $groups,
        ];
    }

    private function applyTlsOptions(): void
    {
        $require = (string) ($this->cfg['tls_require_cert'] ?? 'demand');
        $map = [
            'never'  => LDAP_OPT_X_TLS_NEVER,
            'allow'  => LDAP_OPT_X_TLS_ALLOW,
            'demand' => LDAP_OPT_X_TLS_DEMAND,
        ];
        if (isset($map[$require])) {
            ldap_set_option(null, LDAP_OPT_X_TLS_REQUIRE_CERT, $map[$require]);
        }
        if (!empty($this->cfg['cacert_file'])) {
            ldap_set_option(null, LDAP_OPT_X_TLS_CACERTFILE, (string) $this->cfg['cacert_file']);
        }
    }
}
