<?php
declare(strict_types=1);

namespace App\Items;

use App\Audit\AuditService;
use App\Auth\AuthContext;
use App\Database;
use App\Notifications\NotificationQueue;
use App\Repository\CategoryRepository;
use App\Storage\FileStorage;
use App\Support\Dates;
use App\Support\Uuid;

/**
 * Port of item-write-service.ts (DB + lifecycle parts): validation, create,
 * update, archive, restore, plus the bulk-import support helpers (lot/sku
 * lookup, rollback). File bytes are handled by FileStorage.
 */
final class ItemWriteService
{
    public function __construct(
        private CategoryRepository $categories = new CategoryRepository(),
        private AuditService $audit = new AuditService(),
        private NotificationQueue $notifications = new NotificationQueue(),
    ) {
    }

    /**
     * Port of validateNewItem.
     * @param array<string,mixed> $body
     * @return array{ok:true,value:array<string,mixed>}|array{ok:false,error:string}
     */
    public function validateNewItem(array $body): array
    {
        $title = trim((string) ($body['title'] ?? ''));
        $category = trim((string) ($body['category'] ?? ''));
        $lot = trim((string) ($body['lot'] ?? ''));
        $sku = trim((string) ($body['sku'] ?? ''));
        $condition = trim((string) ($body['condition'] ?? ''));
        $location = trim((string) ($body['location'] ?? ''));
        $description = trim((string) ($body['description'] ?? ''));
        $startBid = (float) ($body['startBid'] ?? 0);
        $rawReserve = trim((string) ($body['reserve'] ?? ''));
        $reserve = $rawReserve !== '' ? (float) $rawReserve : 0.0;
        $rawIncrement = trim((string) ($body['increment'] ?? ''));
        $increment = $rawIncrement !== '' ? (float) $rawIncrement : max(500.0, round($startBid * 0.02));
        $startTime = self::toIso((string) ($body['startTime'] ?? ''));
        $endTime = self::toIso((string) ($body['endTime'] ?? ''));

        if ($title === '' || $category === '' || $lot === '' || $sku === '' || $condition === '' || $location === '') {
            return ['ok' => false, 'error' => 'Missing required item fields.'];
        }
        if ($startTime === null || $endTime === null) {
            return ['ok' => false, 'error' => 'Invalid start or end time.'];
        }
        if (strtotime($endTime) <= strtotime($startTime)) {
            return ['ok' => false, 'error' => 'Auction end time must be after start time.'];
        }
        if (!is_finite($startBid) || $startBid <= 0) {
            return ['ok' => false, 'error' => 'Starting bid must be greater than zero.'];
        }
        if (!is_finite($reserve) || $reserve < 0) {
            return ['ok' => false, 'error' => 'Reserve price cannot be negative.'];
        }
        if ($reserve > 0 && $reserve < $startBid) {
            return ['ok' => false, 'error' => 'Reserve price must be at least the starting bid when provided.'];
        }
        if (!is_finite($increment) || $increment <= 0) {
            return ['ok' => false, 'error' => 'Bid increment must be greater than zero.'];
        }
        return ['ok' => true, 'value' => compact(
            'title', 'category', 'lot', 'sku', 'condition', 'location', 'description',
            'startBid', 'reserve', 'increment', 'startTime', 'endTime'
        )];
    }

    /** @return array{ok:true,value:string}|array{ok:false,error:string} */
    public function validateCategoryName(string $value): array
    {
        $name = trim($value);
        if ($name === '') return ['ok' => false, 'error' => 'Category name is required.'];
        if (mb_strlen($name) > 60) return ['ok' => false, 'error' => 'Category name must be 60 characters or fewer.'];
        return ['ok' => true, 'value' => $name];
    }

    /**
     * Create an item + its files + audit + notification. Returns the new id.
     * @param array<string,mixed> $value validated item
     * @param array<int,array<string,mixed>> $images
     * @param array<int,array<string,mixed>> $documents
     */
    public function createItemRecord(AuthContext $ctx, array $value, array $images, array $documents, float $currentBid = 0.0): string
    {
        $pdo = Database::pdo();
        $itemId = Uuid::v4();
        $this->categories->upsert($value['category']);

        $pdo->prepare(
            'INSERT INTO items
              (id,title,category,lot,sku,`condition`,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description,created_at)
             VALUES (:id,:title,:cat,:lot,:sku,:cond,:loc,:sb,:res,:inc,:cur,:st,:et,:desc,:created)'
        )->execute(self::itemParams($itemId, $value, $currentBid));

        $this->insertFiles($itemId, array_merge($images, $documents));

        $this->audit->append($ctx, 'ITEM_CREATED', 'item', $itemId, [
            'title' => $value['title'], 'category' => $value['category'], 'lot' => $value['lot'], 'sku' => $value['sku'],
        ]);
        $this->notifyLifecycle('ITEM_CREATED', "Auction item created: {$value['title']}", $itemId, $value['title']);
        return $itemId;
    }

    /**
     * Update item fields and APPEND any new files (matches original behavior).
     * @param array<string,mixed> $value
     * @param array<int,array<string,mixed>> $images
     * @param array<int,array<string,mixed>> $documents
     */
    public function updateItem(AuthContext $ctx, string $itemId, array $value, array $images, array $documents): void
    {
        $pdo = Database::pdo();
        $this->categories->upsert($value['category']);
        $pdo->prepare(
            'UPDATE items SET title=:title, category=:cat, lot=:lot, sku=:sku, `condition`=:cond, location=:loc,
                start_bid=:sb, reserve=:res, increment_amount=:inc, start_time=:st, end_time=:et, description=:desc
             WHERE id=:id'
        )->execute([
            ':title' => $value['title'], ':cat' => $value['category'], ':lot' => $value['lot'], ':sku' => $value['sku'],
            ':cond' => $value['condition'], ':loc' => $value['location'], ':sb' => $value['startBid'],
            ':res' => $value['reserve'], ':inc' => $value['increment'],
            ':st' => self::dbDate($value['startTime']), ':et' => self::dbDate($value['endTime']),
            ':desc' => $value['description'], ':id' => $itemId,
        ]);
        $this->insertFiles($itemId, array_merge($images, $documents));

        $this->audit->append($ctx, 'ITEM_UPDATED', 'item', $itemId, [
            'title' => $value['title'], 'category' => $value['category'],
        ]);
        $this->notifyLifecycle('ITEM_UPDATED', "Auction item updated: {$value['title']}", $itemId, $value['title']);
    }

    public function archive(AuthContext $ctx, string $itemId, string $title): void
    {
        Database::pdo()->prepare('UPDATE items SET archived_at = :ts WHERE id = :id')
            ->execute([':ts' => Dates::nowUtc(), ':id' => $itemId]);
        $this->audit->append($ctx, 'ITEM_ARCHIVED', 'item', $itemId, ['title' => $title]);
        $this->notifyLifecycle('ITEM_ARCHIVED', "Auction item archived: {$title}", $itemId, $title);
    }

    public function restore(AuthContext $ctx, string $itemId, string $title): void
    {
        Database::pdo()->prepare('UPDATE items SET archived_at = NULL WHERE id = :id')->execute([':id' => $itemId]);
        $this->audit->append($ctx, 'ITEM_RESTORED', 'item', $itemId, ['title' => $title]);
        $this->notifyLifecycle('ITEM_RESTORED', "Auction item restored: {$title}", $itemId, $title);
    }

    /** @return array{id:string,title:string,lot:string,sku:string}|null */
    public function findExistingItemByLotOrSku(string $lot, string $sku): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT id,title,lot,sku FROM items WHERE lot = :lot OR sku = :sku LIMIT 10'
        );
        $stmt->execute([':lot' => $lot, ':sku' => $sku]);
        foreach ($stmt->fetchAll() as $row) {
            if ($row['lot'] === $lot || $row['sku'] === $sku) {
                return ['id' => (string) $row['id'], 'title' => (string) $row['title'], 'lot' => (string) $row['lot'], 'sku' => (string) $row['sku']];
            }
        }
        return null;
    }

    /** Undo a created item (used by bulk-import on failure). */
    public function rollbackCreatedItem(string $itemId): void
    {
        $pdo = Database::pdo();
        $urls = $pdo->prepare('SELECT url FROM item_files WHERE item_id = :id');
        $urls->execute([':id' => $itemId]);
        $storage = new FileStorage();
        foreach ($urls->fetchAll() as $row) {
            $storage->deleteByUrl((string) $row['url']);
        }
        // item_files cascade on item delete; remove the item, its audits, and any
        // queued notifications that referenced it.
        $pdo->prepare("DELETE FROM audits WHERE entity_type='item' AND entity_id = :id")->execute([':id' => $itemId]);
        $pdo->prepare("DELETE FROM notification_queue WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.itemId')) = :id")->execute([':id' => $itemId]);
        $pdo->prepare('DELETE FROM items WHERE id = :id')->execute([':id' => $itemId]);
    }

    /** @param array<int,array<string,mixed>> $files */
    private function insertFiles(string $itemId, array $files): void
    {
        if (!$files) return;
        $stmt = Database::pdo()->prepare(
            'INSERT INTO item_files (id,item_id,kind,name,url) VALUES (:id,:item,:kind,:name,:url)'
        );
        foreach ($files as $f) {
            $stmt->execute([
                ':id' => $f['id'], ':item' => $itemId, ':kind' => $f['kind'], ':name' => $f['name'], ':url' => $f['url'],
            ]);
        }
    }

    private function notifyLifecycle(string $eventType, string $subject, string $itemId, string $title): void
    {
        $recipient = (string) (\App\Config::load()['notify']['to'] ?? '');
        $this->notifications->enqueue($eventType, $subject, ['itemId' => $itemId, 'title' => $title], $recipient);
    }

    /** @param array<string,mixed> $value */
    private static function itemParams(string $itemId, array $value, float $currentBid): array
    {
        return [
            ':id' => $itemId, ':title' => $value['title'], ':cat' => $value['category'], ':lot' => $value['lot'],
            ':sku' => $value['sku'], ':cond' => $value['condition'], ':loc' => $value['location'],
            ':sb' => $value['startBid'], ':res' => $value['reserve'], ':inc' => $value['increment'],
            ':cur' => $currentBid, ':st' => self::dbDate($value['startTime']), ':et' => self::dbDate($value['endTime']),
            ':desc' => $value['description'], ':created' => Dates::nowUtc(),
        ];
    }

    /** Parse a form datetime into ISO-8601 UTC, or null. Assumes UTC if no offset given. */
    private static function toIso(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') return null;
        try {
            $dt = new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }
        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** ISO string -> MySQL DATETIME(6) UTC. */
    private static function dbDate(string $iso): string
    {
        return (new \DateTimeImmutable($iso, new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    }
}
