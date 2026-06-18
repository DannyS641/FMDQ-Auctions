<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;

final class RoleRepository
{
    /** @return string[] role names */
    public function all(): array
    {
        $rows = Database::pdo()->query('SELECT name FROM roles ORDER BY name ASC')->fetchAll();
        return array_map(static fn ($r) => (string) $r['name'], $rows);
    }

    public function exists(string $name): bool
    {
        $stmt = Database::pdo()->prepare('SELECT 1 FROM roles WHERE name = :n LIMIT 1');
        $stmt->execute([':n' => $name]);
        return $stmt->fetch() !== false;
    }
}
