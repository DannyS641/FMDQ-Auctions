<?php
/**
 * Same-origin router — a local preview of the production WAMP/Apache layout.
 *
 *   php -S localhost:8080 -t dist deploy/router.php
 *
 * It mirrors what the Apache vhost does in production:
 *   - /api/*  and /uploads/*  -> the PHP API front controller
 *   - real files in dist/      -> served as static assets
 *   - anything else            -> dist/index.html (SPA fallback for React Router)
 *
 * This is for verification/preview only; production uses Apache (see
 * deploy/apache-fmdq.conf), which serves static assets far more efficiently.
 */
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// 1. API + file serving -> PHP front controller.
if (preg_match('#^/(api|uploads)(/|$)#', $path)) {
    require __DIR__ . '/../api/public/index.php';
    return true;
}

// 2. Real static asset in dist/ -> let the built-in server serve it.
$dist = realpath(__DIR__ . '/../dist');
$candidate = realpath($dist . $path);
if ($candidate !== false && is_file($candidate) && str_starts_with($candidate, $dist)) {
    return false;
}

// 3. SPA fallback.
header('Content-Type: text/html; charset=utf-8');
readfile($dist . '/index.html');
return true;
