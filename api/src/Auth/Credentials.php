<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Port of the small credential helpers in index.ts (normalizeEmail,
 * sanitizeDisplayName, isStrongPassword, passwordRuleMessage).
 */
final class Credentials
{
    public const PASSWORD_RULE_MESSAGE =
        'Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.';

    public static function normalizeEmail(string $value): string
    {
        $email = strtolower(trim($value));
        // Reject malformed addresses (also blocks CRLF/header-injection payloads).
        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
    }

    public static function sanitizeDisplayName(string $value): string
    {
        return preg_replace('/\s+/', ' ', trim($value));
    }

    public static function isStrongPassword(string $value): bool
    {
        return strlen($value) >= 8
            && preg_match('/[A-Z]/', $value) === 1
            && preg_match('/[a-z]/', $value) === 1
            && preg_match('/\d/', $value) === 1
            && preg_match('/[^A-Za-z0-9]/', $value) === 1;
    }
}
