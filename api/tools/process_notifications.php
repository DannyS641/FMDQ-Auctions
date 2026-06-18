<?php
/**
 * Notification queue worker — drains pending emails once and exits.
 * Replaces the old long-running Node worker (server/worker.ts).
 *
 * Run on a schedule (Phase 7 wires this up):
 *   - Linux/macOS cron (every minute):
 *       * * * * * /path/to/php /path/to/api/tools/process_notifications.php >> /var/log/fmdq-notify.log 2>&1
 *   - Windows Task Scheduler: run php.exe with this script as the argument.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Notifications\NotificationProcessor;

try {
    $sent = (new NotificationProcessor())->process();
    fwrite(STDOUT, '[' . gmdate('Y-m-d\TH:i:s\Z') . "] notifications delivered: {$sent}\n");
    exit(0);
} catch (\Throwable $e) {
    fwrite(STDERR, 'notification worker error: ' . $e->getMessage() . "\n");
    exit(1);
}
