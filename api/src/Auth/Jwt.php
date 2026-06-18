<?php
declare(strict_types=1);

namespace App\Auth;

/**
 * Minimal HS256 JWT (sign + verify) with no external dependency.
 * The backend issues its OWN tokens here regardless of which auth path
 * (LDAP or local) the user came through.
 */
final class Jwt
{
    /** @param array<string,mixed> $claims */
    public static function sign(array $claims, string $secret): string
    {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $segments = [
            self::b64UrlEncode(self::json($header)),
            self::b64UrlEncode(self::json($claims)),
        ];
        $signingInput = implode('.', $segments);
        $signature = hash_hmac('sha256', $signingInput, $secret, true);
        $segments[] = self::b64UrlEncode($signature);
        return implode('.', $segments);
    }

    /**
     * Verify signature + exp. Returns the claims array, or null if invalid/expired.
     * @return array<string,mixed>|null
     */
    public static function verify(string $token, string $secret): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$h, $p, $s] = $parts;

        $expected = hash_hmac('sha256', $h . '.' . $p, $secret, true);
        $provided = self::b64UrlDecode($s);
        if ($provided === null || !hash_equals($expected, $provided)) {
            return null; // bad signature
        }

        $headerJson = self::b64UrlDecode($h);
        $header = $headerJson !== null ? json_decode($headerJson, true) : null;
        if (!is_array($header) || ($header['alg'] ?? null) !== 'HS256') {
            return null; // wrong/forged algorithm
        }

        $payloadJson = self::b64UrlDecode($p);
        $claims = $payloadJson !== null ? json_decode($payloadJson, true) : null;
        if (!is_array($claims)) {
            return null;
        }
        if (isset($claims['exp']) && time() >= (int) $claims['exp']) {
            return null; // expired
        }
        return $claims;
    }

    private static function json(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function b64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64UrlDecode(string $data): ?string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        $decoded = base64_decode(strtr($data, '-_', '+/'), true);
        return $decoded === false ? null : $decoded;
    }
}
