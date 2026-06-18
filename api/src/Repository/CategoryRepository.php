<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;

final class CategoryRepository
{
    /** @return string[] category names, alphabetical */
    public function all(): array
    {
        $rows = Database::pdo()->query('SELECT name FROM categories ORDER BY name ASC')->fetchAll();
        return array_map(static fn ($r) => (string) $r['name'], $rows);
    }
}
