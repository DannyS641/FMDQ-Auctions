<?php
declare(strict_types=1);

namespace App\Support;

/**
 * Port of the toCsv helper: build CSV text from a list of associative rows.
 * Header order is taken from the first row's keys.
 */
final class Csv
{
    /** @param array<int,array<string,string|int|float|bool|null>> $rows */
    public static function build(array $rows): string
    {
        if (!$rows) return '';
        $headers = array_keys($rows[0]);
        $lines = [self::line($headers)];
        foreach ($rows as $row) {
            $lines[] = self::line(array_map(static fn ($h) => $row[$h] ?? '', $headers));
        }
        return implode("\r\n", $lines) . "\r\n";
    }

    /** @param array<int,string|int|float|bool|null> $cells */
    private static function line(array $cells): string
    {
        return implode(',', array_map(static function ($cell): string {
            $value = is_bool($cell) ? ($cell ? 'true' : 'false') : (string) ($cell ?? '');
            if (preg_match('/[",\r\n]/', $value)) {
                return '"' . str_replace('"', '""', $value) . '"';
            }
            return $value;
        }, $cells));
    }
}
