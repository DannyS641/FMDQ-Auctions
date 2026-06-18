<?php
declare(strict_types=1);

namespace App\Notifications;

use App\Config;
use App\Database;
use App\Support\Dates;
use App\Support\Uuid;

/**
 * Drains the notification queue (port of processNotificationQueue +
 * buildNotificationMeta). Each due pending job is claimed, rendered, and
 * delivered via the configured transport:
 *   - 'file': written to a local outbox (dev)
 *   - 'smtp': sent via SmtpMailer (production)
 * Failures retry with capped backoff; exhausted jobs go to 'failed' + dead-letter.
 *
 * Returns the number of jobs successfully delivered.
 */
final class NotificationProcessor
{
    private const CLAIM_TTL_SECONDS = 300;

    public function process(): int
    {
        $cfg = Config::load();
        $transport = (string) ($cfg['notify']['transport'] ?? 'file');
        $maxAttempts = (int) ($cfg['notify']['max_attempts'] ?? 5);
        $from = (string) ($cfg['notify']['from'] ?? 'no-reply@fmdq.com');

        $pdo = Database::pdo();
        $due = $pdo->query(
            "SELECT * FROM notification_queue
             WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP(6))
             ORDER BY created_at ASC LIMIT 100"
        )->fetchAll();

        $sent = 0;
        foreach ($due as $row) {
            $claimToken = 'claim:' . Uuid::v4();
            if (!$this->claim((string) $row['id'], $claimToken)) {
                continue; // another worker took it
            }
            try {
                $payload = json_decode((string) $row['payload_json'], true) ?: [];
                [$text, $html] = array_values(EmailTemplates::render((string) $row['event_type'], $payload));
                $this->deliver($transport, $cfg, $from, $row, $text, $html);
                $this->markSent((string) $row['id'], $claimToken);
                $sent++;
            } catch (\Throwable $e) {
                $this->markFailure($row, $claimToken, $e->getMessage(), $maxAttempts, $cfg);
            }
        }
        return $sent;
    }

    /** @param array<string,mixed> $cfg @param array<string,mixed> $row */
    private function deliver(string $transport, array $cfg, string $from, array $row, string $text, string $html): void
    {
        if ($transport === 'smtp') {
            (new SmtpMailer($cfg['smtp'] ?? []))->send(
                $from, (string) $row['recipient'], (string) $row['subject'], $text, $html
            );
            return;
        }
        // file transport: write to outbox
        $dir = $this->dir($cfg, 'outbox_dir', 'outbox');
        file_put_contents($dir . '/' . $row['id'] . '.json', json_encode([
            'id' => $row['id'], 'eventType' => $row['event_type'], 'recipient' => $row['recipient'],
            'subject' => $row['subject'], 'text' => $text, 'html' => $html,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    private function claim(string $id, string $token): bool
    {
        $exp = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify('+' . self::CLAIM_TTL_SECONDS . ' seconds')->format('Y-m-d H:i:s.u');
        $stmt = Database::pdo()->prepare(
            "UPDATE notification_queue SET claim_token = :t, claim_expires_at = :exp
             WHERE id = :id AND status = 'pending'
               AND (claim_expires_at IS NULL OR claim_expires_at <= UTC_TIMESTAMP(6))"
        );
        $stmt->execute([':t' => $token, ':exp' => $exp, ':id' => $id]);
        return $stmt->rowCount() === 1;
    }

    private function markSent(string $id, string $token): void
    {
        Database::pdo()->prepare(
            "UPDATE notification_queue
             SET status = 'sent', processed_at = :ts, error_message = NULL, claim_token = NULL, claim_expires_at = NULL
             WHERE id = :id AND claim_token = :t"
        )->execute([':ts' => Dates::nowUtc(), ':id' => $id, ':t' => $token]);
    }

    /** @param array<string,mixed> $row @param array<string,mixed> $cfg */
    private function markFailure(array $row, string $token, string $error, int $maxAttempts, array $cfg): void
    {
        $attempts = ((int) $row['attempt_count']) + 1;
        $exhausted = $attempts >= $maxAttempts;
        $pdo = Database::pdo();

        if ($exhausted) {
            $dir = $this->dir($cfg, 'deadletter_dir', 'deadletter');
            file_put_contents($dir . '/' . $row['id'] . '.json', json_encode([
                'id' => $row['id'], 'eventType' => $row['event_type'], 'recipient' => $row['recipient'],
                'subject' => $row['subject'], 'attempts' => $attempts, 'lastError' => $error,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            $pdo->prepare(
                "UPDATE notification_queue
                 SET status = 'failed', attempt_count = :a, error_message = :err, claim_token = NULL, claim_expires_at = NULL
                 WHERE id = :id"
            )->execute([':a' => $attempts, ':err' => $error, ':id' => $row['id']]);
            return;
        }

        $delaySeconds = min(30 * 60, max(60, $attempts * 60));
        $next = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify("+{$delaySeconds} seconds")->format('Y-m-d H:i:s.u');
        $pdo->prepare(
            "UPDATE notification_queue
             SET status = 'pending', attempt_count = :a, next_attempt_at = :next, error_message = :err,
                 claim_token = NULL, claim_expires_at = NULL
             WHERE id = :id"
        )->execute([':a' => $attempts, ':next' => $next, ':err' => $error, ':id' => $row['id']]);
    }

    /** @param array<string,mixed> $cfg */
    private function dir(array $cfg, string $key, string $default): string
    {
        $dir = (string) ($cfg['notify'][$key] ?? '');
        if ($dir === '') {
            $dir = dirname(__DIR__, 3) . '/storage/' . $default;
        }
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return $dir;
    }
}
