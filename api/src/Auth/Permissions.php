<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Port of shared/permissions.ts. The DB stores roles Admin | Bidder | ShopOwner;
 * an optional "SuperAdmin" role outranks Admin.
 */
final class Permissions
{
    public const GUEST      = 'Guest';
    public const BIDDER     = 'Bidder';
    public const SHOP_OWNER = 'ShopOwner';
    public const ADMIN      = 'Admin';
    public const SUPER_ADMIN = 'SuperAdmin';

    /** @param string[] $roles */
    public static function normalizeRole(array $roles): string
    {
        if (in_array('SuperAdmin', $roles, true)) return self::SUPER_ADMIN;
        if (in_array('Admin', $roles, true))      return self::ADMIN;
        if (in_array('ShopOwner', $roles, true))  return self::SHOP_OWNER;
        if (in_array('Bidder', $roles, true))     return self::BIDDER;
        return self::GUEST;
    }

    public static function isSuperAdmin(string $role): bool
    {
        return $role === self::SUPER_ADMIN;
    }

    public static function isAdmin(string $role): bool
    {
        return $role === self::ADMIN || $role === self::SUPER_ADMIN;
    }

    public static function canBid(string $role): bool
    {
        return $role === self::BIDDER || $role === self::ADMIN;
    }

    public static function canViewReserve(string $role): bool
    {
        return self::isAdmin($role);
    }

    public static function canViewItemOperations(string $role): bool
    {
        return $role === self::SHOP_OWNER || self::isAdmin($role);
    }

    public static function canAccessOperations(string $role): bool
    {
        return self::isAdmin($role);
    }

    /**
     * Port of ensureCanManageTargetRoles (security-logic.ts): can an actor with
     * $actorRole manage a user holding $targetRoles (raw DB role names)?
     * @param string[] $targetRoles
     * @return array{ok:true}|array{ok:false,error:string}
     */
    public static function ensureCanManageTarget(string $actorRole, array $targetRoles): array
    {
        if ($actorRole !== self::ADMIN && $actorRole !== self::SUPER_ADMIN) {
            return ['ok' => false, 'error' => 'Only admin accounts can manage other users.'];
        }
        if (in_array('SuperAdmin', $targetRoles, true) && $actorRole !== self::SUPER_ADMIN) {
            return ['ok' => false, 'error' => 'Only a SuperAdmin can manage another SuperAdmin account.'];
        }
        if (in_array('Admin', $targetRoles, true) && $actorRole !== self::SUPER_ADMIN) {
            return ['ok' => false, 'error' => 'Only a SuperAdmin can manage another Admin account.'];
        }
        return ['ok' => true];
    }
}
