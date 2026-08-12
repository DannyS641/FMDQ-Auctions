<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;
use App\Support\Uuid;

/**
 * Admin-managed site imagery. 'landing' is the rotating hero slideshow (many
 * images, orderable). 'auth' is the single static image shown behind the
 * sign-in/sign-up forms — uploading a new one replaces the existing one.
 */
final class SlideRepository
{
    /** @return array<int,array<string,mixed>> ordered by sort_order */
    public function all(string $placement = 'landing'): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT id, url, name, sort_order FROM site_slides WHERE placement = :placement ORDER BY sort_order ASC, created_at ASC'
        );
        $stmt->execute([':placement' => $placement]);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function find(string $id): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT id, url, name, placement, sort_order FROM site_slides WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Insert a new slide. For placement='auth' this first removes any existing
     * auth image (and returns its url so the caller can delete the file too),
     * since the auth slot only ever holds one image.
     * @return array{id:string,replacedUrl:?string}
     */
    public function insert(string $url, string $name, string $placement = 'landing'): array
    {
        $pdo = Database::pdo();
        $replacedUrl = null;

        if ($placement === 'auth') {
            $stmt = $pdo->prepare('SELECT url FROM site_slides WHERE placement = :p');
            $stmt->execute([':p' => 'auth']);
            $existing = $stmt->fetch();
            $replacedUrl = $existing !== false ? (string) $existing['url'] : null;
            $pdo->prepare('DELETE FROM site_slides WHERE placement = :p')->execute([':p' => 'auth']);
            $next = 0;
        } else {
            $stmt = $pdo->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM site_slides WHERE placement = :p');
            $stmt->execute([':p' => $placement]);
            $next = (int) ($stmt->fetch()['n'] ?? 0);
        }

        $id = Uuid::v4();
        $pdo->prepare('INSERT INTO site_slides (id, url, name, placement, sort_order) VALUES (:id, :url, :name, :p, :sort)')
            ->execute([':id' => $id, ':url' => $url, ':name' => $name, ':p' => $placement, ':sort' => $next]);
        return ['id' => $id, 'replacedUrl' => $replacedUrl];
    }

    public function delete(string $id): void
    {
        Database::pdo()->prepare('DELETE FROM site_slides WHERE id = :id')->execute([':id' => $id]);
    }

    /** @param string[] $orderedIds full set of landing slide ids in the desired display order */
    public function reorder(array $orderedIds): void
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('UPDATE site_slides SET sort_order = :sort WHERE id = :id');
        foreach (array_values($orderedIds) as $index => $id) {
            $stmt->execute([':sort' => $index, ':id' => (string) $id]);
        }
    }
}
