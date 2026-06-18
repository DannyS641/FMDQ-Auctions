<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;
use App\Support\Dates;
use App\Support\Uuid;

final class EmailVerificationRepository
{
    /** Create a fresh token for the user (replacing any existing one). */
    public function create(string $userId, int $ttlSeconds): string
    {
        $pdo = Database::pdo();
        $this->deleteForUser($userId);
        $token = bin2hex(random_bytes(32));
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $pdo->prepare(
            'INSERT INTO email_verification_tokens (id, user_id, token, created_at, expires_at)
             VALUES (:id, :uid, :token, :created, :expires)'
        )->execute([
            ':id' => Uuid::v4(),
            ':uid' => $userId,
            ':token' => $token,
            ':created' => $now->format('Y-m-d H:i:s.u'),
            ':expires' => $now->modify("+{$ttlSeconds} seconds")->format('Y-m-d H:i:s.u'),
        ]);
        return $token;
    }

    /** @return array<string,mixed>|null */
    public function findByToken(string $token): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM email_verification_tokens WHERE token = :t LIMIT 1');
        $stmt->execute([':t' => $token]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function deleteByToken(string $token): void
    {
        Database::pdo()->prepare('DELETE FROM email_verification_tokens WHERE token = :t')->execute([':t' => $token]);
    }

    public function deleteForUser(string $userId): void
    {
        Database::pdo()->prepare('DELETE FROM email_verification_tokens WHERE user_id = :uid')->execute([':uid' => $userId]);
    }
}
