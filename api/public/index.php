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

use App\Admin\AdminService;
use App\Admin\AdminUserService;
use App\Audit\AuditService;
use App\Auth\AccountService;
use App\Auth\AuthContext;
use App\Auth\AuthService;
use App\Auth\Permissions;
use App\Bidding\BidService;
use App\Catalog\DocumentVisibility;
use App\Catalog\ItemReadModel;
use App\Catalog\LandingStats;
use App\Items\BulkImportService;
use App\Items\ItemWriteService;
use App\Middleware\AuthMiddleware;
use App\Notifications\NotificationProcessor;
use App\RateLimit\RateLimiter;
use App\Repository\CategoryRepository;
use App\Repository\RoleRepository;
use App\Repository\SessionRepository;
use App\Repository\UserRepository;
use App\Storage\FileStorage;
use App\Support\Csv;
use App\Support\Dates;

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

/**
 * Shape a user row + roles into the session-user payload the frontend expects:
 * { id, email, displayName, role } where role is the single normalized role.
 * @param array<string,mixed> $user
 * @param string[] $roles
 */
function sessionUserPayload(array $user, array $roles): array
{
    return [
        'id'          => $user['id'],
        'email'       => $user['email'],
        'displayName' => $user['display_name'] ?? ($user['displayName'] ?? ''),
        'role'        => \App\Auth\Permissions::normalizeRole($roles),
    ];
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

/** Send a raw (non-JSON) response, e.g. CSV, and stop. */
function sendRaw(int $status, string $contentType, string $body, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: ' . $contentType);
    foreach ($headers as $k => $v) {
        header("$k: $v");
    }
    echo $body;
    exit;
}

/** Normalize $_FILES[$field] into a flat list of successfully-uploaded files. */
function uploadedFiles(string $field): array
{
    if (empty($_FILES[$field])) return [];
    $f = $_FILES[$field];
    $out = [];
    if (is_array($f['name'])) {
        foreach ($f['name'] as $i => $name) {
            if ((int) ($f['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                $out[] = ['name' => $name, 'tmp_name' => $f['tmp_name'][$i]];
            }
        }
    } elseif ((int) ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $out[] = ['name' => $f['name'], 'tmp_name' => $f['tmp_name']];
    }
    return $out;
}

/** Enforce the shared auth rate limit (10 / 60s per client+scope); 429 + stop if exceeded. */
function authRateLimitOrStop(string $scope): void
{
    $clientKey = ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . $scope;
    if (!(new \App\RateLimit\RateLimiter())->attempt('AUTH_ATTEMPT', $clientKey, 60000, 10)) {
        respond(429, ['error' => 'Too many attempts. Please wait and try again.']);
    }
}

// --- Routing -----------------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
// Method override: lets the browser send multipart (which PHP only parses for
// POST) while semantically performing a PATCH/DELETE/PUT.
if ($method === 'POST') {
    $override = strtoupper((string) ($_POST['_method'] ?? $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? ''));
    if (in_array($override, ['PATCH', 'PUT', 'DELETE'], true)) {
        $method = $override;
    }
}
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
        respond(200, ['signedIn' => true, 'user' => sessionUserPayload($result['user'], $result['user']['roles'])]);
    }

    if ($method === 'POST' && $path === '/api/auth/register') {
        $body = jsonBody();
        $email = (string) ($body['email'] ?? '');
        authRateLimitOrStop('register:' . $email);
        $result = (new AccountService())->register($email, (string) ($body['password'] ?? ''), (string) ($body['displayName'] ?? ''));
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && $path === '/api/auth/verify-email') {
        $body = jsonBody();
        $token = (string) ($body['token'] ?? '');
        authRateLimitOrStop('verify:' . substr($token, 0, 12));
        $result = (new AccountService())->verifyEmail($token);
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && $path === '/api/auth/resend-verification') {
        $body = jsonBody();
        $email = (string) ($body['email'] ?? '');
        authRateLimitOrStop('resend:' . $email);
        $result = (new AccountService())->resendVerification($email);
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && $path === '/api/auth/request-password-reset') {
        $body = jsonBody();
        $email = (string) ($body['email'] ?? '');
        authRateLimitOrStop('reset-request:' . $email);
        $result = (new AccountService())->requestPasswordReset($email);
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && $path === '/api/auth/reset-password') {
        $body = jsonBody();
        $token = (string) ($body['token'] ?? '');
        authRateLimitOrStop('reset:' . substr($token, 0, 12));
        $result = (new AccountService())->resetPassword($token, (string) ($body['password'] ?? ''));
        respond($result['status'], $result['body']);
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
            respond(200, ['signedIn' => false, 'user' => null]); // anonymous, not an error
        }
        respond(200, ['signedIn' => true, 'user' => sessionUserPayload($auth['user'], $auth['roles'])]);
    }

    // Helper: require an authenticated user; returns [AuthContext, authedArray].
    $requireUser = static function (): array {
        $authed = (new AuthMiddleware())->authenticate();
        if ($authed === null) {
            respond(401, ['error' => 'Sign in required.']);
        }
        return [AuthContext::fromUser($authed['user'], $authed['roles']), $authed];
    };

    // --- Bidding -------------------------------------------------------------
    if ($method === 'POST' && preg_match('#^/api/items/([^/]+)/bids$#', $path, $m)) {
        $itemId = rawurldecode($m[1]);
        $authed = (new AuthMiddleware())->authenticate();
        if ($authed === null) {
            respond(401, ['error' => 'Sign in to place a bid.']);
        }
        $ctx = AuthContext::fromUser($authed['user'], $authed['roles']);
        if (!Permissions::canBid($ctx->role)) {
            respond(403, ['error' => 'Your account does not have bidding permission.']);
        }

        $idempotencyKey = (string) ($_SERVER['HTTP_X_IDEMPOTENCY_KEY'] ?? '');
        if (!(new RateLimiter())->attempt('BID_ATTEMPT', "{$ctx->actor}:{$itemId}", 60000, 12, ['itemId' => $itemId])) {
            respond(429, ['error' => 'Too many bid attempts. Please wait and try again.']);
        }

        $model = new ItemReadModel();
        $item = $model->getItemById($itemId);
        if ($item === null) {
            respond(404, ['error' => 'Item not found.']);
        }
        $body = jsonBody();
        $amount = (float) ($body['amount'] ?? 0);
        $expectedCurrentBid = (float) ($body['expectedCurrentBid'] ?? 0);
        if ($item['currentBid'] !== $expectedCurrentBid) {
            respond(409, ['error' => 'Item bid state changed. Refresh and try again.']);
        }
        $validation = (new BidService())->validateBid($item, $amount);
        if ($validation['ok'] === false) {
            respond(400, ['error' => $validation['error']]);
        }

        $bidService = new BidService();
        $biddingUser = (new UserRepository())->findById($ctx->userId);
        $bidResult = $bidService->placeBidAtomically($item, $amount, $expectedCurrentBid, $ctx->userId ?? '', $idempotencyKey);
        if ($bidResult['ok'] === false) {
            respond($bidResult['status'], ['error' => $bidResult['error']]);
        }
        if ($bidResult['duplicate']) {
            respond(409, ['error' => 'Duplicate bid submission detected.']);
        }

        (new AuditService())->append($ctx, 'BID_PLACED', 'bid', $item['id'], [
            'amount' => $amount,
            'bidSequence' => $bidResult['bidSequence'],
        ]);

        $bidService->queueBidActivityNotifications(
            array_merge($item, ['currentBid' => $bidResult['currentBid']]),
            ['userId' => $ctx->userId, 'email' => $biddingUser['email'] ?? null, 'displayName' => $biddingUser['display_name'] ?? $ctx->actor],
            $amount,
            $item['currentBid'] > 0 ? $bidResult['previousBidderUserId'] : null
        );

        respond(200, $model->getItemById($item['id'])); // unsanitized, matching the original
    }

    // --- User self-service (/api/me/*) ---------------------------------------
    if ($method === 'GET' && $path === '/api/me/profile') {
        [$ctx, $authed] = $requireUser();
        $u = $authed['user'];
        respond(200, [
            'id'          => $u['id'],
            'email'       => $u['email'],
            'displayName' => $u['display_name'],
            'status'      => $u['status'],
            'createdAt'   => Dates::iso($u['created_at']),
            'lastLoginAt' => Dates::iso($u['last_login_at']),
            'role'        => $ctx->role,
            'roles'       => array_map([Permissions::class, 'normalizeDisplayRoleName'], $authed['roles']),
        ]);
    }

    if ($method === 'GET' && $path === '/api/me/sessions') {
        [$ctx, $authed] = $requireUser();
        $rows = (new SessionRepository())->listForUser($ctx->userId);
        respond(200, array_map(static fn ($s) => [
            'id'        => $s['id'],
            'createdAt' => Dates::iso($s['created_at']),
            'expiresAt' => Dates::iso($s['expires_at']),
            'current'   => $s['id'] === $authed['jti'],
        ], $rows));
    }

    if ($method === 'DELETE' && preg_match('#^/api/me/sessions/([^/]+)$#', $path, $m)) {
        [$ctx, $authed] = $requireUser();
        $sessions = new SessionRepository();
        $target = $sessions->find(rawurldecode($m[1]));
        if ($target === null || (string) $target['user_id'] !== $ctx->userId) {
            respond(404, ['error' => 'Session not found.']);
        }
        $sessions->delete((string) $target['id']);
        if ((string) $target['id'] === $authed['jti']) {
            clearSessionCookie();
        }
        (new AuditService())->append($ctx, 'SESSION_REVOKED', 'user', $ctx->userId, ['revoked' => 1]);
        respond(200, ['revoked' => true, 'message' => 'Session revoked.']);
    }

    if ($method === 'DELETE' && $path === '/api/me/sessions') {
        [$ctx, $authed] = $requireUser();
        $sessions = new SessionRepository();
        $count = 0;
        foreach ($sessions->listForUser($ctx->userId) as $s) {
            if ((string) $s['id'] !== $authed['jti']) {
                $sessions->delete((string) $s['id']);
                $count++;
            }
        }
        (new AuditService())->append($ctx, 'SESSIONS_REVOKED', 'user', $ctx->userId, ['count' => $count]);
        respond(200, ['revoked' => true, 'count' => $count, 'message' => "Revoked {$count} other session(s)."]);
    }

    if ($method === 'GET' && $path === '/api/me/dashboard') {
        [$ctx] = $requireUser();
        $bidService = new BidService();
        $model = new ItemReadModel();
        $bidRecords = $bidService->getUserBidRecords($ctx->userId);
        $sessions = (new SessionRepository())->listForUser($ctx->userId);
        $nowMs = (int) (microtime(true) * 1000);
        $closed = array_filter($model->getItems(true), static fn ($it) => (new DateTimeImmutable($it['endTime']))->format('Uv') < $nowMs);
        $reserveMet = 0; $reserveNotMet = 0;
        foreach ($closed as $it) {
            $state = $model->reserveState($it);
            if ($state === 'reserve_met') $reserveMet++;
            elseif ($state === 'reserve_not_met') $reserveNotMet++;
        }
        respond(200, [
            'summary' => [
                'openBidCount'             => count(array_filter($bidRecords, static fn ($r) => in_array($r['status'], ['winning', 'outbid', 'active'], true))),
                'wonAuctionCount'          => count(array_filter($bidRecords, static fn ($r) => $r['status'] === 'won')),
                'activeSessionCount'       => count($sessions),
                'totalBidCount'            => count($bidRecords),
                'reserveMetClosedCount'    => $reserveMet,
                'reserveNotMetClosedCount' => $reserveNotMet,
            ],
            'recentBidActivity' => array_slice($bidRecords, 0, 8),
        ]);
    }

    if ($method === 'GET' && $path === '/api/me/bids') {
        [$ctx] = $requireUser();
        respond(200, (new BidService())->getUserBidRecords($ctx->userId));
    }

    if ($method === 'GET' && $path === '/api/me/wins') {
        [$ctx] = $requireUser();
        $wins = array_values(array_filter(
            (new BidService())->getUserBidRecords($ctx->userId),
            static fn ($r) => $r['status'] === 'won'
        ));
        respond(200, array_map(static fn ($r) => [
            'id'         => $r['itemId'],
            'title'      => $r['title'],
            'category'   => $r['category'],
            'currentBid' => $r['currentBid'],
            'endTime'    => $r['endTime'],
        ], $wins));
    }

    // Helper: require an admin (Admin/SuperAdmin OR the x-admin-token integration).
    $requireAdmin = static function () {
        $ctx = (new AuthMiddleware())->context();
        if (!$ctx->adminAuthorized) {
            respond(403, ['error' => 'Admin access requires an authenticated account with the Admin role.']);
        }
        return $ctx;
    };
    // Helper: require a real SuperAdmin (the admin token does NOT satisfy this).
    $requireSuperAdmin = static function () {
        $ctx = (new AuthMiddleware())->context();
        if (!$ctx->signedIn || !Permissions::isSuperAdmin($ctx->role)) {
            respond(403, ['error' => 'Super admin access is required.']);
        }
        return $ctx;
    };

    // --- Admin: bulk import (CSV + optional ZIP bundle) ----------------------
    if ($method === 'POST' && $path === '/api/items/bulk-import') {
        $ctx = $requireAdmin();
        $csv = $_FILES['csv'] ?? null;
        if (!$csv || (int) ($csv['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            respond(400, ['error' => 'Upload a CSV file first.']);
        }
        $csvContent = (string) file_get_contents($csv['tmp_name']);
        $bundle = $_FILES['bundle'] ?? null;
        $zipPath = ($bundle && (int) ($bundle['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) ? $bundle['tmp_name'] : null;
        $result = (new BulkImportService())->import($ctx, $csvContent, $zipPath);
        respond($result['status'], $result['body']);
    }

    // --- Admin: item create / update / archive / restore ---------------------
    if ($method === 'POST' && $path === '/api/items') {
        $ctx = $requireAdmin();
        $writer = new ItemWriteService();
        $validation = $writer->validateNewItem($_POST);
        if ($validation['ok'] === false) {
            respond(400, ['error' => $validation['error']]);
        }
        $visibility = DocumentVisibility::normalize($_POST['documentVisibility'] ?? 'admin_only');
        $storage = new FileStorage();
        $images = array_map(fn ($f) => $storage->store($f['tmp_name'], $f['name'], 'image', 'bidder_visible', true), uploadedFiles('images'));
        $documents = array_map(fn ($f) => $storage->store($f['tmp_name'], $f['name'], 'document', $visibility, true), uploadedFiles('documents'));
        $itemId = $writer->createItemRecord($ctx, $validation['value'], $images, $documents);
        respond(201, (new ItemReadModel())->getItemById($itemId, true));
    }

    if ($method === 'PATCH' && preg_match('#^/api/items/([^/]+)$#', $path, $m)) {
        $ctx = $requireAdmin();
        $itemId = rawurldecode($m[1]);
        $model = new ItemReadModel();
        if ($model->getItemById($itemId, true) === null) {
            respond(404, ['error' => 'Item not found.']);
        }
        $writer = new ItemWriteService();
        $validation = $writer->validateNewItem($_POST);
        if ($validation['ok'] === false) {
            respond(400, ['error' => $validation['error']]);
        }
        $visibility = DocumentVisibility::normalize($_POST['documentVisibility'] ?? 'admin_only');
        $storage = new FileStorage();
        $images = array_map(fn ($f) => $storage->store($f['tmp_name'], $f['name'], 'image', 'bidder_visible', true), uploadedFiles('images'));
        $documents = array_map(fn ($f) => $storage->store($f['tmp_name'], $f['name'], 'document', $visibility, true), uploadedFiles('documents'));
        $writer->updateItem($ctx, $itemId, $validation['value'], $images, $documents);
        respond(200, $model->getItemById($itemId, true));
    }

    if ($method === 'DELETE' && preg_match('#^/api/items/([^/]+)$#', $path, $m)) {
        $ctx = $requireAdmin();
        $itemId = rawurldecode($m[1]);
        $existing = (new ItemReadModel())->getItemById($itemId, true);
        if ($existing === null) {
            respond(404, ['error' => 'Item not found.']);
        }
        (new ItemWriteService())->archive($ctx, $itemId, $existing['title']);
        respond(200, ['ok' => true]);
    }

    if ($method === 'POST' && preg_match('#^/api/items/([^/]+)/restore$#', $path, $m)) {
        $ctx = $requireAdmin();
        $itemId = rawurldecode($m[1]);
        $model = new ItemReadModel();
        $existing = $model->getItemById($itemId, true);
        if ($existing === null) {
            respond(404, ['error' => 'Item not found.']);
        }
        (new ItemWriteService())->restore($ctx, $itemId, $existing['title']);
        respond(200, $model->getItemById($itemId, true));
    }

    // --- Admin: categories ---------------------------------------------------
    if ($method === 'POST' && $path === '/api/categories') {
        $ctx = $requireAdmin();
        $body = $_POST ?: jsonBody();
        $writer = new ItemWriteService();
        $validation = $writer->validateCategoryName((string) ($body['name'] ?? ''));
        if ($validation['ok'] === false) {
            respond(400, ['error' => $validation['error']]);
        }
        $created = (new CategoryRepository())->upsert($validation['value']);
        (new AuditService())->append($ctx, $created ? 'CATEGORY_CREATED' : 'CATEGORY_RECONFIRMED', 'system', $validation['value'], [
            'category' => $validation['value'], 'created' => $created,
        ]);
        respond($created ? 201 : 200, ['created' => $created]);
    }

    if ($method === 'DELETE' && preg_match('#^/api/categories/([^/]+)$#', $path, $m)) {
        $ctx = $requireAdmin();
        $writer = new ItemWriteService();
        $validation = $writer->validateCategoryName(rawurldecode($m[1]));
        if ($validation['ok'] === false) {
            respond(400, ['error' => $validation['error']]);
        }
        $categories = new CategoryRepository();
        if ($categories->isAssignedToItem($validation['value'])) {
            respond(409, ['error' => 'Category is assigned to one or more items.']);
        }
        if (!$categories->exists($validation['value'])) {
            respond(404, ['error' => 'Category not found.']);
        }
        $categories->delete($validation['value']);
        (new AuditService())->append($ctx, 'CATEGORY_DELETED', 'system', $validation['value'], ['category' => $validation['value']]);
        respond(200, ['ok' => true]);
    }

    // --- Admin/ShopOwner: items CSV export -----------------------------------
    if ($method === 'GET' && $path === '/api/exports/items.csv') {
        [$ctx] = $requireUser();
        if (!Permissions::canViewItemOperations($ctx->role)) {
            respond(403, ['error' => 'Item operations access required.']);
        }
        $model = new ItemReadModel();
        $nowMs = (int) (microtime(true) * 1000);
        $items = array_map(fn ($it) => $model->sanitizeForAuth($it, $ctx), $model->getItems($ctx->adminAuthorized));
        $rows = array_map(function ($item) use ($ctx, $model, $nowMs) {
            $winner = '';
            if ((int) (new DateTimeImmutable($item['endTime']))->format('Uv') <= $nowMs && $item['currentBid'] > 0) {
                foreach ($item['bids'] as $bid) {
                    if ($bid['amount'] === $item['currentBid']) { $winner = $bid['bidder']; break; }
                }
            }
            return [
                'winner' => $winner, 'id' => $item['id'], 'title' => $item['title'], 'category' => $item['category'],
                'lot' => $item['lot'], 'sku' => $item['sku'], 'condition' => $item['condition'], 'location' => $item['location'],
                'startBid' => $item['startBid'], 'reserve' => Permissions::canViewReserve($ctx->role) ? ($item['reserve'] ?? '') : '',
                'increment' => $item['increment'], 'currentBid' => $item['currentBid'], 'reserveOutcome' => $model->reserveState($item),
                'startTime' => $item['startTime'], 'endTime' => $item['endTime'], 'bidCount' => count($item['bids']),
            ];
        }, $items);
        (new AuditService())->append($ctx, 'EXPORT_ITEMS', 'export', 'items.csv', ['rowCount' => count($rows)]);
        sendRaw(200, 'text/csv', Csv::build($rows), ['Content-Disposition' => 'attachment; filename="items.csv"']);
    }

    // --- Admin: ops / audits / notifications / users -------------------------
    if ($method === 'GET' && $path === '/api/exports/audits.csv') {
        $ctx = $requireAdmin();
        $rows = (new AdminService())->auditsCsvRows();
        (new AuditService())->append($ctx, 'EXPORT_AUDITS', 'export', 'audits.csv', ['rowCount' => count($rows)]);
        sendRaw(200, 'text/csv', Csv::build($rows), ['Content-Disposition' => 'attachment; filename="audits.csv"']);
    }

    if ($method === 'GET' && $path === '/api/admin/operations') {
        $requireAdmin();
        respond(200, (new AdminService())->operations());
    }

    if ($method === 'GET' && $path === '/api/admin/reports') {
        $requireAdmin();
        respond(200, (new AdminService())->reports());
    }

    if ($method === 'GET' && $path === '/api/admin/audits') {
        $requireAdmin();
        $result = (new AdminService())->adminAudits([
            'itemId' => (string) ($_GET['itemId'] ?? ''), 'from' => (string) ($_GET['from'] ?? ''),
            'to' => (string) ($_GET['to'] ?? ''), 'eventType' => (string) ($_GET['eventType'] ?? ''),
            'actor' => (string) ($_GET['actor'] ?? ''), 'entityType' => (string) ($_GET['entityType'] ?? ''),
            'includeSecurity' => (string) ($_GET['includeSecurity'] ?? ''),
        ], (int) ($_GET['page'] ?? 1), (int) ($_GET['pageSize'] ?? 20));
        respond(200, $result);
    }

    if ($method === 'GET' && $path === '/api/admin/notifications') {
        $requireSuperAdmin();
        respond(200, (new AdminService())->notifications((int) ($_GET['page'] ?? 1), (int) ($_GET['pageSize'] ?? 20)));
    }

    if ($method === 'POST' && $path === '/api/admin/notifications/process') {
        $requireSuperAdmin();
        respond(200, ['processed' => (new NotificationProcessor())->process()]);
    }

    if ($method === 'GET' && $path === '/api/admin/users') {
        $requireAdmin();
        respond(200, (new AdminService())->listUsersWithRoles());
    }

    if ($method === 'GET' && $path === '/api/admin/roles') {
        $requireAdmin();
        respond(200, (new RoleRepository())->all());
    }

    if ($method === 'POST' && $path === '/api/admin/users/bulk-import') {
        $ctx = $requireSuperAdmin();
        $csv = $_FILES['csv'] ?? null;
        if (!$csv || (int) ($csv['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            respond(400, ['error' => 'Upload a CSV file first.']);
        }
        $result = (new AdminUserService())->bulkImportUsers($ctx, (string) file_get_contents($csv['tmp_name']));
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && $path === '/api/admin/users/password-resets') {
        $ctx = $requireAdmin();
        $body = jsonBody();
        $result = (new AdminUserService())->bulkPasswordResets(
            $ctx,
            (string) ($body['scope'] ?? 'selected'),
            (string) ($body['role'] ?? ''),
            is_array($body['userIds'] ?? null) ? $body['userIds'] : []
        );
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && preg_match('#^/api/admin/users/([^/]+)/roles$#', $path, $m)) {
        $ctx = $requireSuperAdmin();
        $body = jsonBody();
        $result = (new AdminUserService())->assignRole($ctx, rawurldecode($m[1]), (string) ($body['roleName'] ?? ''));
        respond($result['status'], $result['body']);
    }

    if ($method === 'DELETE' && preg_match('#^/api/admin/users/([^/]+)/roles/([^/]+)$#', $path, $m)) {
        $ctx = $requireSuperAdmin();
        $result = (new AdminUserService())->removeRole($ctx, rawurldecode($m[1]), rawurldecode($m[2]));
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && preg_match('#^/api/admin/users/([^/]+)/disable$#', $path, $m)) {
        $ctx = $requireAdmin();
        $result = (new AdminUserService())->disableUser($ctx, rawurldecode($m[1]), (string) (jsonBody()['reason'] ?? ''));
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && preg_match('#^/api/admin/users/([^/]+)/enable$#', $path, $m)) {
        $ctx = $requireAdmin();
        $result = (new AdminUserService())->enableUser($ctx, rawurldecode($m[1]));
        respond($result['status'], $result['body']);
    }

    if ($method === 'POST' && preg_match('#^/api/admin/users/([^/]+)/password-reset$#', $path, $m)) {
        $ctx = $requireAdmin();
        $result = (new AdminUserService())->forcePasswordReset($ctx, rawurldecode($m[1]));
        respond($result['status'], $result['body']);
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
