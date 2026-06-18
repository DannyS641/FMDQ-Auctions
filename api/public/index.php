<?php
/**
 * Front controller for the FMDQ Auctions PHP API.
 *
 * Phase 2 wires the AUTH endpoints only:
 *   GET  /api/health
 *   POST /api/auth/login    { email, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *
 * Phase 3 adds the remaining endpoints (items, bids, admin, ...) on this router.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Auth\AuthService;
use App\Catalog\ItemReadModel;
use App\Catalog\LandingStats;
use App\Middleware\AuthMiddleware;
use App\Repository\CategoryRepository;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** Send a JSON response and stop. */
function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

/** Read and JSON-decode the request body. */
function jsonBody(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Set the session cookie from AuthService cookie params. */
function setSessionCookie(array $c): void
{
    setcookie($c['name'], $c['value'], [
        'expires'  => $c['expires'],
        'path'     => $c['path'],
        'secure'   => $c['secure'],
        'httponly' => $c['httponly'],
        'samesite' => $c['samesite'],
    ]);
}

function clearSessionCookie(): void
{
    $jwt = \App\Config::get('jwt');
    setcookie((string) $jwt['cookie_name'], '', [
        'expires'  => time() - 3600,
        'path'     => '/',
        'secure'   => (bool) $jwt['cookie_secure'],
        'httponly' => true,
        'samesite' => (string) $jwt['cookie_samesite'],
    ]);
}

// --- Routing -----------------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path   = rtrim($path, '/') ?: '/';

try {
    if ($method === 'GET' && ($path === '/' || $path === '/api')) {
        respond(200, [
            'service' => 'fmdq-auctions-api',
            'phase'   => 2,
            'hint'    => 'This is a JSON API, not a web page. Try the endpoints below.',
            'endpoints' => [
                'GET  /api/health'      => 'liveness check',
                'GET  /api/auth/me'     => 'current user (null if not logged in)',
                'POST /api/auth/login'  => 'body: {"email","password"}',
                'POST /api/auth/logout' => 'ends the session',
            ],
            'demo_account' => ['email' => 'demo@auction.test', 'password' => 'Demo12345!'],
        ]);
    }

    if ($method === 'GET' && $path === '/api/health') {
        respond(200, ['ok' => true, 'service' => 'fmdq-auctions-api', 'phase' => 2]);
    }

    if ($method === 'POST' && $path === '/api/auth/login') {
        $body = jsonBody();
        $result = (new AuthService())->login(
            (string) ($body['email'] ?? ''),
            (string) ($body['password'] ?? '')
        );
        if (!$result['ok']) {
            respond(401, ['error' => 'Invalid email or password.']);
        }
        setSessionCookie($result['cookie']);
        respond(200, ['user' => $result['user']]);
    }

    if ($method === 'POST' && $path === '/api/auth/logout') {
        $auth = (new AuthMiddleware())->authenticate();
        if ($auth !== null) {
            (new AuthService())->logout($auth['jti']);
        }
        clearSessionCookie();
        respond(200, ['ok' => true]);
    }

    if ($method === 'GET' && $path === '/api/auth/me') {
        $auth = (new AuthMiddleware())->authenticate();
        if ($auth === null) {
            respond(200, ['user' => null]); // anonymous, not an error
        }
        respond(200, ['user' => [
            'id'           => $auth['user']['id'],
            'email'        => $auth['user']['email'],
            'display_name' => $auth['user']['display_name'],
            'auth_source'  => $auth['user']['auth_source'],
            'roles'        => $auth['roles'],
        ]]);
    }

    // --- Catalog (public reads, sanitized per role) --------------------------
    if ($method === 'GET' && $path === '/api/items') {
        $ctx = (new AuthMiddleware())->context();
        $includeArchived = ($_GET['includeArchived'] ?? '') === '1';
        if ($includeArchived && !$ctx->adminAuthorized) {
            respond(403, ['error' => 'Admin role required.']);
        }
        $model = new ItemReadModel();
        $items = array_map(
            fn (array $it) => $model->sanitizeForAuth($it, $ctx),
            $model->getItemSummaries($includeArchived)
        );
        respond(200, $items);
    }

    if ($method === 'GET' && preg_match('#^/api/items/([^/]+)$#', $path, $m)) {
        $ctx = (new AuthMiddleware())->context();
        $includeArchived = ($_GET['includeArchived'] ?? '') === '1';
        if ($includeArchived && !$ctx->adminAuthorized) {
            respond(403, ['error' => 'Admin role required.']);
        }
        $model = new ItemReadModel();
        $item = $model->getItemById(rawurldecode($m[1]), $includeArchived);
        if ($item === null) {
            respond(404, ['error' => 'Item not found']);
        }
        respond(200, $model->sanitizeForAuth($item, $ctx));
    }

    if ($method === 'GET' && $path === '/api/categories') {
        respond(200, (new CategoryRepository())->all());
    }

    if ($method === 'GET' && $path === '/api/landing-stats') {
        respond(200, (new LandingStats())->get());
    }

    respond(404, ['error' => 'Not found.']);
} catch (\Throwable $e) {
    error_log('[api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    respond(500, ['error' => 'Internal server error.']);
}
