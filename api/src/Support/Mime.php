<?php
declare(strict_types=1);

namespace App\Support;

final class Mime
{
    private const MAP = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
        'gif' => 'image/gif', 'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    public static function forFile(string $name, string $fallback = 'application/octet-stream'): string
    {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        return self::MAP[$ext] ?? $fallback;
    }

    /** Reduce a path to a safe stored filename (UUID-style names only). */
    public static function safeStoredName(string $name): ?string
    {
        $base = basename($name);
        return preg_match('/^[A-Za-z0-9._-]+$/', $base) === 1 ? $base : null;
    }
}
