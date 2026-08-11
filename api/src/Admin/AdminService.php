<?php
declare(strict_types=1);

namespace App\Admin;

use App\Auth\Permissions;
use App\Catalog\ItemReadModel;
use App\Database;
use App\Repository\UserRepository;
use App\Support\Dates;

/**
 * Port of admin-service.ts + the read-only admin routes (operations, audits,
 * notifications list, reports, users). Sensitive audit/notification fields are
 * redacted before they leave the API.
 */
final class AdminService
{
    private const SECURITY_TELEMETRY = ['AUTH_ATTEMPT', 'BID_ATTEMPT'];
    private const SENSITIVE_AUDIT_KEYS = [
        'sessionId', 'bidId', 'bidderUserId', 'auctionItemId', 'claimToken', 'resetToken', 'csrfToken', 'actorUserId',
    ];

    public function __construct(
        private UserRepository $users = new UserRepository(),
        private ItemReadModel $items = new ItemReadModel(),
    ) {
    }

    /** @return array<int,array<string,mixed>> */
    public function listUsersWithRoles(): array
    {
        return array_map(fn ($u) => [
            'id' => $u['id'],
            'email' => $u['email'],
            'displayName' => $u['display_name'],
            'status' => $u['status'],
            'createdAt' => Dates::iso($u['created_at']),
            'lastLoginAt' => Dates::iso($u['last_login_at']),
            'roles' => $u['roles'],
        ], $this->users->listAllWithRoles());
    }

    /** @return array<string,mixed> operations dashboard payload */
    public function operations(): array
    {
        $pdo = Database::pdo();
        $count = static fn (string $sql) => (int) $pdo->query($sql)->fetch()['c'];
        $now = "UTC_TIMESTAMP(6)";

        $summary = [
            'totalItems'      => $count('SELECT COUNT(*) c FROM items'),
            'liveCount'       => $count("SELECT COUNT(*) c FROM items WHERE archived_at IS NULL AND start_time <= $now AND end_time >= $now"),
            'closedCount'     => $count("SELECT COUNT(*) c FROM items WHERE archived_at IS NULL AND end_time < $now"),
            'archivedCount'   => $count('SELECT COUNT(*) c FROM items WHERE archived_at IS NOT NULL'),
            'pendingNotifications' => $count("SELECT COUNT(*) c FROM notification_queue WHERE status='pending'"),
            'auditCount'      => $count('SELECT COUNT(*) c FROM audits'),
            'wins'            => $count("SELECT COUNT(*) c FROM audits WHERE event_type='BID_PLACED'"),
            'totalUsers'      => $count('SELECT COUNT(*) c FROM users'),
            'activeUsers'     => $count("SELECT COUNT(*) c FROM users WHERE status='active'"),
            'disabledUsers'   => $count("SELECT COUNT(*) c FROM users WHERE status='disabled'"),
            'adminUsers'      => $count("SELECT COUNT(*) c FROM user_roles WHERE role_name='Admin'"),
            'superAdminUsers' => $count("SELECT COUNT(*) c FROM user_roles WHERE role_name='SuperAdmin'"),
        ];
        return [
            'summary' => $summary,
            'metrics' => [
                'totalItems' => $summary['totalItems'], 'liveItems' => $summary['liveCount'],
                'closedItems' => $summary['closedCount'], 'archivedItems' => $summary['archivedCount'],
                'pendingNotifications' => $summary['pendingNotifications'], 'auditEvents' => $summary['auditCount'],
                'wins' => $summary['wins'],
            ],
            'recentAudits' => $this->recentAudits(20),
            'notificationQueue' => $this->notifications(1, 20)['items'],
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function recentAudits(int $limit = 20): array
    {
        $lookup = $this->auditActorRoleLookup();
        $rows = Database::pdo()->query(
            'SELECT id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at
             FROM audits ORDER BY created_at DESC LIMIT ' . ($limit + 100)
        )->fetchAll();
        $filtered = array_filter($rows, static fn ($r) => !in_array($r['event_type'], self::SECURITY_TELEMETRY, true));
        return array_map(fn ($r) => $this->mapAuditRow($r, $lookup), array_slice(array_values($filtered), 0, $limit));
    }

    /**
     * Filtered, paginated audits.
     * @param array<string,string> $f
     * @return array{items:array<int,array<string,mixed>>,total:int,page:int,pageSize:int}
     */
    public function adminAudits(array $f, int $page, int $pageSize): array
    {
        $page = max(1, $page);
        $pageSize = min(100, max(1, $pageSize));
        $offset = ($page - 1) * $pageSize;

        $where = [];
        $params = [];
        if (($f['itemId'] ?? '') !== '') { $where[] = 'entity_id = :eid'; $params[':eid'] = $f['itemId']; }
        if (($f['eventType'] ?? '') !== '') { $where[] = 'event_type = :etype'; $params[':etype'] = $f['eventType']; }
        if (($f['entityType'] ?? '') !== '') { $where[] = 'entity_type = :entype'; $params[':entype'] = $f['entityType']; }
        if (($f['actor'] ?? '') !== '') { $where[] = 'actor LIKE :actor'; $params[':actor'] = '%' . $f['actor'] . '%'; }
        if (($from = self::toDbDate($f['from'] ?? '')) !== null) { $where[] = 'created_at >= :from'; $params[':from'] = $from; }
        if (($to = self::toDbDate($f['to'] ?? '')) !== null) { $where[] = 'created_at <= :to'; $params[':to'] = $to; }
        if (($f['includeSecurity'] ?? '') !== '1') {
            $where[] = "event_type NOT IN ('AUTH_ATTEMPT','BID_ATTEMPT')";
        }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $pdo = Database::pdo();
        $countStmt = $pdo->prepare("SELECT COUNT(*) c FROM audits $whereSql");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetch()['c'];

        $stmt = $pdo->prepare(
            "SELECT id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at
             FROM audits $whereSql ORDER BY created_at DESC LIMIT $pageSize OFFSET $offset"
        );
        $stmt->execute($params);
        $lookup = $this->auditActorRoleLookup();
        $items = array_map(function ($row) use ($lookup) {
            $details = self::parseDetails($row['details_json']);
            $actorRole = (is_string($details['actorRole'] ?? null) ? $details['actorRole'] : null) ?? ($lookup[$row['actor']] ?? null);
            return [
                'id' => $row['id'], 'event_type' => $row['event_type'], 'entity_type' => $row['entity_type'],
                'entity_id' => $row['entity_id'], 'actor' => $row['actor'], 'actor_type' => $row['actor_type'],
                'request_id' => $row['request_id'], 'created_at' => Dates::iso($row['created_at']),
                'details_json' => $this->redact($details), 'actor_role' => $actorRole,
            ];
        }, $stmt->fetchAll());

        return ['items' => $items, 'total' => $total, 'page' => $page, 'pageSize' => $pageSize];
    }

    /** @return array{items:array<int,array<string,mixed>>,total:int,page:int,pageSize:int} */
    public function notifications(int $page, int $pageSize): array
    {
        $page = max(1, $page);
        $pageSize = min(100, max(1, $pageSize));
        $offset = ($page - 1) * $pageSize;
        $pdo = Database::pdo();
        $total = (int) $pdo->query('SELECT COUNT(*) c FROM notification_queue')->fetch()['c'];
        $rows = $pdo->query(
            "SELECT * FROM notification_queue ORDER BY created_at DESC LIMIT $pageSize OFFSET $offset"
        )->fetchAll();
        return ['items' => array_map([$this, 'mapNotificationForAdmin'], $rows), 'total' => $total, 'page' => $page, 'pageSize' => $pageSize];
    }

    /** @return array<int,array<string,string|int>> audit rows formatted for CSV */
    public function auditsCsvRows(): array
    {
        $rows = Database::pdo()->query(
            'SELECT id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at
             FROM audits ORDER BY created_at DESC'
        )->fetchAll();
        return array_map(fn ($row) => [
            'id' => $row['id'], 'eventType' => $row['event_type'], 'entityType' => $row['entity_type'],
            'entityId' => $row['entity_id'], 'actor' => $row['actor'], 'actorType' => $row['actor_type'],
            'requestId' => $row['request_id'],
            'details' => json_encode($this->redact(self::parseDetails($row['details_json'])), JSON_UNESCAPED_SLASHES),
            'createdAt' => (string) Dates::iso($row['created_at']),
        ], $rows);
    }

    /** @return array<string,mixed> winners / won / no-bid / reserve-not-met report */
    public function reports(): array
    {
        $nowMs = (int) (microtime(true) * 1000);
        $items = $this->items->getItems(true);
        $status = static function (array $it) use ($nowMs): string {
            if (!empty($it['archivedAt'])) return 'Archived';
            $start = (int) (new \DateTimeImmutable($it['startTime']))->format('Uv');
            $end = (int) (new \DateTimeImmutable($it['endTime']))->format('Uv');
            if ($start > $nowMs) return 'Upcoming';
            if ($end < $nowMs) return 'Closed';
            return 'Live';
        };
        $closed = array_filter($items, static fn ($it) => $status($it) === 'Closed');

        $wonItems = [];
        foreach ($closed as $item) {
            if ($item['currentBid'] <= 0) continue;
            $winningBidder = null;
            foreach ($item['bids'] as $bid) {
                if ($bid['amount'] === $item['currentBid']) { $winningBidder = $bid['bidder']; break; }
            }
            if ($winningBidder === null) continue;
            $reserveOutcome = $this->items->reserveState($item);
            if ($reserveOutcome === 'reserve_not_met') continue;
            $wonItems[] = [
                'itemId' => $item['id'], 'title' => $item['title'], 'lot' => $item['lot'], 'category' => $item['category'],
                'winner' => $winningBidder, 'winningBid' => $item['currentBid'], 'endTime' => $item['endTime'], 'reserveOutcome' => $reserveOutcome,
            ];
        }
        $winnersMap = [];
        foreach ($wonItems as $w) {
            $cur = $winnersMap[$w['winner']] ?? ['bidder' => $w['winner'], 'itemsWon' => 0, 'totalWonAmount' => 0, 'itemTitles' => []];
            $cur['itemsWon']++; $cur['totalWonAmount'] += $w['winningBid']; $cur['itemTitles'][] = $w['title'];
            $winnersMap[$w['winner']] = $cur;
        }
        $winners = array_values($winnersMap);
        usort($winners, static fn ($a, $b) => $b['totalWonAmount'] <=> $a['totalWonAmount']);

        $noBidItems = array_map(static fn ($it) => [
            'itemId' => $it['id'], 'title' => $it['title'], 'lot' => $it['lot'], 'category' => $it['category'],
            'status' => $status($it), 'endTime' => $it['endTime'], 'archived' => !empty($it['archivedAt']),
        ], array_values(array_filter($items, static fn ($it) => count($it['bids']) === 0 && $it['currentBid'] <= 0)));

        $reserveNotMet = array_map(static fn ($it) => [
            'itemId' => $it['id'], 'title' => $it['title'], 'lot' => $it['lot'], 'category' => $it['category'],
            'currentBid' => $it['currentBid'], 'endTime' => $it['endTime'],
        ], array_values(array_filter($closed, fn ($it) => $it['currentBid'] > 0 && $this->items->reserveState($it) === 'reserve_not_met')));

        return [
            'summary' => ['winners' => count($winners), 'wonItems' => count($wonItems), 'noBidItems' => count($noBidItems), 'reserveNotMetItems' => count($reserveNotMet)],
            'winners' => $winners, 'wonItems' => $wonItems, 'noBidItems' => $noBidItems, 'reserveNotMetItems' => $reserveNotMet,
        ];
    }

    // --- helpers --------------------------------------------------------------

    /** @return array<string,?string> displayName => normalized role (null if ambiguous) */
    private function auditActorRoleLookup(): array
    {
        $lookup = [];
        foreach ($this->users->listAllWithRoles() as $u) {
            $name = (string) $u['display_name'];
            $role = Permissions::normalizeRole($u['roles']);
            if (!array_key_exists($name, $lookup)) {
                $lookup[$name] = $role;
            } elseif ($lookup[$name] !== $role) {
                $lookup[$name] = null;
            }
        }
        return $lookup;
    }

    /** @param array<string,mixed> $row @param array<string,?string> $lookup */
    private function mapAuditRow(array $row, array $lookup): array
    {
        return [
            'id' => $row['id'], 'eventType' => $row['event_type'], 'entityType' => $row['entity_type'],
            'entityId' => $row['entity_id'], 'actor' => $row['actor'], 'actorType' => $row['actor_type'],
            'actorRole' => $lookup[$row['actor']] ?? null, 'requestId' => $row['request_id'],
            'details' => json_encode($this->redact(self::parseDetails($row['details_json'])), JSON_UNESCAPED_SLASHES),
            'createdAt' => Dates::iso($row['created_at']),
        ];
    }

    /** @param array<string,mixed> $row */
    private function mapNotificationForAdmin(array $row): array
    {
        return [
            'id' => $row['id'], 'channel' => $row['channel'], 'eventType' => $row['event_type'],
            'recipient' => $row['recipient'], 'subject' => $row['subject'], 'status' => $row['status'],
            'payload' => $this->sanitizeNotificationPayload(self::parseDetails($row['payload_json'])),
            'createdAt' => Dates::iso($row['created_at']), 'processedAt' => Dates::iso($row['processed_at']),
            'nextAttemptAt' => Dates::iso($row['next_attempt_at']), 'attemptCount' => (int) $row['attempt_count'],
            'claimToken' => null, 'claimExpiresAt' => null, 'errorMessage' => $row['error_message'],
        ];
    }

    /** @param array<string,mixed> $details */
    private function redact(array $details): array
    {
        foreach (self::SENSITIVE_AUDIT_KEYS as $key) {
            unset($details[$key]);
        }
        return $details;
    }

    /** @param array<string,mixed> $payload */
    private function sanitizeNotificationPayload(array $payload): array
    {
        $out = [];
        foreach ($payload as $key => $value) {
            if (preg_match('/token/i', $key) || preg_match('/reseturl/i', $key) || preg_match('/verifyurl/i', $key) || preg_match('/itemurl/i', $key)) {
                continue;
            }
            if ($key === '_meta' && is_array($value)) {
                $out[$key] = ['attempts' => $value['attempts'] ?? null, 'lastError' => $value['lastError'] ?? null];
                continue;
            }
            $out[$key] = $value;
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private static function parseDetails(mixed $value): array
    {
        if (is_array($value)) return $value;
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? $decoded : [];
        }
        return [];
    }

    private static function toDbDate(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') return null;
        try {
            return (new \DateTimeImmutable($value, new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
        } catch (\Throwable) {
            return null;
        }
    }
}
