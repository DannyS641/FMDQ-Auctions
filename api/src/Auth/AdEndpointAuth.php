<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Active Directory authentication via an HTTP endpoint (the FMDQ "goldhive" API),
 * port of authenticateWithAdEndpoint + mapAdRole in the original Express app.
 *
 * POSTs {usernameField, passwordField} to the configured endpoint and reads the
 * JSON response using dot-path config (authenticated / email / displayName /
 * groups). Maps AD groups to a single app role via the configured group lists.
 *
 * This is the alternative to LdapAuth for sites that front AD with an HTTP API
 * instead of exposing LDAPS directly.
 */
final class AdEndpointAuth
{
    /** @param array<string,mixed> $cfg the 'ad_endpoint' config section */
    public function __construct(private array $cfg)
    {
    }

    /**
     * @return array{email:string,display_name:string,role:string}|null
     *         profile (with mapped role) on success, null on failure/unauthorized.
     */
    public function authenticate(string $identifier, string $password): ?array
    {
        if ($password === '' || ($this->cfg['endpoint'] ?? '') === '') {
            return null;
        }

        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        if (!empty($this->cfg['api_key'])) {
            $header = (string) ($this->cfg['api_key_header'] ?? 'Authorization');
            $headers[] = $header . ': ' . $this->cfg['api_key'];
        }
        $body = json_encode([
            (string) ($this->cfg['username_field'] ?? 'username') => $identifier,
            (string) ($this->cfg['password_field'] ?? 'password') => $password,
        ], JSON_UNESCAPED_SLASHES);

        $ch = curl_init((string) $this->cfg['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => (int) ($this->cfg['timeout'] ?? 10),
            // A realistic User-Agent so the upstream WAF doesn't flag the call as
            // a non-browser "signature". Override via config if needed.
            CURLOPT_USERAGENT => (string) ($this->cfg['user_agent']
                ?? 'Mozilla/5.0 (FMDQ-Auctions-Server) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'),
        ]);
        // TLS trust. Point cacert_file at a CA bundle in production. ssl_verify
        // may be set false for local dev only (NEVER in production).
        if (!empty($this->cfg['cacert_file'])) {
            curl_setopt($ch, CURLOPT_CAINFO, (string) $this->cfg['cacert_file']);
        }
        // ssl_verify=false is honored ONLY outside production — it must never
        // be possible to ship credential-bearing requests over unverified TLS.
        $isProd = (\App\Config::load()['app']['env'] ?? 'production') === 'production';
        if (!$isProd && ($this->cfg['ssl_verify'] ?? true) === false) {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            error_log('[ad-endpoint] request failed: ' . $curlErr);
            return null;
        }
        $payload = json_decode((string) $raw, true);
        if ($status < 200 || $status >= 300 || !is_array($payload)) {
            return null; // non-2xx or unparseable -> treat as auth failure
        }

        // Determine "authenticated". If no path configured, a 2xx response counts.
        $authPath = (string) ($this->cfg['authenticated_path'] ?? 'authenticated');
        if ($authPath !== '') {
            $val = self::pathValue($payload, $authPath);
            $authenticated = $val === true || $val === 'true' || $val === 'success';
            if (!$authenticated) {
                return null;
            }
        }

        $username = self::stringAt($payload, (string) ($this->cfg['username_path'] ?? 'username')) ?: $identifier;
        $email = self::stringAt($payload, (string) ($this->cfg['email_path'] ?? 'email'));
        $display = self::stringAt($payload, (string) ($this->cfg['display_name_path'] ?? 'displayName'));
        $groups = self::stringListAt($payload, (string) ($this->cfg['groups_path'] ?? 'groups'));

        // Derive an email if the endpoint did not return one.
        $domain = (string) ($this->cfg['email_domain'] ?? '');
        if ($email === '') {
            if (str_contains($identifier, '@')) {
                $email = $identifier;
            } elseif ($domain !== '') {
                $email = $username . '@' . $domain;
            }
        }
        if ($email === '') {
            return null; // can't provision without an email
        }

        $role = $this->mapRole($groups);
        if ($role === null) {
            return null; // authenticated but not authorized for the portal
        }

        return [
            'email' => strtolower(trim($email)),
            'display_name' => $display !== '' ? $display : ($username !== '' ? $username : explode('@', $email)[0]),
            'role' => $role,
        ];
    }

    /** Map AD groups to a single role (SuperAdmin > Admin > ShopOwner > Bidder), else default. */
    private function mapRole(array $groups): ?string
    {
        $map = $this->cfg['role_map'] ?? [];
        foreach (['SuperAdmin', 'Admin', 'ShopOwner', 'Bidder'] as $role) {
            if (self::includesAnyGroup($groups, $map[$role] ?? [])) {
                return $role;
            }
        }
        $default = (string) ($this->cfg['default_role'] ?? 'Bidder');
        return $default !== '' ? $default : null;
    }

    /** @param string[] $groups @param string[] $configured */
    private static function includesAnyGroup(array $groups, array $configured): bool
    {
        $lowerGroups = array_map('strtolower', $groups);
        foreach ($configured as $cg) {
            $c = strtolower(trim((string) $cg));
            if ($c === '') continue;
            foreach ($lowerGroups as $g) {
                if ($g === $c || str_contains($g, $c)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function pathValue(mixed $data, string $path): mixed
    {
        if ($path === '') return null;
        foreach (explode('.', $path) as $key) {
            if (is_array($data) && array_key_exists($key, $data)) {
                $data = $data[$key];
            } else {
                return null;
            }
        }
        return $data;
    }

    private static function stringAt(mixed $data, string $path): string
    {
        $v = self::pathValue($data, $path);
        return is_string($v) ? trim($v) : '';
    }

    /** @return string[] */
    private static function stringListAt(mixed $data, string $path): array
    {
        $v = self::pathValue($data, $path);
        if (is_array($v)) {
            return array_values(array_filter(array_map(fn ($e) => trim((string) $e), $v), fn ($e) => $e !== ''));
        }
        if (is_string($v)) {
            return array_values(array_filter(array_map('trim', explode(',', $v)), fn ($e) => $e !== ''));
        }
        return [];
    }
}
