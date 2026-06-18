<?php
/**
 * One-time data migration: Supabase -> MySQL.
 *
 *   php api/tools/migrate_from_supabase.php            # DRY RUN (reports only)
 *   php api/tools/migrate_from_supabase.php --confirm  # TRUNCATES + LOADS
 *
 * Pulls table rows via the Supabase REST API and files via the Storage API
 * (creds from .env), transforms to the MySQL schema, downloads bucket files to
 * local storage/uploads, and rewrites item_files.url. Skips transient tables
 * (sessions, verification tokens, idempotency keys, notification_queue).
 *
 * Passwords are NOT carried (scrypt): external users get an unusable hash and
 * must use forgot-password; internal (AD-domain) users get auth_source='ad'.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Config;
use App\Database;
use App\Support\Dates;
use App\Support\Uuid;

$confirm = in_array('--confirm', $argv, true);

// --- Supabase creds from .env ------------------------------------------------
$env = [];
foreach (file(dirname(__DIR__, 2) . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    if ($line[0] === '#' || !str_contains($line, '=')) continue;
    [$k, $v] = explode('=', $line, 2);
    $env[trim($k)] = trim(trim($v), "\"' ");
}
$SUPA = rtrim($env['SUPABASE_URL'] ?? '', '/');
$KEY = $env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
if ($SUPA === '' || $KEY === '') {
    fwrite(STDERR, "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env\n");
    exit(1);
}
$HEADERS = ["apikey: {$KEY}", "Authorization: Bearer {$KEY}"];

function http(string $url, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 40]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, $body === false ? '' : $body];
}
function rest(string $path): array
{
    global $SUPA, $HEADERS;
    [$st, $body] = http("{$SUPA}/rest/v1/{$path}", $HEADERS);
    if ($st !== 200) {
        throw new \RuntimeException("REST {$path} -> HTTP {$st}");
    }
    return json_decode($body, true) ?: [];
}

// --- Pull everything ---------------------------------------------------------
echo "Fetching from Supabase...\n";
$users = rest('users?select=*');
$roles = rest('roles?select=*');
$userRoles = rest('user_roles?select=*');
$categories = rest('categories?select=*');
$items = rest('items?select=*');
$files = rest('item_files?select=id,item_id,kind,name,url');
$bids = rest('bids?select=*');
$audits = rest('audits?select=*');

$internalDomains = array_map('strtolower', Config::get('auth')['internal_email_domains'] ?? []);
$isInternal = static function (string $email) use ($internalDomains): bool {
    $at = strrpos($email, '@');
    return $at !== false && in_array(strtolower(substr($email, $at + 1)), $internalDomains, true);
};

// Classify files (base64 storage path vs plain local).
$decodePath = static function (string $url): ?string {
    $enc = basename($url);
    $dec = base64_decode(strtr($enc, '-_', '+/'), true);
    return ($dec !== false && str_contains($dec, '/')) ? $dec : null;
};
$inBucket = 0; $localOnly = 0;
foreach ($files as $f) {
    $decodePath($f['url']) !== null ? $inBucket++ : $localOnly++;
}

echo "\n  users={" . count($users) . "} roles={" . count($roles) . "} user_roles={" . count($userRoles)
   . "} categories={" . count($categories) . "}\n";
echo "  items={" . count($items) . "} item_files={" . count($files) . "} bids={" . count($bids)
   . "} audits={" . count($audits) . "}\n";
echo "  files in buckets: {$inBucket}  local-only (will be broken links): {$localOnly}\n";
$internalCount = count(array_filter($users, fn ($u) => $isInternal($u['email'])));
echo "  users -> internal(AD): {$internalCount}, external(local, must reset password): " . (count($users) - $internalCount) . "\n";

if (!$confirm) {
    echo "\nDRY RUN complete. Re-run with --confirm to TRUNCATE current data and load.\n";
    exit(0);
}

// --- Load --------------------------------------------------------------------
$pdo = Database::pdo();
$uploadsDir = (string) (Config::load()['storage']['uploads_dir'] ?? '') ?: dirname(__DIR__, 2) . '/storage/uploads';

echo "\nTruncating current tables...\n";
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');
foreach (['item_files', 'bids', 'bid_idempotency_keys', 'audits', 'security_events', 'notification_queue',
          'email_verification_tokens', 'sessions', 'user_roles', 'items', 'users', 'categories', 'roles'] as $t) {
    $pdo->exec("TRUNCATE TABLE {$t}");
}
$pdo->exec('SET FOREIGN_KEY_CHECKS=1');

$toDb = static fn (?string $iso): ?string => $iso ? (new \DateTimeImmutable($iso, new \DateTimeZone('UTC')))
    ->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u') : null;

// roles (union of imported + the app's known roles)
$roleNames = array_unique(array_merge(
    array_map(fn ($r) => $r['name'], $roles),
    ['Admin', 'Bidder', 'Observer']
));
$rstmt = $pdo->prepare('INSERT INTO roles (name) VALUES (:n) ON DUPLICATE KEY UPDATE name = name');
foreach ($roleNames as $n) { $rstmt->execute([':n' => $n]); }

// categories
$cstmt = $pdo->prepare('INSERT INTO categories (name) VALUES (:n) ON DUPLICATE KEY UPDATE name = name');
foreach ($categories as $c) { $cstmt->execute([':n' => $c['name']]); }

// users
$ustmt = $pdo->prepare(
    'INSERT INTO users (id,email,password_hash,display_name,status,auth_source,created_at,last_login_at)
     VALUES (:id,:email,:hash,:dn,:status,:src,:created,:last)'
);
foreach ($users as $u) {
    $internal = $isInternal($u['email']);
    $ustmt->execute([
        ':id' => $u['id'], ':email' => $u['email'],
        ':hash' => $internal ? null : password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        ':dn' => $u['display_name'], ':status' => $u['status'], ':src' => $internal ? 'ad' : 'local',
        ':created' => $toDb($u['created_at']), ':last' => $toDb($u['last_login_at'] ?? null),
    ]);
}

// user_roles
$urstmt = $pdo->prepare('INSERT IGNORE INTO user_roles (user_id, role_name, created_at) VALUES (:uid,:role,:created)');
foreach ($userRoles as $ur) {
    $urstmt->execute([':uid' => $ur['user_id'], ':role' => $ur['role_name'], ':created' => $toDb($ur['created_at'] ?? null) ?? Dates::nowUtc()]);
}

// items
$istmt = $pdo->prepare(
    'INSERT INTO items (id,title,category,lot,sku,`condition`,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description,created_at,archived_at)
     VALUES (:id,:title,:cat,:lot,:sku,:cond,:loc,:sb,:res,:inc,:cur,:st,:et,:desc,:created,:arch)'
);
foreach ($items as $it) {
    $istmt->execute([
        ':id' => $it['id'], ':title' => $it['title'], ':cat' => $it['category'], ':lot' => $it['lot'], ':sku' => $it['sku'],
        ':cond' => $it['condition'], ':loc' => $it['location'], ':sb' => $it['start_bid'], ':res' => $it['reserve'],
        ':inc' => $it['increment_amount'], ':cur' => $it['current_bid'], ':st' => $toDb($it['start_time']),
        ':et' => $toDb($it['end_time']), ':desc' => $it['description'] ?? '', ':created' => $toDb($it['created_at']),
        ':arch' => $toDb($it['archived_at'] ?? null),
    ]);
}

// item_files (download bucket files, rewrite url)
$fstmt = $pdo->prepare('INSERT INTO item_files (id,item_id,kind,name,url) VALUES (:id,:item,:kind,:name,:url)');
$broken = [];
$downloaded = 0;
foreach ($files as $f) {
    $url = $f['url'];
    $path = $decodePath($url);
    if ($path !== null) {
        $bucket = $f['kind'] === 'image' ? 'auction-images' : 'auction-documents';
        [$st, $bytes] = http("{$SUPA}/storage/v1/object/{$bucket}/" . rawurlencode($path), $HEADERS);
        // rawurlencode encodes slashes; Supabase wants raw path -> retry unencoded if needed
        if ($st !== 200) {
            [$st, $bytes] = http("{$SUPA}/storage/v1/object/{$bucket}/{$path}", $HEADERS);
        }
        if ($st === 200 && $bytes !== '') {
            $sub = $f['kind'] === 'image' ? 'images' : 'documents';
            $ext = pathinfo($path, PATHINFO_EXTENSION) ?: ($f['kind'] === 'image' ? 'jpg' : 'pdf');
            $dir = "{$uploadsDir}/{$sub}";
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            $newName = Uuid::v4() . '.' . $ext;
            file_put_contents("{$dir}/{$newName}", $bytes);
            $url = "/uploads/{$sub}/{$newName}";
            $downloaded++;
        } else {
            $broken[] = "{$f['kind']} {$f['name']} (bucket {$bucket} HTTP {$st})";
        }
    } else {
        $broken[] = "{$f['kind']} {$f['name']} (local-only, file not in Supabase)";
    }
    $fstmt->execute([':id' => $f['id'], ':item' => $f['item_id'], ':kind' => $f['kind'], ':name' => $f['name'], ':url' => $url]);
}

// bids
$bstmt = $pdo->prepare(
    'INSERT INTO bids (id,item_id,bidder_alias,bidder_user_id,amount,bid_time,created_at)
     VALUES (:id,:item,:alias,:uid,:amount,:btime,:created)'
);
foreach ($bids as $b) {
    $bstmt->execute([
        ':id' => $b['id'], ':item' => $b['item_id'], ':alias' => $b['bidder_alias'],
        ':uid' => $b['bidder_user_id'] ?? null, ':amount' => $b['amount'], ':btime' => $b['bid_time'],
        ':created' => $toDb($b['created_at']),
    ]);
}

// audits
$astmt = $pdo->prepare(
    'INSERT INTO audits (id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at)
     VALUES (:id,:et,:ent,:eid,:actor,:at,:rid,:details,:created)'
);
foreach ($audits as $a) {
    $details = is_array($a['details_json']) ? $a['details_json'] : (json_decode((string) $a['details_json'], true) ?: []);
    $astmt->execute([
        ':id' => $a['id'], ':et' => $a['event_type'], ':ent' => $a['entity_type'], ':eid' => $a['entity_id'],
        ':actor' => $a['actor'], ':at' => $a['actor_type'], ':rid' => $a['request_id'],
        ':details' => json_encode($details, JSON_UNESCAPED_SLASHES), ':created' => $toDb($a['created_at']),
    ]);
}

echo "\n✅ Load complete.\n";
echo "  inserted: users=" . count($users) . " items=" . count($items) . " item_files=" . count($files)
   . " bids=" . count($bids) . " audits=" . count($audits) . "\n";
echo "  files downloaded from buckets: {$downloaded}\n";
if ($broken) {
    echo "  ⚠️ broken/missing files (" . count($broken) . "):\n";
    foreach ($broken as $b) echo "     - {$b}\n";
}
echo "  NOTE: external users must use forgot-password (scrypt passwords not carried).\n";
