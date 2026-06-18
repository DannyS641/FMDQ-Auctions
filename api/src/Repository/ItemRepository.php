<?php
declare(strict_types=1);

namespace App\Repository;

use App\Database;
use PDO;

/**
 * Raw row access for items and their related files/bids. Hydration into the
 * StoredItem shape lives in ItemReadModel.
 */
final class ItemRepository
{
    private const COLUMNS =
        'id,title,category,lot,sku,`condition`,location,start_bid,reserve,increment_amount,'
        . 'current_bid,start_time,end_time,description,created_at,archived_at';

    /** @return array<int,array<string,mixed>> */
    public function listItems(bool $includeArchived): array
    {
        // archived_at ASC puts NULLs (non-archived) first, matching nullsFirst:true.
        $sql = 'SELECT ' . self::COLUMNS . ' FROM items';
        if (!$includeArchived) {
            $sql .= ' WHERE archived_at IS NULL';
        }
        $sql .= ' ORDER BY archived_at ASC, created_at DESC';
        return Database::pdo()->query($sql)->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function findById(string $id, bool $includeArchived): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT ' . self::COLUMNS . ' FROM items WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) return null;
        if (!$includeArchived && $row['archived_at'] !== null) return null;
        return $row;
    }

    /**
     * @param string[] $itemIds
     * @return array<int,array<string,mixed>>
     */
    public function filesFor(array $itemIds, ?string $kind = null): array
    {
        if (!$itemIds) return [];
        [$in, $params] = self::inClause($itemIds);
        $sql = "SELECT item_id, kind, name, url FROM item_files WHERE item_id IN ($in)";
        if ($kind !== null) {
            $sql .= ' AND kind = :kind';
            $params[':kind'] = $kind;
        }
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null the item_files row for a public url + kind */
    public function findFileByUrl(string $url, string $kind): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT item_id, kind, name, url FROM item_files WHERE url = :url AND kind = :kind LIMIT 1'
        );
        $stmt->execute([':url' => $url, ':kind' => $kind]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * @param string[] $itemIds
     * @return array<int,array<string,mixed>>
     */
    public function bidsFor(array $itemIds): array
    {
        if (!$itemIds) return [];
        [$in, $params] = self::inClause($itemIds);
        $sql = "SELECT item_id, bidder_alias, bidder_user_id, amount, bid_time, created_at
                FROM bids WHERE item_id IN ($in)
                ORDER BY created_at DESC";
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * @param string[] $userIds
     * @return array<string,string> id => display_name
     */
    public function displayNames(array $userIds): array
    {
        if (!$userIds) return [];
        [$in, $params] = self::inClause($userIds);
        $stmt = Database::pdo()->prepare("SELECT id, display_name FROM users WHERE id IN ($in)");
        $stmt->execute($params);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string) $row['id']] = (string) $row['display_name'];
        }
        return $map;
    }

    /**
     * Build a positional-safe IN clause with named params.
     * @param string[] $values
     * @return array{0:string,1:array<string,string>}
     */
    private static function inClause(array $values): array
    {
        $values = array_values(array_unique($values));
        $names = [];
        $params = [];
        foreach ($values as $i => $v) {
            $key = ":in$i";
            $names[] = $key;
            $params[$key] = $v;
        }
        return [implode(',', $names), $params];
    }
}
