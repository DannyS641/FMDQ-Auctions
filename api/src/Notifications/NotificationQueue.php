<?php
declare(strict_types=1);

namespace App\Notifications;

use App\Database;
use App\Support\Dates;
use App\Support\Uuid;

/**
 * Port of notification-service.ts queueNotification — the ENQUEUE half only.
 * Inserts a pending email job; actual delivery (the worker) is Phase 5.
 */
final class NotificationQueue
{
    /** @param array<string,mixed> $payload */
    public function enqueue(string $eventType, string $subject, array $payload, string $recipient): void
    {
        if ($recipient === '') {
            return; // nothing to send to
        }
        $now = Dates::nowUtc();
        $stmt = Database::pdo()->prepare(
            'INSERT INTO notification_queue
              (id, channel, event_type, recipient, subject, status, payload_json, created_at, next_attempt_at, attempt_count)
             VALUES (:id, :channel, :etype, :rcpt, :subject, :status, :payload, :created, :next, 0)'
        );
        $stmt->execute([
            ':id'      => Uuid::v4(),
            ':channel' => 'email',
            ':etype'   => $eventType,
            ':rcpt'    => $recipient,
            ':subject' => $subject,
            ':status'  => 'pending',
            ':payload' => json_encode($payload, JSON_UNESCAPED_SLASHES),
            ':created' => $now,
            ':next'    => $now,
        ]);
    }
}
