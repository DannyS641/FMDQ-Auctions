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
    /** @param string[] $roles raw DB role names (Admin|Bidder|Observer|...) */
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
            adminAuthorized: Permissions::isAdmin($role), // admin-token bypass added in 3d
            actor: (string) ($user['email'] ?? $user['display_name'] ?? 'user'),
            actorType: 'user',
            roles: $roles,
        );
    }
}
