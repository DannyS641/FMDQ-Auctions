<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Maps Active Directory group DNs (from the user's memberOf) to application
 * roles, using the case-insensitive role_map in config. Returns the UNION of
 * matched roles, optionally plus a default role for any authenticated internal
 * user. Output roles are guaranteed to be among the known app roles.
 */
final class RoleMapper
{
    private const KNOWN_ROLES = ['Admin', 'Bidder', 'Observer'];

    /**
     * @param string[]            $groupDns  AD group DNs from memberOf
     * @param array<string,string> $roleMap  DN => role name (from config)
     * @return string[]  distinct app role names
     */
    public static function map(array $groupDns, array $roleMap, ?string $defaultRole): array
    {
        // Lower-case the configured map keys once for case-insensitive matching.
        $normalizedMap = [];
        foreach ($roleMap as $dn => $role) {
            $normalizedMap[strtolower(trim((string) $dn))] = $role;
        }

        $roles = [];
        foreach ($groupDns as $dn) {
            $key = strtolower(trim((string) $dn));
            if (isset($normalizedMap[$key])) {
                $roles[$normalizedMap[$key]] = true;
            }
        }

        if ($defaultRole !== null && $defaultRole !== '') {
            $roles[$defaultRole] = true;
        }

        // Keep only roles the app actually knows about.
        $result = array_values(array_filter(
            array_keys($roles),
            static fn (string $r): bool => in_array($r, self::KNOWN_ROLES, true)
        ));

        return $result;
    }
}
