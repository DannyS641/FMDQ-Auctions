<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;

/**
 * Server-side session records. The JWT carries a `jti` that maps to a row here,
 * giving us stateless verification PLUS server-side revocation (logout, admin
 * kill-session, expiry sweep).
 */
final class SessionRepository
{
    public function create(string $id, string $userId, int $expiresAtUnix): void
    {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO sessions (id, user_id, expires_at)
             VALUES (:id, :uid, :exp)'
        );
        $stmt->execute([
            ':id'  => $id,
            ':uid' => $userId,
            ':exp' => gmdate('Y-m-d H:i:s', $expiresAtUnix),
        ]);
    }

    /** @return array<string,mixed>|null active (non-expired) session row */
    public function findActive(string $id): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT * FROM sessions WHERE id = :id AND expires_at > UTC_TIMESTAMP(6) LIMIT 1'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function delete(string $id): void
    {
        $stmt = Database::pdo()->prepare('DELETE FROM sessions WHERE id = :id');
        $stmt->execute([':id' => $id]);
    }

    public function deleteAllForUser(string $userId): void
    {
        $stmt = Database::pdo()->prepare('DELETE FROM sessions WHERE user_id = :uid');
        $stmt->execute([':uid' => $userId]);
    }

    public function pruneExpired(): void
    {
        Database::pdo()->exec('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(6)');
    }
}
