<?php
declare(strict_types=1);

namespace App\Storage;

use App\Catalog\DocumentVisibility;
use App\Config;
use App\Support\Uuid;

/**
 * Local-disk file storage — the WAMP replacement for the original managed
 * (Supabase Storage / local) uploads. Files are written under a storage dir
 * OUTSIDE the web root; Apache serves them via access-controlled routes (Phase 5).
 *
 * Returns the managed-file shape {id, kind, name, url} the item layer expects.
 * Document names are stored with the vis: visibility prefix.
 *
 * NOTE: deep content sniffing / image re-encoding (sharp) / malware scanning
 * from the original are deferred to Phase 5/7 hardening. Extension + size are
 * enforced here.
 */
final class FileStorage
{
    private const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
    private const DOC_EXT   = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];

    private string $uploadsDir;
    private int $maxBytes;

    public function __construct()
    {
        $cfg = Config::load()['storage'] ?? [];
        $this->uploadsDir = !empty($cfg['uploads_dir'])
            ? rtrim((string) $cfg['uploads_dir'], '/')
            : dirname(__DIR__, 3) . '/storage/uploads';
        $this->maxBytes = (int) ($cfg['max_file_bytes'] ?? 15 * 1024 * 1024);
    }

    /**
     * Store an uploaded or imported file. Returns the managed-file record.
     * @return array{id:string,kind:string,name:string,url:string}
     */
    public function store(string $sourcePath, string $originalName, string $kind, string $visibility, bool $isUpload): array
    {
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $allowed = $kind === 'image' ? self::IMAGE_EXT : self::DOC_EXT;
        if (!in_array($ext, $allowed, true)) {
            throw new \RuntimeException("Unsupported {$kind} file type for {$originalName}.");
        }
        if (!is_file($sourcePath) || filesize($sourcePath) > $this->maxBytes) {
            throw new \RuntimeException("File {$originalName} is missing or exceeds the size limit.");
        }

        $subdir = $kind === 'image' ? 'images' : 'documents';
        $dir = $this->uploadsDir . '/' . $subdir;
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Unable to create storage directory.');
        }

        $storedName = Uuid::v4() . '.' . $ext;
        $dest = $dir . '/' . $storedName;

        $moved = $isUpload ? @move_uploaded_file($sourcePath, $dest) : @copy($sourcePath, $dest);
        if (!$moved) {
            throw new \RuntimeException("Failed to store {$originalName}.");
        }

        return [
            'id'   => Uuid::v4(),
            'kind' => $kind,
            'name' => $kind === 'document' ? DocumentVisibility::encode($originalName, $visibility) : $originalName,
            'url'  => "/uploads/{$subdir}/{$storedName}",
        ];
    }

    /** Absolute path to a stored file if it exists on disk, else null. */
    public function resolve(string $subdir, string $storedName): ?string
    {
        if (!in_array($subdir, ['images', 'documents'], true)) {
            return null;
        }
        $path = $this->uploadsDir . '/' . $subdir . '/' . $storedName;
        return is_file($path) ? $path : null;
    }

    /** Delete a managed file by its public url (best-effort). */
    public function deleteByUrl(string $url): void
    {
        if (!preg_match('#^/uploads/(images|documents)/([A-Za-z0-9._-]+)$#', $url, $m)) {
            return;
        }
        $path = $this->uploadsDir . '/' . $m[1] . '/' . $m[2];
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
