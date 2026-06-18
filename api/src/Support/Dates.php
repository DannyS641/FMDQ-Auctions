<?php
declare(strict_types=1);

namespace App\Support;

final class Dates
{
    /** UTC "now" as a MySQL DATETIME(6) literal. */
    public static function nowUtc(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
    }

    /** A DB datetime string -> ISO-8601 UTC with milliseconds (null-safe). */
    public static function iso(?string $dbDateTime): ?string
    {
        if ($dbDateTime === null || $dbDateTime === '') return null;
        return (new \DateTimeImmutable($dbDateTime, new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }
}
