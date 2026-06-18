<?php
declare(strict_types=1);

namespace App\Admin;

use App\Audit\AuditService;
use App\Auth\AccountService;
use App\Auth\AuthContext;
use App\Auth\Credentials;
use App\Auth\Permissions;
use App\Repository\RoleRepository;
use App\Repository\SessionRepository;
use App\Repository\UserRepository;
use App\Support\ImportCsv;

/**
 * Admin user-management mutations (port of the /api/admin/users/* routes).
 * Each returns {status, body}. Role-management hierarchy is enforced by
 * Permissions::ensureCanManageTarget.
 */
final class AdminUserService
{
    public function __construct(
        private UserRepository $users = new UserRepository(),
        private RoleRepository $roles = new RoleRepository(),
        private SessionRepository $sessions = new SessionRepository(),
        private AuditService $audit = new AuditService(),
        private AccountService $accounts = new AccountService(),
    ) {
    }

    public function assignRole(AuthContext $ctx, string $userId, string $roleName): array
    {
        $userId = trim($userId);
        $roleName = trim($roleName);
        if ($userId === '' || $roleName === '') {
            return $this->err(400, 'User ID and role name are required.');
        }
        if (!$this->roles->exists($roleName)) {
            return $this->err(400, 'That role does not exist.');
        }
        $user = $this->users->findById($userId);
        if ($user === null) {
            return $this->err(404, 'User not found.');
        }
        $this->users->assignRole($userId, $roleName);
        $this->audit->append($ctx, 'USER_ROLE_ASSIGNED', 'user', $userId, ['email' => $user['email'], 'role' => $roleName]);
        return $this->ok(['updated' => true, 'message' => "{$roleName} assigned to {$user['display_name']}."]);
    }

    public function removeRole(AuthContext $ctx, string $userId, string $roleName): array
    {
        $userId = trim($userId);
        $roleName = trim($roleName);
        if ($userId === '' || $roleName === '') {
            return $this->err(400, 'User ID and role name are required.');
        }
        $user = $this->users->findById($userId);
        if ($user === null) {
            return $this->err(404, 'User not found.');
        }
        if (count($this->users->getRoles($userId)) <= 1) {
            return $this->err(400, 'Every user must retain at least one role.');
        }
        $this->users->removeRole($userId, $roleName);
        $this->audit->append($ctx, 'USER_ROLE_REMOVED', 'user', $userId, ['email' => $user['email'], 'role' => $roleName]);
        return $this->ok(['updated' => true, 'message' => "{$roleName} removed from {$user['display_name']}."]);
    }

    public function disableUser(AuthContext $ctx, string $userId, string $reason): array
    {
        $userId = trim($userId);
        if ($userId === '') {
            return $this->err(400, 'User ID is required.');
        }
        if ($ctx->userId !== null && $ctx->userId === $userId) {
            return $this->err(400, 'You cannot disable your own account.');
        }
        $user = $this->users->findById($userId);
        if ($user === null) {
            return $this->err(404, 'User not found.');
        }
        $guard = Permissions::ensureCanManageTarget($ctx->role, $this->users->getRoles($userId));
        if ($guard['ok'] === false) {
            return $this->err(403, $guard['error']);
        }
        if (($user['status'] ?? '') === 'disabled') {
            return $this->ok(['updated' => true, 'message' => "{$user['display_name']} is already disabled."]);
        }
        $this->users->setStatus($userId, 'disabled');
        $this->sessions->deleteAllForUser($userId);
        $cleanReason = Credentials::sanitizeDisplayName($reason) ?: 'No reason provided';
        $this->audit->append($ctx, 'USER_DISABLED', 'user', $userId, [
            'email' => $user['email'], 'target' => $user['display_name'], 'reason' => $cleanReason,
        ]);
        return $this->ok(['updated' => true, 'message' => "{$user['display_name']} has been disabled and signed out everywhere."]);
    }

    public function enableUser(AuthContext $ctx, string $userId): array
    {
        $userId = trim($userId);
        if ($userId === '') {
            return $this->err(400, 'User ID is required.');
        }
        $user = $this->users->findById($userId);
        if ($user === null) {
            return $this->err(404, 'User not found.');
        }
        $guard = Permissions::ensureCanManageTarget($ctx->role, $this->users->getRoles($userId));
        if ($guard['ok'] === false) {
            return $this->err(403, $guard['error']);
        }
        if (($user['status'] ?? '') === 'active') {
            return $this->ok(['updated' => true, 'message' => "{$user['display_name']} is already active."]);
        }
        $this->users->setStatus($userId, 'active');
        $this->audit->append($ctx, 'USER_ENABLED', 'user', $userId, ['email' => $user['email'], 'target' => $user['display_name']]);
        return $this->ok(['updated' => true, 'message' => "{$user['display_name']} has been re-enabled."]);
    }

    public function forcePasswordReset(AuthContext $ctx, string $userId): array
    {
        $user = $this->users->findById(trim($userId));
        if ($user === null || ($user['status'] ?? '') !== 'active') {
            return $this->err(404, 'Active user not found.');
        }
        $guard = Permissions::ensureCanManageTarget($ctx->role, $this->users->getRoles((string) $user['id']));
        if ($guard['ok'] === false) {
            return $this->err(403, $guard['error']);
        }
        $this->accounts->queuePasswordResetFor($user, $ctx->actor);
        $this->audit->append($ctx, 'PASSWORD_RESET_FORCED', 'system', (string) $user['id'], [
            'email' => $user['email'], 'target' => $user['display_name'],
        ]);
        return $this->ok(['queued' => true, 'count' => 1, 'message' => "Password reset sent to {$user['email']}."]);
    }

    /** @param string[] $userIds */
    public function bulkPasswordResets(AuthContext $ctx, string $scope, string $role, array $userIds): array
    {
        $selected = array_filter(array_map('trim', $userIds));
        $active = array_filter($this->users->listAllWithRoles(), static fn ($u) => $u['status'] === 'active');

        $targets = array_filter($active, static function ($u) use ($scope, $role, $selected) {
            if ($scope === 'all') return true;
            if ($scope === 'role') return $role !== '' && in_array($role, $u['roles'], true);
            return in_array((string) $u['id'], $selected, true);
        });
        $targets = array_filter($targets, fn ($u) => Permissions::isSuperAdmin($ctx->role) || !in_array('SuperAdmin', $u['roles'], true));

        if (!$targets) {
            return $this->err(400, 'No users matched the selected bulk reset criteria.');
        }
        foreach ($targets as $t) {
            $full = $this->users->findById((string) $t['id']);
            if ($full !== null) {
                $this->accounts->queuePasswordResetFor($full, $ctx->actor);
            }
        }
        $this->audit->append($ctx, 'PASSWORD_RESET_BULK_FORCED', 'system', $scope === 'role' ? ($role ?: 'bulk') : $scope, [
            'scope' => $scope, 'count' => count($targets), 'role' => $role ?: 'n/a',
        ]);
        return $this->ok(['queued' => true, 'count' => count($targets), 'message' => 'Queued password resets for ' . count($targets) . ' user(s).']);
    }

    public function bulkImportUsers(AuthContext $ctx, string $csvContent): array
    {
        $rows = ImportCsv::parse($csvContent);
        if (!$rows) {
            return $this->err(400, 'The uploaded CSV is empty.');
        }
        $available = $this->roles->all();
        $report = ['created' => 0, 'skipped' => 0, 'failed' => 0, 'items' => []];

        foreach ($rows as $index => $row) {
            $rowNum = $index + 2;
            $email = Credentials::normalizeEmail(ImportCsv::value($row, ['email']));
            $displayName = Credentials::sanitizeDisplayName(ImportCsv::value($row, ['display_name', 'displayName', 'full_name', 'name']));
            $roles = array_values(array_filter(ImportCsv::splitList(ImportCsv::value($row, ['roles', 'role'])), static fn ($r) => in_array($r, $available, true)));
            $statusRaw = trim(ImportCsv::value($row, ['status'])) ?: 'pending_verification';
            $status = in_array($statusRaw, ['active', 'disabled'], true) ? $statusRaw : 'pending_verification';

            if ($email === '' || $displayName === '') {
                $this->reportItem($report, 'failed', $rowNum, $email ?: "row-{$rowNum}", 'Email and display name are required.');
                continue;
            }
            if ($this->users->findByEmail($email) !== null) {
                $this->reportItem($report, 'skipped', $rowNum, $email, 'Skipped because a user with that email already exists.');
                continue;
            }
            $assigned = $roles ?: ['Bidder'];
            $userId = $this->users->createWithStatus($email, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), $displayName, $status);
            foreach ($assigned as $roleName) {
                $this->users->assignRole($userId, $roleName);
            }
            if ($status === 'active') {
                $created = $this->users->findById($userId);
                if ($created !== null) {
                    $this->accounts->queuePasswordResetFor($created, $ctx->actor);
                }
            } else {
                $this->accounts->sendVerification($userId, $email, $displayName);
            }
            $this->reportItem($report, 'created', $rowNum, $email, 'Created with roles: ' . implode(', ', $assigned) . '.');
        }

        $this->audit->append($ctx, 'USER_BULK_IMPORTED', 'system', 'user-bulk-import', [
            'created' => $report['created'], 'skipped' => $report['skipped'], 'failed' => $report['failed'],
        ]);
        return $this->ok($report);
    }

    private function reportItem(array &$report, string $status, int $row, string $email, string $message): void
    {
        $report[$status]++;
        $report['items'][] = ['row' => $row, 'status' => $status, 'email' => $email, 'message' => $message];
    }

    private function ok(array $body): array
    {
        return ['status' => 200, 'body' => $body];
    }

    private function err(int $status, string $message): array
    {
        return ['status' => $status, 'body' => ['error' => $message]];
    }
}
