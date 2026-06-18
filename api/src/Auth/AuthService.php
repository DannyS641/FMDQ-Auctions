<?php
declare(strict_types=1);

namespace App\Auth;

use App\Config;
use App\Repository\SessionRepository;
use App\Repository\UserRepository;
use App\Support\Uuid;

/**
 * Orchestrates the hybrid login: decides internal (AD) vs external (local) per
 * login, verifies credentials on the chosen path, then issues the backend's own
 * JWT + a server-side session row. The frontend never sees which path was used
 * beyond the `auth_source` flag.
 */
final class AuthService
{
    public function __construct(
        private UserRepository $users = new UserRepository(),
        private SessionRepository $sessions = new SessionRepository(),
    ) {
    }

    /**
     * @return array{ok:true,token:string,cookie:array,user:array}|array{ok:false,error:string}
     */
    public function login(string $identifier, string $password): array
    {
        $identifier = trim($identifier);
        if ($identifier === '' || $password === '') {
            return ['ok' => false, 'error' => 'INVALID_CREDENTIALS'];
        }

        $isInternal = $this->isInternalIdentifier($identifier);

        if ($isInternal) {
            $resolved = $this->loginInternal($identifier, $password);
        } else {
            $resolved = $this->loginExternal($identifier, $password);
        }

        if ($resolved === null) {
            // Uniform error: never disclose which path or which field failed.
            return ['ok' => false, 'error' => 'INVALID_CREDENTIALS'];
        }

        [$userId, $authSource] = $resolved;

        $this->users->touchLastLogin($userId);
        $roles = $this->users->getRoles($userId);
        $user  = $this->users->findById($userId);

        // Issue JWT + session.
        $jwtCfg = Config::get('jwt');
        $now    = time();
        $exp    = $now + (int) $jwtCfg['ttl_seconds'];
        $jti    = Uuid::v4();

        $this->sessions->create($jti, $userId, $exp);

        $token = Jwt::sign([
            'iss'   => $jwtCfg['issuer'],
            'sub'   => $userId,
            'jti'   => $jti,
            'src'   => $authSource,
            'roles' => $roles,
            'iat'   => $now,
            'exp'   => $exp,
        ], (string) $jwtCfg['secret']);

        return [
            'ok'     => true,
            'token'  => $token,
            'cookie' => $this->cookieParams($token, $exp),
            'user'   => [
                'id'           => $userId,
                'email'        => $user['email'] ?? $identifier,
                'display_name' => $user['display_name'] ?? '',
                'auth_source'  => $authSource,
                'roles'        => $roles,
            ],
        ];
    }

    public function logout(string $jti): void
    {
        if ($jti !== '') {
            $this->sessions->delete($jti);
        }
    }

    private function isInternalIdentifier(string $identifier): bool
    {
        $auth = Config::get('auth');
        $domains = array_map('strtolower', $auth['internal_email_domains'] ?? []);
        $at = strrpos($identifier, '@');
        if ($at === false) {
            return false; // no domain -> treat as external/local
        }
        $domain = strtolower(substr($identifier, $at + 1));
        return in_array($domain, $domains, true);
    }

    /** @return array{0:string,1:string}|null [userId, authSource] */
    private function loginInternal(string $identifier, string $password): ?array
    {
        $ldapCfg = Config::get('ldap');
        if (empty($ldapCfg['enabled'])) {
            return null; // internal login attempted but LDAP not configured
        }
        $profile = (new LdapAuth($ldapCfg))->authenticate($identifier, $password);
        if ($profile === null) {
            return null;
        }
        $userId = $this->users->upsertAdUser($profile['email'], $profile['display_name']);

        // Sync AD groups -> app roles on every login.
        $auth = Config::get('auth');
        $roles = RoleMapper::map($profile['groups'], Config::get('role_map'), $auth['default_internal_role'] ?? null);
        $this->users->syncRoles($userId, $roles);

        return [$userId, 'ad'];
    }

    /** @return array{0:string,1:string}|null [userId, authSource] */
    private function loginExternal(string $identifier, string $password): ?array
    {
        $user = $this->users->findByEmail($identifier);
        if ($user === null || ($user['auth_source'] ?? 'local') !== 'local') {
            return null;
        }
        if (($user['status'] ?? '') !== 'active') {
            return null; // pending_verification / disabled cannot log in
        }
        $hash = $user['password_hash'] ?? null;
        if (!is_string($hash) || $hash === '' || !password_verify($password, $hash)) {
            return null;
        }
        return [(string) $user['id'], 'local'];
    }

    /** @return array<string,mixed> cookie params for the session token */
    private function cookieParams(string $token, int $exp): array
    {
        $jwtCfg = Config::get('jwt');
        return [
            'name'     => (string) $jwtCfg['cookie_name'],
            'value'    => $token,
            'expires'  => $exp,
            'path'     => '/',
            'secure'   => (bool) $jwtCfg['cookie_secure'],
            'httponly' => true,
            'samesite' => (string) $jwtCfg['cookie_samesite'],
        ];
    }
}
