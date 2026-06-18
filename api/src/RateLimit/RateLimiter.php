<?php
declare(strict_types=1);

namespace App\RateLimit;

use App\Config;
use App\Database;
use App\Support\Dates;
use PDO;

/**
 * Port of recordSharedRateLimitAttempt (index.ts). A distributed counter built
 * on unique-key collisions in `security_events`: for an (eventType, actor,
 * window) it tries to claim slots 0..limit-1 by inserting a row whose PK is a
 * deterministic HMAC of the slot. The first slot that inserts cleanly means
 * "allowed". If every slot is already taken (duplicate-key), the limit is hit.
 *
 * Returns true when the attempt is allowed, false when rate-limited.
 */
final class RateLimiter
{
    public function attempt(string $eventType, string $actor, int $windowMs, int $limit, array $details = []): bool
    {
        $secret = (string) Config::get('jwt')['secret'];
        $nowMs = (int) (microtime(true) * 1000);
        $windowStartMs = intdiv($nowMs, $windowMs) * $windowMs;
        $createdAt = Dates::nowUtc();
        $windowStartIso = (new \DateTimeImmutable('@' . intdiv($windowStartMs, 1000)))
            ->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');

        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO security_events (id, event_type, actor, request_id, details_json, created_at)
             VALUES (:id, :etype, :actor, :rid, :details, :created)'
        );

        for ($slot = 0; $slot < $limit; $slot++) {
            $id = hash_hmac('sha256', "{$eventType}:{$actor}:{$windowStartMs}:{$slot}", $secret);
            $payload = json_encode(array_merge([
                'windowStart' => $windowStartIso,
                'slot'        => $slot,
            ], $details), JSON_UNESCAPED_SLASHES);
            try {
                $stmt->execute([
                    ':id'      => $id,
                    ':etype'   => $eventType,
                    ':actor'   => $actor,
                    ':rid'     => \App\Support\RequestId::get(),
                    ':details' => $payload,
                    ':created' => $createdAt,
                ]);
                return true; // claimed a fresh slot
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? 0) === 1062) {
                    continue; // slot taken -> try the next one
                }
                throw $e;
            }
        }
        return false; // all slots taken within this window
    }
}
