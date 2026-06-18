<?php
declare(strict_types=1);

namespace App\Bidding;

use App\Catalog\ItemReadModel;
use App\Config;
use App\Database;
use App\Notifications\NotificationQueue;
use App\Repository\UserRepository;
use App\Support\Dates;
use App\Support\Uuid;
use PDO;

/**
 * Port of bid-service.ts. The atomic placement is the PHP transaction that
 * replaces the Postgres place_auction_bid() RPC: it locks the item row
 * (SELECT ... FOR UPDATE), re-validates state under the lock, inserts the bid,
 * bumps the item, and records the idempotency key — all or nothing.
 */
final class BidService
{
    public function __construct(
        private ItemReadModel $items = new ItemReadModel(),
        private UserRepository $users = new UserRepository(),
        private NotificationQueue $notifications = new NotificationQueue(),
    ) {
    }

    /**
     * Pre-flight validation (port of validateBidAmount). Authoritative re-check
     * happens inside the transaction.
     * @param array<string,mixed> $item
     * @return array{ok:true}|array{ok:false,error:string}
     */
    public function validateBid(array $item, float $amount): array
    {
        if (!is_finite($amount) || $amount <= 0) {
            return ['ok' => false, 'error' => 'Invalid bid amount.'];
        }
        $nowMs = (int) (microtime(true) * 1000);
        $start = self::ms($item['startTime']);
        $end = self::ms($item['endTime']);
        if ($nowMs < $start || $nowMs > $end) {
            return ['ok' => false, 'error' => 'Bidding is closed or not yet open for this item.'];
        }
        $required = max($item['currentBid'] ?: $item['startBid'], $item['startBid']) + $item['increment'];
        if ($amount < $required) {
            return ['ok' => false, 'error' => "Bid must be at least {$required}."];
        }
        if (self::cents($amount - $required) % self::cents($item['increment']) !== 0) {
            return ['ok' => false, 'error' => "Bid must increase by {$item['increment']}."];
        }
        return ['ok' => true];
    }

    /**
     * Atomic bid placement. Mirrors place_auction_bid() exactly.
     * @param array<string,mixed> $item the (pre-load) StoredItem
     * @return array{ok:true,bidId:string,bidSequence:int,currentBid:float,previousBidderUserId:?string,duplicate:bool}
     *        |array{ok:false,status:int,error:string}
     */
    public function placeBidAtomically(
        array $item,
        float $amount,
        float $expectedCurrentBid,
        string $bidderUserId,
        string $idempotencyKey
    ): array {
        $pdo = Database::pdo();
        $bidId = Uuid::v4();
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $createdAt = $now->format('Y-m-d H:i:s.u');
        $ttl = (int) Config::get('jwt')['ttl_seconds'];
        $idempotencyExpiresAt = $now->modify("+{$ttl} seconds")->format('Y-m-d H:i:s.u');

        $pdo->beginTransaction();
        try {
            // 1. Lock the item.
            $stmt = $pdo->prepare(
                'SELECT id, start_bid, increment_amount, current_bid, start_time, end_time
                 FROM items WHERE id = :id AND archived_at IS NULL FOR UPDATE'
            );
            $stmt->execute([':id' => $item['id']]);
            $locked = $stmt->fetch();
            if ($locked === false) {
                return $this->fail($pdo, 404, 'Item not found.');
            }
            $lockedCurrent = (float) $locked['current_bid'];
            $lockedStartBid = (float) $locked['start_bid'];
            $lockedIncrement = (float) $locked['increment_amount'];

            // 2. Idempotency.
            $key = trim($idempotencyKey);
            if ($key !== '') {
                $idemStmt = $pdo->prepare('SELECT * FROM bid_idempotency_keys WHERE idempotency_key = :k FOR UPDATE');
                $idemStmt->execute([':k' => $key]);
                $existing = $idemStmt->fetch();
                if ($existing !== false) {
                    $sameUser = (string) ($existing['bidder_user_id'] ?? '') === $bidderUserId;
                    if ((string) $existing['item_id'] !== (string) $item['id']
                        || !$sameUser
                        || (float) $existing['amount'] !== $amount) {
                        return $this->fail($pdo, 409, 'Duplicate bid submission detected.');
                    }
                    $pdo->commit();
                    return [
                        'ok' => true,
                        'bidId' => (string) $existing['bid_id'],
                        'bidSequence' => (int) $existing['bid_sequence'],
                        'currentBid' => $lockedCurrent,
                        'previousBidderUserId' => null,
                        'duplicate' => true,
                    ];
                }
            }

            // 3. State + window + amount checks (authoritative, under lock).
            if ($lockedCurrent !== $expectedCurrentBid) {
                return $this->fail($pdo, 409, 'Item bid state changed. Refresh and try again.');
            }
            $nowMs = (int) ($now->format('U.u') * 1000);
            if ($nowMs < self::msDb($locked['start_time']) || $nowMs > self::msDb($locked['end_time'])) {
                return $this->fail($pdo, 400, 'Bidding is closed or not yet open for this item.');
            }
            $required = max($lockedCurrent, $lockedStartBid) + $lockedIncrement;
            if ($amount < $required) {
                return $this->fail($pdo, 400, "Bid must be at least {$required}.");
            }
            if (self::cents($amount - $required) % self::cents($lockedIncrement) !== 0) {
                return $this->fail($pdo, 400, "Bid must increase by {$lockedIncrement}.");
            }

            // 4. Previous leader + next sequence.
            $prev = $pdo->prepare(
                'SELECT bidder_user_id FROM bids WHERE item_id = :id ORDER BY amount DESC, created_at DESC LIMIT 1'
            );
            $prev->execute([':id' => $item['id']]);
            $prevRow = $prev->fetch();
            $previousUserId = $prevRow && $prevRow['bidder_user_id'] ? (string) $prevRow['bidder_user_id'] : null;

            $seqStmt = $pdo->prepare('SELECT COUNT(*) + 1 AS seq FROM bids WHERE item_id = :id');
            $seqStmt->execute([':id' => $item['id']]);
            $sequence = (int) $seqStmt->fetch()['seq'];

            // 5. Insert bid, bump item.
            $alias = 'Bidder-' . str_pad((string) $sequence, 3, '0', STR_PAD_LEFT);
            $pdo->prepare(
                'INSERT INTO bids (id, item_id, bidder_alias, bidder_user_id, amount, bid_time, created_at)
                 VALUES (:id, :item, :alias, :uid, :amount, :btime, :created)'
            )->execute([
                ':id' => $bidId,
                ':item' => $item['id'],
                ':alias' => $alias,
                ':uid' => $bidderUserId !== '' ? $bidderUserId : null,
                ':amount' => $amount,
                ':btime' => $now->format('H:i'),
                ':created' => $createdAt,
            ]);
            $pdo->prepare('UPDATE items SET current_bid = :amt WHERE id = :id')
                ->execute([':amt' => $amount, ':id' => $item['id']]);

            // 6. Record idempotency key.
            if ($key !== '') {
                $pdo->prepare(
                    'INSERT INTO bid_idempotency_keys
                       (idempotency_key, item_id, bid_id, bidder_user_id, amount, bid_sequence, created_at, expires_at)
                     VALUES (:k, :item, :bid, :uid, :amount, :seq, :created, :expires)'
                )->execute([
                    ':k' => $key,
                    ':item' => $item['id'],
                    ':bid' => $bidId,
                    ':uid' => $bidderUserId !== '' ? $bidderUserId : null,
                    ':amount' => $amount,
                    ':seq' => $sequence,
                    ':created' => $createdAt,
                    ':expires' => $idempotencyExpiresAt,
                ]);
            }

            $pdo->commit();
            return [
                'ok' => true,
                'bidId' => $bidId,
                'bidSequence' => $sequence,
                'currentBid' => $amount,
                'previousBidderUserId' => $previousUserId,
                'duplicate' => false,
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Queue "your bid placed" + "you were outbid" emails (port of
     * queueBidActivityNotifications). Legacy audit-based attribution is dropped:
     * post-migration bids always carry bidder_user_id.
     * @param array<string,mixed> $item
     * @param array{userId:?string,email:?string,displayName:string} $bidder
     */
    public function queueBidActivityNotifications(
        array $item,
        array $bidder,
        float $amount,
        ?string $previousLeaderUserId
    ): void {
        $appBaseUrl = rtrim((string) (Config::load()['jwt']['issuer_url'] ?? ''), '/');
        $imageUrl = isset($item['images'][0]['url']) ? $appBaseUrl . $item['images'][0]['url'] : '';
        $itemUrl = $appBaseUrl . '/items/' . $item['id'];

        if (!empty($bidder['email'])) {
            $this->notifications->enqueue('BID_PLACED', "Your bid was placed for {$item['title']}", [
                'itemId' => $item['id'], 'title' => $item['title'], 'amount' => $amount,
                'currentBid' => $amount, 'displayName' => $bidder['displayName'],
                'imageUrl' => $imageUrl, 'itemUrl' => $itemUrl,
            ], (string) $bidder['email']);
        }

        if ($previousLeaderUserId === null || $previousLeaderUserId === ($bidder['userId'] ?? null)) {
            return;
        }
        $prevUser = $this->users->findById($previousLeaderUserId);
        if (!$prevUser || empty($prevUser['email'])) {
            return;
        }
        $this->notifications->enqueue('OUTBID_ALERT', "You were outbid on {$item['title']}", [
            'itemId' => $item['id'], 'title' => $item['title'], 'currentBid' => $amount,
            'displayName' => $prevUser['display_name'], 'imageUrl' => $imageUrl, 'itemUrl' => $itemUrl,
        ], (string) $prevUser['email']);
    }

    /**
     * Port of getUserBidRecords: one row per item the user has bid on, with
     * winning/outbid/won/lost status.
     * @return array<int,array<string,mixed>>
     */
    public function getUserBidRecords(string $userId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT item_id, amount, created_at FROM bids
             WHERE bidder_user_id = :uid ORDER BY created_at DESC'
        );
        $stmt->execute([':uid' => $userId]);

        $latestByItem = [];
        foreach ($stmt->fetchAll() as $row) {
            $itemId = (string) $row['item_id'];
            if (!isset($latestByItem[$itemId])) {
                $latestByItem[$itemId] = ['amount' => (float) $row['amount'], 'createdAt' => Dates::iso($row['created_at'])];
            }
        }

        $itemsById = [];
        foreach ($this->items->getItems(true) as $item) {
            $itemsById[$item['id']] = $item;
        }

        $nowMs = (int) (microtime(true) * 1000);
        $records = [];
        foreach ($latestByItem as $itemId => $latest) {
            $item = $itemsById[$itemId] ?? null;
            if ($item === null) continue;
            $ended = self::ms($item['endTime']) <= $nowMs;
            $leads = $item['currentBid'] === $latest['amount'];
            $status = $ended ? ($leads ? 'won' : 'lost') : ($leads ? 'winning' : 'outbid');
            $records[] = [
                'itemId' => $item['id'], 'title' => $item['title'], 'category' => $item['category'],
                'lot' => $item['lot'], 'currentBid' => $item['currentBid'],
                'yourLatestBid' => $latest['amount'], 'endTime' => $item['endTime'],
                'lastBidAt' => $latest['createdAt'], 'status' => $status,
            ];
        }
        return $records;
    }

    /** @return array{ok:false,status:int,error:string} */
    private function fail(PDO $pdo, int $status, string $error): array
    {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return ['ok' => false, 'status' => $status, 'error' => $error];
    }

    private static function cents(float $v): int
    {
        return (int) round($v * 100);
    }

    private static function ms(string $iso): int
    {
        return (int) (new \DateTimeImmutable($iso))->format('Uv');
    }

    private static function msDb(string $dbDateTime): int
    {
        return (int) (new \DateTimeImmutable($dbDateTime, new \DateTimeZone('UTC')))->format('Uv');
    }
}
