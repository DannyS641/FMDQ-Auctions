<?php
declare(strict_types=1);

namespace App\Support;

/**
 * One stable request id per PHP request, used for audit/security correlation.
 */
final class RequestId
{
    private static ?string $id = null;

    public static function get(): string
    {
        if (self::$id === null) {
            $header = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
            self::$id = is_string($header) && $header !== '' ? substr($header, 0, 64) : Uuid::v4();
        }
        return self::$id;
    }
}
