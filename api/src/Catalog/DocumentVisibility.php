<?php
declare(strict_types=1);

namespace App\Catalog;

use App\Auth\AuthContext;

/**
 * Port of the document-visibility helpers in security-logic.ts.
 * Document display names are stored with an optional "vis:<visibility>::" prefix
 * that encodes who may download them.
 */
final class DocumentVisibility
{
    public const BIDDER_VISIBLE = 'bidder_visible';
    public const ADMIN_ONLY     = 'admin_only';
    public const WINNER_ONLY    = 'winner_only';

    private const PREFIX = 'vis:';

    /** Encode a document's display name with its visibility (port of encodeDocumentNameWithVisibility). */
    public static function encode(string $name, string $visibility): string
    {
        return self::PREFIX . $visibility . '::' . $name;
    }

    /** Normalize a free-form visibility value; default admin_only (port of normalizeDocumentVisibility). */
    public static function normalize(?string $value): string
    {
        $v = strtolower(trim((string) $value));
        if ($v === self::BIDDER_VISIBLE || $v === self::WINNER_ONLY) return $v;
        return self::ADMIN_ONLY;
    }

    /** @return array{displayName:string,visibility:string} */
    public static function parse(string $storedName): array
    {
        if (!str_starts_with($storedName, self::PREFIX)) {
            return ['displayName' => $storedName, 'visibility' => self::BIDDER_VISIBLE];
        }
        $suffix = substr($storedName, strlen(self::PREFIX));
        $splitAt = strpos($suffix, '::');
        if ($splitAt === false || $splitAt <= 0) {
            return ['displayName' => $storedName, 'visibility' => self::BIDDER_VISIBLE];
        }
        $rawVisibility = substr($suffix, 0, $splitAt);
        $displayName = substr($suffix, $splitAt + 2) ?: $storedName;
        if (!in_array($rawVisibility, [self::BIDDER_VISIBLE, self::ADMIN_ONLY, self::WINNER_ONLY], true)) {
            return ['displayName' => $storedName, 'visibility' => self::BIDDER_VISIBLE];
        }
        return ['displayName' => $displayName, 'visibility' => $rawVisibility];
    }

    /**
     * Port of canAccessDocumentVisibility.
     * @param array{itemArchived:bool,itemEnded:bool,reserveState:string,isWinner:bool} $item
     */
    public static function canAccess(AuthContext $ctx, array $item, string $visibility): bool
    {
        if (!$ctx->signedIn) return false;
        if ($ctx->adminAuthorized) return true;
        if ($item['itemArchived']) return false;
        if ($visibility === self::ADMIN_ONLY) return false;
        if ($visibility === self::BIDDER_VISIBLE) {
            return ($ctx->role === 'Bidder' && !$item['itemEnded']) || $ctx->role === 'ShopOwner';
        }
        if ($visibility === self::WINNER_ONLY) {
            return $ctx->role === 'Bidder' && $item['itemEnded'] && $item['isWinner'] && $item['reserveState'] !== 'reserve_not_met';
        }
        return false;
    }
}
