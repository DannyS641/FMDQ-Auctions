<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;
use App\Support\Uuid;
use PDO;

final class UserRepository
{
    /** @return array<string,mixed>|null */
    public function findByEmail(string $email): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<string,mixed>|null */
    public function findById(string $id): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Provision (insert or update) an internal AD user on login. AD is the
     * source of truth for email/display name; password_hash stays NULL.
     * Returns the user id.
     */
    public function upsertAdUser(string $email, string $displayName): string
    {
        $pdo = Database::pdo();
        $existing = $this->findByEmail($email);
        if ($existing !== null) {
            $stmt = $pdo->prepare(
                'UPDATE users SET display_name = :dn, auth_source = :src, status = :status WHERE id = :id'
            );
            $stmt->execute([
                ':dn'     => $displayName,
                ':src'    => 'ad',
                ':status' => 'active',
                ':id'     => $existing['id'],
            ]);
            return (string) $existing['id'];
        }
        $id = Uuid::v4();
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, email, password_hash, display_name, status, auth_source)
             VALUES (:id, :email, NULL, :dn, :status, :src)'
        );
        $stmt->execute([
            ':id'     => $id,
            ':email'  => $email,
            ':dn'     => $displayName,
            ':status' => 'active',
            ':src'    => 'ad',
        ]);
        return $id;
    }

    /** Create a local (external) account in pending_verification. Returns the id. */
    public function createLocalPending(string $email, string $passwordHash, string $displayName): string
    {
        $id = Uuid::v4();
        Database::pdo()->prepare(
            'INSERT INTO users (id, email, password_hash, display_name, status, auth_source)
             VALUES (:id, :email, :hash, :dn, :status, :src)'
        )->execute([
            ':id' => $id,
            ':email' => $email,
            ':hash' => $passwordHash,
            ':dn' => $displayName,
            ':status' => 'pending_verification',
            ':src' => 'local',
        ]);
        return $id;
    }

    public function setStatus(string $userId, string $status): void
    {
        Database::pdo()->prepare('UPDATE users SET status = :s WHERE id = :id')
            ->execute([':s' => $status, ':id' => $userId]);
    }

    public function setPasswordHash(string $userId, string $passwordHash): void
    {
        Database::pdo()->prepare('UPDATE users SET password_hash = :h WHERE id = :id')
            ->execute([':h' => $passwordHash, ':id' => $userId]);
    }

    public function assignRole(string $userId, string $roleName): void
    {
        Database::pdo()->prepare('INSERT IGNORE INTO user_roles (user_id, role_name) VALUES (:uid, :role)')
            ->execute([':uid' => $userId, ':role' => $roleName]);
    }

    /** @return string[] */
    public function getRoles(string $userId): array
    {
        $stmt = Database::pdo()->prepare('SELECT role_name FROM user_roles WHERE user_id = :uid');
        $stmt->execute([':uid' => $userId]);
        return array_map(static fn ($r) => (string) $r['role_name'], $stmt->fetchAll());
    }

    /**
     * Replace a user's roles with exactly $roles (used to sync AD groups -> roles
     * on every internal login). Roles must already exist in the roles table.
     * @param string[] $roles
     */
    public function syncRoles(string $userId, array $roles): void
    {
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            $del = $pdo->prepare('DELETE FROM user_roles WHERE user_id = :uid');
            $del->execute([':uid' => $userId]);
            $ins = $pdo->prepare(
                'INSERT INTO user_roles (user_id, role_name) VALUES (:uid, :role)'
            );
            foreach (array_unique($roles) as $role) {
                $ins->execute([':uid' => $userId, ':role' => $role]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    public function touchLastLogin(string $userId): void
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE users SET last_login_at = CURRENT_TIMESTAMP(6) WHERE id = :id'
        );
        $stmt->execute([':id' => $userId]);
    }
}
