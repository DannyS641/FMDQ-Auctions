<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Port of server-types.ts AuthContext. Immutable per-request principal derived
 * from the session (or anonymous). Carries the normalized role plus the booleans
 * the read/sanitization layer needs.
 */
final class AuthContext
{
    /** @param string[] $roles raw DB role names (Admin|Bidder|ShopOwner|...) */
    public function __construct(
        public readonly ?string $userId,
        public readonly string $role,        // normalized: Guest|Bidder|ShopOwner|Admin|SuperAdmin
        public readonly bool $signedIn,
        public readonly bool $adminAuthorized,
        public readonly string $actor,
        public readonly string $actorType,   // system|user|integration
        public readonly array $roles = [],
    ) {
    }

    public static function guest(): self
    {
        return new self(null, Permissions::GUEST, false, false, 'Guest', 'system', []);
    }

    /** The dev-only ADMIN API token principal (integration), port of the x-admin-token context. */
    public static function adminToken(): self
    {
        return new self('admin-token', Permissions::ADMIN, true, true, 'Admin API token', 'integration', ['Admin']);
    }

    /**
     * @param array<string,mixed> $user  users row
     * @param string[]            $roles raw DB role names
     */
    public static function fromUser(array $user, array $roles): self
    {
        $role = Permissions::normalizeRole($roles);
        return new self(
            userId: (string) $user['id'],
            role: $role,
            signedIn: true,
            adminAuthorized: Permissions::isAdmin($role),
            actor: (string) ($user['display_name'] ?? $user['email'] ?? 'user'), // audits key on display name
            actorType: 'user',
            roles: $roles,
        );
    }
}
