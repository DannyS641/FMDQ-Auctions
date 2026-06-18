<?php
declare(strict_types=1);

namespace App\Support;

/**
 * Shared CSV-import helpers (parser + flexible header matching), ported from
 * item-write-service.ts. Used by user bulk-import.
 */
final class ImportCsv
{
    /** @return array<int,array<string,string>> */
    public static function parse(string $content): array
    {
        $rows = [];
        $current = '';
        $row = [];
        $inQuotes = false;
        $len = strlen($content);
        for ($i = 0; $i < $len; $i++) {
            $char = $content[$i];
            $next = $i + 1 < $len ? $content[$i + 1] : '';
            if ($char === '"') {
                if ($inQuotes && $next === '"') { $current .= '"'; $i++; }
                else { $inQuotes = !$inQuotes; }
                continue;
            }
            if ($char === ',' && !$inQuotes) { $row[] = $current; $current = ''; continue; }
            if (($char === "\n" || $char === "\r") && !$inQuotes) {
                if ($char === "\r" && $next === "\n") $i++;
                $row[] = $current;
                $current = '';
                if (array_filter($row, static fn ($c) => trim($c) !== '')) $rows[] = $row;
                $row = [];
                continue;
            }
            $current .= $char;
        }
        if ($current !== '' || $row) {
            $row[] = $current;
            if (array_filter($row, static fn ($c) => trim($c) !== '')) $rows[] = $row;
        }
        if (!$rows) return [];
        $headers = array_map('trim', $rows[0]);
        $out = [];
        foreach (array_slice($rows, 1) as $values) {
            $assoc = [];
            foreach ($headers as $idx => $header) {
                $assoc[$header] = trim($values[$idx] ?? '');
            }
            $out[] = $assoc;
        }
        return $out;
    }

    public static function normalizeKey(string $value): string
    {
        return preg_replace('/[^a-z0-9]+/', '_', strtolower(trim($value)));
    }

    /** @param array<string,string> $row */
    public static function value(array $row, array $candidates): string
    {
        $normalized = [];
        foreach ($row as $k => $v) {
            $normalized[self::normalizeKey($k)] = $v;
        }
        foreach ($candidates as $c) {
            $key = self::normalizeKey($c);
            if (array_key_exists($key, $normalized)) {
                return (string) $normalized[$key];
            }
        }
        return '';
    }

    /** @return string[] */
    public static function splitList(string $value): array
    {
        return array_values(array_filter(array_map('trim', preg_split('/[;,|]/', $value))));
    }
}
