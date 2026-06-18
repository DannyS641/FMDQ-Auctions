<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Port of shared/permissions.ts. The DB stores roles Admin | Bidder | Observer;
 * the app exposes a normalized hierarchy where Observer is displayed as
 * "ShopOwner", and an optional "SuperAdmin" role outranks Admin.
 */
final class Permissions
{
    public const GUEST      = 'Guest';
    public const BIDDER     = 'Bidder';
    public const SHOP_OWNER = 'ShopOwner';
    public const ADMIN      = 'Admin';
    public const SUPER_ADMIN = 'SuperAdmin';

    public static function normalizeDisplayRoleName(string $role): string
    {
        return $role === 'Observer' ? 'ShopOwner' : $role;
    }

    /** @param string[] $roles */
    public static function normalizeRole(array $roles): string
    {
        $normalized = array_map([self::class, 'normalizeDisplayRoleName'], $roles);
        if (in_array('SuperAdmin', $normalized, true)) return self::SUPER_ADMIN;
        if (in_array('Admin', $normalized, true))      return self::ADMIN;
        if (in_array('ShopOwner', $normalized, true))  return self::SHOP_OWNER;
        if (in_array('Bidder', $normalized, true))     return self::BIDDER;
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
}
