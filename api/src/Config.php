<?php
declare(strict_types=1);

namespace App;

/**
 * Loads configuration from config/auth.php, which lives OUTSIDE the web root
 * (project-root/config), so secrets are never web-accessible.
 */
final class Config
{
    private static ?array $data = null;

    public static function load(): array
    {
        if (self::$data !== null) {
            return self::$data;
        }
        // api/src/Config.php -> project root is two levels up from api/src.
        // FMDQ_CONFIG_FILE lets you point at a per-environment config (e.g. tests).
        $root = dirname(__DIR__, 2);
        $override = getenv('FMDQ_CONFIG_FILE');
        $file = ($override !== false && $override !== '') ? $override : $root . '/config/auth.php';
        if (!is_file($file)) {
            throw new \RuntimeException(
                'Missing config/auth.php. Copy config/auth.example.php to config/auth.php and fill it in.'
            );
        }
        $data = require $file;
        if (!is_array($data)) {
            throw new \RuntimeException('config/auth.php must return an array.');
        }
        return self::$data = $data;
    }

    public static function get(string $section): array
    {
        $cfg = self::load();
        if (!isset($cfg[$section]) || !is_array($cfg[$section])) {
            throw new \RuntimeException("Missing config section: {$section}");
        }
        return $cfg[$section];
    }
}
