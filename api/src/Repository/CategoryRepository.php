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

    public function exists(string $name): bool
    {
        $stmt = Database::pdo()->prepare('SELECT 1 FROM categories WHERE name = :n LIMIT 1');
        $stmt->execute([':n' => $name]);
        return $stmt->fetch() !== false;
    }

    /** Insert the category if absent. Returns true if it was newly created. */
    public function upsert(string $name): bool
    {
        $created = !$this->exists($name);
        Database::pdo()->prepare('INSERT INTO categories (name) VALUES (:n) ON DUPLICATE KEY UPDATE name = name')
            ->execute([':n' => $name]);
        return $created;
    }

    public function isAssignedToItem(string $name): bool
    {
        $stmt = Database::pdo()->prepare('SELECT 1 FROM items WHERE category = :n LIMIT 1');
        $stmt->execute([':n' => $name]);
        return $stmt->fetch() !== false;
    }

    public function delete(string $name): void
    {
        Database::pdo()->prepare('DELETE FROM categories WHERE name = :n')->execute([':n' => $name]);
    }
}
