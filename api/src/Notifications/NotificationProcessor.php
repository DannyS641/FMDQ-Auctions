<?php
declare(strict_types=1);

namespace App\Notifications;

use App\Config;
use App\Database;
use App\Support\Dates;

/**
 * Drains the notification queue. For the 'file' transport (dev) each due
 * pending job is written to a local outbox and marked sent. Real SMTP delivery
 * is Phase 5 — under 'smtp' this is a no-op so nothing is silently dropped.
 *
 * Returns the number of notifications processed.
 */
final class NotificationProcessor
{
    public function process(): int
    {
        $transport = (string) (Config::load()['notify']['transport'] ?? 'file');
        if ($transport !== 'file') {
            return 0; // SMTP delivery handled by the Phase 5 worker
        }

        $pdo = Database::pdo();
        $due = $pdo->query(
            "SELECT * FROM notification_queue
             WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP(6))
             ORDER BY created_at ASC LIMIT 100"
        )->fetchAll();

        if (!$due) {
            return 0;
        }

        $outbox = (string) (Config::load()['notify']['outbox_dir'] ?? (dirname(__DIR__, 3) . '/storage/outbox'));
        if (!is_dir($outbox)) {
            @mkdir($outbox, 0775, true);
        }

        $mark = $pdo->prepare(
            "UPDATE notification_queue SET status = 'sent', processed_at = :ts WHERE id = :id AND status = 'pending'"
        );
        $count = 0;
        foreach ($due as $row) {
            file_put_contents(
                $outbox . '/' . $row['id'] . '.json',
                json_encode([
                    'id' => $row['id'], 'channel' => $row['channel'], 'eventType' => $row['event_type'],
                    'recipient' => $row['recipient'], 'subject' => $row['subject'],
                    'payload' => json_decode((string) $row['payload_json'], true),
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
            );
            $mark->execute([':ts' => Dates::nowUtc(), ':id' => $row['id']]);
            $count += $mark->rowCount() > 0 ? 1 : 0;
        }
        return $count;
    }
}
