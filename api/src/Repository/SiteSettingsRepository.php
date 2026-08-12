<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;

/** Generic admin-editable key/value settings (e.g. slideshow timing). */
final class SiteSettingsRepository
{
    public function get(string $key, ?string $default = null): ?string
    {
        $stmt = Database::pdo()->prepare('SELECT value FROM site_settings WHERE `key` = :k');
        $stmt->execute([':k' => $key]);
        $row = $stmt->fetch();
        return $row === false ? $default : (string) $row['value'];
    }

    public function set(string $key, string $value): void
    {
        Database::pdo()->prepare(
            'INSERT INTO site_settings (`key`, value) VALUES (:k, :v)
             ON DUPLICATE KEY UPDATE value = VALUES(value)'
        )->execute([':k' => $key, ':v' => $value]);
    }
}
