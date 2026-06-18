<?php
declare(strict_types=1);

namespace App\Notifications;

use App\Config;

/**
 * Port of renderNotificationContent (notification-service.ts). Builds the
 * text + HTML body for each notification event. Item images use a hosted
 * <img src> URL (served by the Phase 5 image route) instead of inline CID.
 */
final class EmailTemplates
{
    /** @param array<string,mixed> $payload  @return array{text:string,html:string} */
    public static function render(string $eventType, array $payload): array
    {
        $base = rtrim((string) (Config::load()['app']['base_url'] ?? ''), '/');
        $name = self::e($payload['displayName'] ?? 'there');

        switch ($eventType) {
            case 'ACCOUNT_VERIFICATION':
                $url = (string) ($payload['verifyUrl'] ?? '');
                return self::wrap(
                    "Hello {$name},\n\nUse the link below to verify your FMDQ Auctions account:\n{$url}\n\nThis link expires in 24 hours.",
                    "<p>Hello {$name},</p><p>Use the link below to verify your FMDQ Auctions account:</p>"
                    . self::link($url) . "<p>This link expires in 24 hours.</p>"
                );

            case 'ACCOUNT_VERIFIED':
                $signIn = $base . '/signin';
                return self::wrap(
                    "Hello {$name},\n\nYour FMDQ Auctions account has been verified. Sign in here:\n{$signIn}",
                    "<p>Hello {$name},</p><p>Your FMDQ Auctions account has been verified.</p>"
                    . "<p>Sign in here: " . self::a($signIn) . "</p>"
                );

            case 'PASSWORD_RESET':
                $url = (string) ($payload['resetUrl'] ?? '');
                return self::wrap(
                    "Hello {$name},\n\nUse the link below to reset your FMDQ Auctions password:\n{$url}\n\nThis link expires in 1 hour.",
                    "<p>Hello {$name},</p><p>Use the link below to reset your FMDQ Auctions password:</p>"
                    . self::link($url) . "<p>This link expires in 1 hour.</p>"
                );

            case 'PASSWORD_CHANGED':
                return self::wrap(
                    "Hello {$name},\n\nYour FMDQ Auctions password was changed. If this wasn't you, contact support immediately.",
                    "<p>Hello {$name},</p><p>Your FMDQ Auctions password was changed.</p>"
                    . "<p>If this wasn't you, contact support immediately.</p>"
                );

            case 'BID_PLACED':
                $title = self::e($payload['title'] ?? 'this auction item');
                $bid = self::e($payload['currentBid'] ?? $payload['amount'] ?? '');
                $itemUrl = (string) ($payload['itemUrl'] ?? ($base . '/bidding'));
                $img = (string) ($payload['imageUrl'] ?? '');
                return self::wrap(
                    "Hello {$name},\n\nYour bid of {$bid} was placed successfully for {$title}.\n\nView the item:\n{$itemUrl}",
                    ($img !== '' ? '<img src="' . self::e($img) . '" alt="' . $title . '" style="display:block;width:100%;max-width:520px;border-radius:12px;margin:0 0 16px;" />' : '')
                    . "<p>Hello {$name},</p><p>Your bid of <strong>{$bid}</strong> was placed successfully for <strong>{$title}</strong>.</p>"
                    . "<p>View the item: " . self::a($itemUrl) . "</p>"
                );

            case 'OUTBID_ALERT':
                $title = self::e($payload['title'] ?? 'an auction item');
                $bid = self::e($payload['currentBid'] ?? '');
                $itemUrl = (string) ($payload['itemUrl'] ?? ($base . '/bidding'));
                return self::wrap(
                    "Hello {$name},\n\nYou were outbid on {$title}. The current bid is now {$bid}.\n\nPlace a new bid:\n{$itemUrl}",
                    "<p>Hello {$name},</p><p>You were outbid on <strong>{$title}</strong>. The current bid is now <strong>{$bid}</strong>.</p>"
                    . "<p>Place a new bid: " . self::a($itemUrl) . "</p>"
                );

            default:
                // Item lifecycle (created/updated/archived/restored) + any other event.
                $title = self::e($payload['title'] ?? '');
                $line = $title !== '' ? "Auction item update: {$title}." : 'You have a new FMDQ Auctions notification.';
                return self::wrap($line, "<p>{$line}</p>");
        }
    }

    private static function wrap(string $text, string $htmlInner): array
    {
        $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">' . $htmlInner . '</div>';
        return ['text' => $text, 'html' => $html];
    }

    private static function link(string $url): string
    {
        return '<p>' . self::a($url) . '</p>';
    }

    private static function a(string $url): string
    {
        $safe = self::e($url);
        return '<a href="' . $safe . '">' . $safe . '</a>';
    }

    private static function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
