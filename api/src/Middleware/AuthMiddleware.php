<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Auth\AuthContext;
use App\Auth\Jwt;
use App\Config;
use App\Repository\SessionRepository;
use App\Repository\UserRepository;

/**
 * Resolves the current authenticated principal from the session cookie (or
 * Authorization: Bearer header). Verifies the JWT signature/exp AND that the
 * session row still exists (so logout/revocation is honoured).
 *
 * Returns null when there is no valid session — callers decide whether that
 * is a 401 (protected route) or just anonymous (public route).
 */
final class AuthMiddleware
{
    public function __construct(
        private SessionRepository $sessions = new SessionRepository(),
        private UserRepository $users = new UserRepository(),
    ) {
    }

    /** @return array{user:array<string,mixed>,roles:string[],jti:string}|null */
    public function authenticate(): ?array
    {
        $token = $this->extractToken();
        if ($token === null) {
            return null;
        }

        $jwtCfg = Config::get('jwt');
        $claims = Jwt::verify($token, (string) $jwtCfg['secret']);
        if ($claims === null) {
            return null; // bad signature or expired
        }

        $jti = (string) ($claims['jti'] ?? '');
        if ($jti === '' || $this->sessions->findActive($jti) === null) {
            return null; // session revoked or expired server-side
        }

        $userId = (string) ($claims['sub'] ?? '');
        $user = $userId !== '' ? $this->users->findById($userId) : null;
        if ($user === null || ($user['status'] ?? '') !== 'active') {
            return null; // user gone or disabled since token was issued
        }

        // Roles come from the DB (authoritative), not the token, so a role change
        // takes effect without re-login.
        $roles = $this->users->getRoles($userId);

        return ['user' => $user, 'roles' => $roles, 'jti' => $jti];
    }

    /**
     * Build the per-request AuthContext (anonymous guest if no valid session).
     */
    public function context(): AuthContext
    {
        // Dev-only ADMIN API token bypass (x-admin-token).
        $adminApi = Config::load()['admin_api'] ?? [];
        if (!empty($adminApi['enabled']) && !empty($adminApi['token'])) {
            $provided = (string) ($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
            if ($provided !== '' && hash_equals((string) $adminApi['token'], $provided)) {
                return AuthContext::adminToken();
            }
        }
        $auth = $this->authenticate();
        if ($auth === null) {
            return AuthContext::guest();
        }
        return AuthContext::fromUser($auth['user'], $auth['roles']);
    }

    private function extractToken(): ?string
    {
        $jwtCfg = Config::get('jwt');
        $cookieName = (string) $jwtCfg['cookie_name'];
        if (!empty($_COOKIE[$cookieName])) {
            return (string) $_COOKIE[$cookieName];
        }
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (is_string($auth) && stripos($auth, 'Bearer ') === 0) {
            return trim(substr($auth, 7));
        }
        return null;
    }
}
