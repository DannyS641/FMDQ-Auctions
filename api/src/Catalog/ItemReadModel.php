<?php
declare(strict_types=1);

namespace App\Catalog;

use App\Auth\AuthContext;
use App\Auth\Permissions;
use App\Repository\ItemRepository;

/**
 * Port of item-read-model.ts + the sanitize/reserve helpers in item-policy.ts.
 * Hydrates DB rows into the camelCase StoredItem shape the frontend consumes,
 * then sanitizes per the caller's AuthContext (hide reserve, anonymize bidders,
 * filter documents by visibility).
 */
final class ItemReadModel
{
    public function __construct(private ItemRepository $items = new ItemRepository())
    {
    }

    /** @return array<int,array<string,mixed>> full items, hydrated */
    public function getItems(bool $includeArchived = false): array
    {
        $rows = $this->items->listItems($includeArchived);
        return $this->hydrate($rows);
    }

    /** @return array<int,array<string,mixed>> list view: first image only, no bids/docs */
    public function getItemSummaries(bool $includeArchived = false): array
    {
        $rows = $this->items->listItems($includeArchived);
        if (!$rows) return [];
        $ids = array_column($rows, 'id');
        $files = $this->items->filesFor($ids, 'image');
        return array_map(fn ($row) => $this->mapSummary($row, $files), $rows);
    }

    /** @return array<string,mixed>|null */
    public function getItemById(string $id, bool $includeArchived = false): ?array
    {
        $row = $this->items->findById($id, $includeArchived);
        if ($row === null) return null;
        return $this->hydrate([$row])[0] ?? null;
    }

    // --- hydration -----------------------------------------------------------

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<int,array<string,mixed>>
     */
    private function hydrate(array $rows): array
    {
        if (!$rows) return [];
        $ids = array_column($rows, 'id');
        $files = $this->items->filesFor($ids);
        $bids = $this->items->bidsFor($ids);

        $userIds = [];
        foreach ($bids as $b) {
            if (!empty($b['bidder_user_id'])) $userIds[] = (string) $b['bidder_user_id'];
        }
        $names = $this->items->displayNames($userIds);

        return array_map(fn ($row) => $this->mapItem($row, $files, $bids, $names), $rows);
    }

    /**
     * @param array<string,mixed> $row
     * @param array<int,array<string,mixed>> $files
     * @param array<int,array<string,mixed>> $bids
     * @param array<string,string> $names
     * @return array<string,mixed>
     */
    private function mapItem(array $row, array $files, array $bids, array $names): array
    {
        $id = (string) $row['id'];
        $images = [];
        $documents = [];
        foreach ($files as $f) {
            if ((string) $f['item_id'] !== $id) continue;
            if ($f['kind'] === 'image') {
                $images[] = ['name' => $f['name'], 'url' => $f['url']];
            } elseif ($f['kind'] === 'document') {
                $parsed = DocumentVisibility::parse((string) $f['name']);
                $documents[] = ['name' => $parsed['displayName'], 'url' => $f['url'], 'visibility' => $parsed['visibility']];
            }
        }

        $itemBids = [];
        foreach ($bids as $b) {
            if ((string) $b['item_id'] !== $id) continue;
            $bidderUserId = !empty($b['bidder_user_id']) ? (string) $b['bidder_user_id'] : null;
            $itemBids[] = [
                'bidder'       => $bidderUserId !== null ? ($names[$bidderUserId] ?? $b['bidder_alias']) : $b['bidder_alias'],
                'amount'       => (float) $b['amount'],
                'time'         => $b['bid_time'],
                'createdAt'    => self::iso($b['created_at']),
                'bidderUserId' => $bidderUserId,
            ];
        }

        return [
            'id'          => $id,
            'title'       => $row['title'],
            'category'    => $row['category'],
            'lot'         => $row['lot'],
            'sku'         => $row['sku'],
            'condition'   => $row['condition'],
            'location'    => $row['location'],
            'startBid'    => (float) $row['start_bid'],
            'reserve'     => (float) $row['reserve'],
            'increment'   => (float) $row['increment_amount'],
            'currentBid'  => (float) $row['current_bid'],
            'startTime'   => self::iso($row['start_time']),
            'endTime'     => self::iso($row['end_time']),
            'description' => $row['description'] ?? '',
            'images'      => $images,
            'documents'   => $documents,
            'bids'        => $itemBids,
            'createdAt'   => self::iso($row['created_at']),
            'archivedAt'  => $row['archived_at'] !== null ? self::iso($row['archived_at']) : null,
        ];
    }

    /**
     * @param array<string,mixed> $row
     * @param array<int,array<string,mixed>> $files
     * @return array<string,mixed>
     */
    private function mapSummary(array $row, array $files): array
    {
        $id = (string) $row['id'];
        $image = null;
        foreach ($files as $f) {
            if ((string) $f['item_id'] === $id && $f['kind'] === 'image') {
                $image = ['name' => $f['name'], 'url' => $f['url']];
                break;
            }
        }
        return [
            'id'          => $id,
            'title'       => $row['title'],
            'category'    => $row['category'],
            'lot'         => $row['lot'],
            'sku'         => $row['sku'],
            'condition'   => $row['condition'],
            'location'    => $row['location'],
            'startBid'    => (float) $row['start_bid'],
            'reserve'     => (float) $row['reserve'],
            'increment'   => (float) $row['increment_amount'],
            'currentBid'  => (float) $row['current_bid'],
            'startTime'   => self::iso($row['start_time']),
            'endTime'     => self::iso($row['end_time']),
            'description' => $row['description'] ?? '',
            'images'      => $image ? [$image] : [],
            'documents'   => [],
            'bids'        => [],
            'createdAt'   => self::iso($row['created_at']),
            'archivedAt'  => $row['archived_at'] !== null ? self::iso($row['archived_at']) : null,
        ];
    }

    // --- policy: reserve state, winner, sanitize -----------------------------

    /** @param array<string,mixed> $item */
    public function reserveState(array $item): string
    {
        $reserve = $item['reserve'] ?? null;
        if ($reserve === null || $reserve <= 0) return 'no_reserve';
        $ended = self::ms($item['endTime']) <= self::nowMs();
        if (!$ended) {
            return $item['currentBid'] >= $reserve ? 'reserve_met' : 'reserve_pending';
        }
        return $item['currentBid'] >= $reserve ? 'reserve_met' : 'reserve_not_met';
    }

    /** @param array<string,mixed> $item */
    public function isUserWinning(AuthContext $ctx, array $item): bool
    {
        if ($ctx->userId === null) return false;
        if (self::ms($item['endTime']) > self::nowMs()) return false;
        if ($item['currentBid'] <= 0) return false;
        foreach ($item['bids'] as $bid) {
            if (($bid['bidderUserId'] ?? null) === $ctx->userId && $bid['amount'] === $item['currentBid']) {
                return true;
            }
        }
        return false;
    }

    /**
     * Port of sanitizeItemForAuth: hide reserve from non-admins, anonymize bidder
     * identities from non-operators, and drop documents the caller cannot access.
     * @param array<string,mixed> $item
     * @return array<string,mixed>
     */
    public function sanitizeForAuth(array $item, AuthContext $ctx): array
    {
        $canSeeOps = Permissions::canViewItemOperations($ctx->role) || $ctx->adminAuthorized;

        if (!Permissions::canViewReserve($ctx->role)) {
            unset($item['reserve']);
        }

        $item['bids'] = array_map(static function (array $bid) use ($canSeeOps): array {
            if (!$canSeeOps) {
                $bid['bidder'] = 'Anonymous bidder';
                $bid['bidderUserId'] = null;
            }
            return $bid;
        }, $item['bids']);

        $docCtx = [
            'itemArchived' => !empty($item['archivedAt']),
            'itemEnded'    => self::ms($item['endTime']) <= self::nowMs(),
            'reserveState' => $this->reserveState($item),
            'isWinner'     => $this->isUserWinning($ctx, $item),
        ];
        $item['documents'] = array_values(array_filter(
            $item['documents'],
            fn (array $doc): bool => DocumentVisibility::canAccess($ctx, $docCtx, $doc['visibility'] ?? DocumentVisibility::BIDDER_VISIBLE)
        ));

        return $item;
    }

    // --- helpers -------------------------------------------------------------

    private static function iso(string $dbDateTime): string
    {
        // DB stores UTC DATETIME(6); emit ISO-8601 with milliseconds + Z.
        $dt = new \DateTimeImmutable($dbDateTime, new \DateTimeZone('UTC'));
        return $dt->format('Y-m-d\TH:i:s.v\Z');
    }

    private static function ms(string $iso): int
    {
        return (int) (new \DateTimeImmutable($iso))->format('Uv');
    }

    private static function nowMs(): int
    {
        return (int) (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Uv');
    }
}
