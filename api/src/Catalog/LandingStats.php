<?php
declare(strict_types=1);

namespace App\Catalog;

use App\Database;

/**
 * Port of getLandingStats (item-policy.ts). activeLots/verifiedBidders come
 * straight from the DB; accountUptime is computed from MySQL server uptime
 * (the Node version used process.uptime(), which has no PHP-FPM equivalent).
 */
final class LandingStats
{
    /** @return array{activeLots:int,verifiedBidders:int,accountUptime:string} */
    public function get(): array
    {
        $pdo = Database::pdo();

        $activeLots = (int) $pdo->query(
            'SELECT COUNT(*) AS c FROM items
             WHERE archived_at IS NULL AND end_time > UTC_TIMESTAMP(6)'
        )->fetch()['c'];

        $verifiedBidders = (int) $pdo->query(
            "SELECT COUNT(DISTINCT u.id) AS c
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             WHERE u.status = 'active' AND ur.role_name = 'Bidder'"
        )->fetch()['c'];

        return [
            'activeLots'      => $activeLots,
            'verifiedBidders' => $verifiedBidders,
            'accountUptime'   => self::uptime($pdo),
        ];
    }

    private static function uptime(\PDO $pdo): string
    {
        try {
            $row = $pdo->query("SHOW GLOBAL STATUS LIKE 'Uptime'")->fetch();
            $seconds = (int) ($row['Value'] ?? 0);
        } catch (\Throwable) {
            return '0m';
        }
        $minutes = intdiv(max(0, $seconds), 60);
        $days = intdiv($minutes, 60 * 24);
        $hours = intdiv($minutes % (60 * 24), 60);
        $mins = $minutes % 60;
        if ($days > 0) return "{$days}d {$hours}h";
        if ($hours > 0) return "{$hours}h {$mins}m";
        return "{$mins}m";
    }
}
