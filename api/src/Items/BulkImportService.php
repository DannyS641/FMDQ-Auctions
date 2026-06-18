<?php
declare(strict_types=1);

namespace App\Items;

use App\Audit\AuditService;
use App\Auth\AuthContext;
use App\Catalog\DocumentVisibility;
use App\Config;
use App\Storage\FileStorage;
use App\Support\Uuid;

/**
 * Port of the /api/items/bulk-import route + its CSV/ZIP helpers
 * (register-item-mutation-routes.ts + item-write-service.ts).
 *
 * Two passes: validate every row first (any failure aborts with no writes),
 * then create items — and if any creation fails, roll back everything already
 * created (DB rows + stored files). ZIP extraction is bounded by entry-count
 * and total-byte limits and rejects unsafe paths.
 */
final class BulkImportService
{
    private int $maxEntries;
    private int $maxBytes;

    public function __construct(
        private ItemWriteService $writer = new ItemWriteService(),
        private FileStorage $storage = new FileStorage(),
        private AuditService $audit = new AuditService(),
    ) {
        $cfg = Config::load()['import'] ?? [];
        $this->maxEntries = (int) ($cfg['max_archive_entries'] ?? 200);
        $this->maxBytes = (int) ($cfg['max_extracted_bytes'] ?? 50 * 1024 * 1024);
    }

    /**
     * @return array{status:int,body:array<string,mixed>}
     */
    public function import(AuthContext $ctx, string $csvContent, ?string $zipPath): array
    {
        $csvRows = $this->parseCsv($csvContent);
        if (!$csvRows) {
            return ['status' => 400, 'body' => ['error' => 'The uploaded CSV is empty.']];
        }

        $tempDir = null;
        try {
            $extracted = [];
            if ($zipPath !== null) {
                $tempDir = sys_get_temp_dir() . '/bulk-' . Uuid::v4();
                if (!mkdir($tempDir, 0775, true) && !is_dir($tempDir)) {
                    throw new \RuntimeException('Unable to create extraction directory.');
                }
                $this->inspectArchive($zipPath);
                $extracted = $this->extractArchive($zipPath, $tempDir);
            }

            $report = ['created' => 0, 'skipped' => 0, 'failed' => 0, 'items' => []];
            $pending = [];
            $seenLots = [];
            $seenSkus = [];

            // --- Pass 1: validate ---
            foreach ($csvRows as $index => $row) {
                $rowNum = $index + 2;
                $title = $this->getImportValue($row, ['title', 'item_title']);
                try {
                    $payload = [
                        'title' => $title,
                        'category' => $this->getImportValue($row, ['category']),
                        'lot' => $this->getImportValue($row, ['lot', 'lot_number']),
                        'sku' => $this->getImportValue($row, ['sku', 'asset_code', 'sku_asset_code']),
                        'condition' => $this->getImportValue($row, ['condition']),
                        'location' => $this->getImportValue($row, ['location']),
                        'startBid' => $this->getImportValue($row, ['start_bid', 'starting_bid']),
                        'reserve' => $this->getImportValue($row, ['reserve', 'reserve_price']),
                        'increment' => $this->getImportValue($row, ['increment', 'bid_increment']),
                        'startTime' => $this->getImportValue($row, ['start_time', 'auction_start', 'start']),
                        'endTime' => $this->getImportValue($row, ['end_time', 'auction_end', 'end']),
                        'description' => $this->getImportValue($row, ['description', 'item_description']),
                    ];
                    $validation = $this->writer->validateNewItem($payload);
                    if ($validation['ok'] === false) {
                        $this->addItem($report, 'failed', $rowNum, $title ?: "Row {$rowNum}", null, $validation['error']);
                        continue;
                    }
                    $value = $validation['value'];
                    if (isset($seenLots[$value['lot']]) || isset($seenSkus[$value['sku']])) {
                        $this->addItem($report, 'failed', $rowNum, $value['title'], null, 'Duplicate lot or SKU detected within the uploaded CSV.');
                        continue;
                    }
                    $seenLots[$value['lot']] = true;
                    $seenSkus[$value['sku']] = true;

                    $duplicate = $this->writer->findExistingItemByLotOrSku($value['lot'], $value['sku']);
                    if ($duplicate !== null) {
                        $this->addItem($report, 'skipped', $rowNum, $value['title'], $duplicate['id'], "Skipped because lot or SKU already exists on {$duplicate['title']}.");
                        continue;
                    }

                    $normalizedRow = [];
                    foreach ($row as $k => $v) {
                        $normalizedRow[$this->normalizeImportKey($k)] = $v;
                    }
                    [$imageNames, $documentEntries] = $this->collectFileRefs($normalizedRow);

                    foreach ($imageNames as $name) {
                        if (!isset($extracted[strtolower($name)])) {
                            throw new \RuntimeException("Image file \"{$name}\" was not found in the ZIP.");
                        }
                    }
                    foreach ($documentEntries as $entry) {
                        if (!isset($extracted[strtolower($entry['name'])])) {
                            throw new \RuntimeException("Document file \"{$entry['name']}\" was not found in the ZIP.");
                        }
                    }

                    $pending[] = ['row' => $rowNum, 'title' => $value['title'], 'value' => $value, 'imageNames' => $imageNames, 'documentEntries' => $documentEntries];
                } catch (\Throwable $e) {
                    $this->addItem($report, 'failed', $rowNum, $title ?: "Row {$rowNum}", null, $e->getMessage());
                }
            }

            if ($report['failed'] > 0) {
                $report['message'] = 'Bulk import validation failed. No items were created.';
                return ['status' => 400, 'body' => $report];
            }

            // --- Pass 2: create (with rollback) ---
            $createdIds = [];
            try {
                foreach ($pending as $p) {
                    $imageFiles = [];
                    $documentFiles = [];
                    foreach ($p['imageNames'] as $name) {
                        $imageFiles[] = $this->storage->store($extracted[strtolower($name)], $name, 'image', 'bidder_visible', false);
                    }
                    foreach ($p['documentEntries'] as $entry) {
                        $documentFiles[] = $this->storage->store($extracted[strtolower($entry['name'])], $entry['name'], 'document', $entry['visibility'], false);
                    }
                    try {
                        $itemId = $this->writer->createItemRecord($ctx, $p['value'], $imageFiles, $documentFiles);
                        $createdIds[] = $itemId;
                        $this->addItem($report, 'created', $p['row'], $p['title'], $itemId, 'Imported successfully.');
                    } catch (\Throwable $e) {
                        foreach (array_merge($imageFiles, $documentFiles) as $f) {
                            $this->storage->deleteByUrl($f['url']);
                        }
                        throw $e;
                    }
                }
            } catch (\Throwable $e) {
                foreach (array_reverse($createdIds) as $id) {
                    try { $this->writer->rollbackCreatedItem($id); } catch (\Throwable) { /* best effort */ }
                }
                $report['error'] = $e->getMessage();
                $report['message'] = 'Bulk import failed during commit. Created items were rolled back.';
                return ['status' => 500, 'body' => $report];
            }

            $this->audit->append($ctx, 'ITEM_BULK_IMPORTED', 'system', 'bulk-import', [
                'created' => $report['created'], 'skipped' => $report['skipped'], 'failed' => $report['failed'],
            ]);
            return ['status' => 200, 'body' => $report];
        } finally {
            if ($tempDir !== null) {
                $this->rmTree($tempDir);
            }
        }
    }

    // --- CSV ------------------------------------------------------------------

    /** @return array<int,array<string,string>> */
    private function parseCsv(string $content): array
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

    private function normalizeImportKey(string $value): string
    {
        return preg_replace('/[^a-z0-9]+/', '_', strtolower(trim($value)));
    }

    /** @param array<string,string> $row */
    private function getImportValue(array $row, array $candidates): string
    {
        $normalized = [];
        foreach ($row as $k => $v) {
            $normalized[$this->normalizeImportKey($k)] = $v;
        }
        foreach ($candidates as $c) {
            $key = $this->normalizeImportKey($c);
            if (array_key_exists($key, $normalized)) {
                return (string) $normalized[$key];
            }
        }
        return '';
    }

    /** @return string[] */
    private function splitImportList(string $value): array
    {
        return array_values(array_filter(array_map('trim', preg_split('/[;,|]/', $value))));
    }

    /**
     * @param array<string,string> $normalizedRow
     * @return array{0:string[],1:array<int,array{name:string,visibility:string}>}
     */
    private function collectFileRefs(array $normalizedRow): array
    {
        $imageNames = [];
        $documentEntries = [];
        foreach ($normalizedRow as $key => $value) {
            if ($value === null || trim((string) $value) === '') continue;
            if (str_starts_with($key, 'image')) {
                foreach ($this->splitImportList((string) $value) as $name) {
                    $imageNames[] = $name;
                }
            } elseif ((str_starts_with($key, 'document') || str_starts_with($key, 'doc')) && !str_ends_with($key, '_visibility')) {
                $visibility = DocumentVisibility::normalize(
                    $normalizedRow["{$key}_visibility"] ?? $normalizedRow['document_visibility'] ?? $normalizedRow['doc_visibility'] ?? null
                );
                foreach ($this->splitImportList((string) $value) as $name) {
                    $documentEntries[] = ['name' => $name, 'visibility' => $visibility];
                }
            }
        }
        return [$imageNames, $documentEntries];
    }

    // --- ZIP ------------------------------------------------------------------

    private function inspectArchive(string $zipPath): void
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('Unable to read the ZIP bundle.');
        }
        $entries = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = trim((string) $zip->getNameIndex($i));
            if ($name === '' || str_ends_with($name, '/')) continue;
            $entries[] = $name;
        }
        $zip->close();
        $this->validateArchiveEntries($entries);
    }

    /** @return array<string,string> lowercased basename => extracted path */
    private function extractArchive(string $zipPath, string $targetDir): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('Unable to read the ZIP bundle.');
        }
        $map = [];
        $totalBytes = 0;
        $totalFiles = 0;
        try {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $entryName = str_replace('\\', '/', trim((string) $stat['name']));
                if ($entryName === '' || str_ends_with($entryName, '/')) continue;
                $this->validateArchiveEntries([$entryName]);
                $totalFiles++;
                if ($totalFiles > $this->maxEntries) {
                    throw new \RuntimeException("The ZIP bundle contains too many extracted files. Maximum allowed is {$this->maxEntries}.");
                }
                $data = $zip->getFromIndex($i);
                if ($data === false) {
                    throw new \RuntimeException('Failed to read a file from the ZIP bundle.');
                }
                $totalBytes += strlen($data);
                if ($totalBytes > $this->maxBytes) {
                    $mb = (int) round($this->maxBytes / (1024 * 1024));
                    throw new \RuntimeException("The extracted ZIP bundle exceeds the {$mb} MB safety limit.");
                }
                $fileName = basename($entryName);
                $outputPath = $targetDir . '/' . Uuid::v4() . '-' . $fileName;
                file_put_contents($outputPath, $data);
                $map[strtolower($fileName)] = $outputPath;
            }
        } finally {
            $zip->close();
        }
        return $map;
    }

    /** Port of validateArchiveEntries (security-logic.ts). @param string[] $entries */
    private function validateArchiveEntries(array $entries): void
    {
        if (!$entries) {
            throw new \RuntimeException('The ZIP bundle is empty.');
        }
        if (count($entries) > $this->maxEntries) {
            throw new \RuntimeException("The ZIP bundle contains too many files. Maximum allowed is {$this->maxEntries}.");
        }
        foreach ($entries as $entry) {
            $normalized = str_replace('\\', '/', $entry);
            if (str_starts_with($normalized, '/') || str_contains($normalized, '../')) {
                throw new \RuntimeException("The ZIP bundle contains an unsafe path: {$entry}");
            }
        }
    }

    // --- misc -----------------------------------------------------------------

    private function addItem(array &$report, string $status, int $row, string $title, ?string $itemId, string $message): void
    {
        $report[$status]++;
        $entry = ['row' => $row, 'status' => $status, 'title' => $title, 'message' => $message];
        if ($itemId !== null) {
            $entry['itemId'] = $itemId;
        }
        $report['items'][] = $entry;
    }

    private function rmTree(string $dir): void
    {
        if (!is_dir($dir)) return;
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = $dir . '/' . $entry;
            is_dir($path) ? $this->rmTree($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
