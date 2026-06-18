<?php
declare(strict_types=1);

namespace App\Auth;

use App\Config;

/**
 * Port of buildSignedToken / parseSignedToken (index.ts): a stateless
 * HMAC-signed "body.signature" token. Used for password-reset links.
 * (Distinct from the 3-part session JWT in Jwt.php.)
 */
final class SignedToken
{
    /** @param array<string,mixed> $payload */
    public static function sign(array $payload): string
    {
        $body = self::b64UrlEncode(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        return $body . '.' . self::signValue($body);
    }

    /** @return array<string,mixed>|null */
    public static function parse(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }
        [$body, $signature] = $parts;
        if (!hash_equals(self::signValue($body), $signature)) {
            return null;
        }
        $json = self::b64UrlDecode($body);
        if ($json === null) return null;
        $data = json_decode($json, true);
        return is_array($data) ? $data : null;
    }

    private static function signValue(string $value): string
    {
        $secret = (string) Config::get('jwt')['secret'];
        return self::b64UrlEncode(hash_hmac('sha256', $value, $secret, true));
    }

    private static function b64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64UrlDecode(string $data): ?string
    {
        $pad = strlen($data) % 4;
        if ($pad) {
            $data .= str_repeat('=', 4 - $pad);
        }
        $decoded = base64_decode(strtr($data, '-_', '+/'), true);
        return $decoded === false ? null : $decoded;
    }
}
