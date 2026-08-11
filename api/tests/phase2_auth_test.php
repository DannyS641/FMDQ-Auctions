<?php
/**
 * Phase 2 auth validation. Run with FMDQ_CONFIG_FILE pointing at a test config
 * whose DB is a throwaway MySQL with mysql-schema.sql loaded.
 *
 *   FMDQ_CONFIG_FILE=config/test.php php api/tests/phase2_auth_test.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Auth\AuthService;
use App\Auth\Jwt;
use App\Auth\RoleMapper;
use App\Config;
use App\Database;
use App\Middleware\AuthMiddleware;
use App\Support\Uuid;

$pass = 0;
$fail = 0;
function check(string $label, bool $cond): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ✅ $label\n"; }
    else       { $fail++; echo "  ❌ $label\n"; }
}

$pdo = Database::pdo();
$secret = (string) Config::get('jwt')['secret'];
$cookieName = (string) Config::get('jwt')['cookie_name'];

// --- Clean slate for re-runs -------------------------------------------------
$pdo->exec('DELETE FROM sessions');
$pdo->exec('DELETE FROM user_roles');
$pdo->exec("DELETE FROM users");

// --- Seed test users ---------------------------------------------------------
$extId = Uuid::v4();
$pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,?,?,?,?)')
    ->execute([$extId, 'ext@gmail.com', password_hash('Secret123!', PASSWORD_DEFAULT), 'External User', 'active', 'local']);
$pdo->prepare('INSERT INTO user_roles (user_id,role_name) VALUES (?,?)')->execute([$extId, 'Bidder']);

$disId = Uuid::v4();
$pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,?,?,?,?)')
    ->execute([$disId, 'disabled@gmail.com', password_hash('Secret123!', PASSWORD_DEFAULT), 'Disabled User', 'disabled', 'local']);

$adId = Uuid::v4();
$pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,NULL,?,?,?)')
    ->execute([$adId, 'someone@fmdq.com', 'AD User', 'active', 'ad']);

echo "JWT\n";
$tok = Jwt::sign(['sub' => 'u1', 'exp' => time() + 60], $secret);
check('valid token verifies', Jwt::verify($tok, $secret)['sub'] === 'u1');
check('tampered token rejected', Jwt::verify($tok . 'x', $secret) === null);
check('wrong secret rejected', Jwt::verify($tok, 'other') === null);
check('expired token rejected', Jwt::verify(Jwt::sign(['sub' => 'u1', 'exp' => time() - 1], $secret), $secret) === null);
check('alg:none forgery rejected', Jwt::verify(
    rtrim(strtr(base64_encode('{"alg":"none","typ":"JWT"}'), '+/', '-_'), '=') . '.' .
    rtrim(strtr(base64_encode('{"sub":"hacker"}'), '+/', '-_'), '=') . '.', $secret) === null);

echo "RoleMapper\n";
$map = [
    'CN=Auction-Admins,OU=Groups,DC=fmdq,DC=com'  => 'Admin',
    'CN=Auction-Bidders,OU=Groups,DC=fmdq,DC=com' => 'Bidder',
];
$roles = RoleMapper::map(
    ['cn=auction-admins,ou=groups,dc=fmdq,dc=com'], // different case on purpose
    $map,
    'ShopOwner'
);
check('case-insensitive group match -> Admin', in_array('Admin', $roles, true));
check('default role applied -> ShopOwner', in_array('ShopOwner', $roles, true));
check('unmatched group ignored (no Bidder)', !in_array('Bidder', $roles, true));

echo "AuthService — external (local) path\n";
$svc = new AuthService();
$ok = $svc->login('ext@gmail.com', 'Secret123!');
check('valid local login succeeds', $ok['ok'] === true);
check('returns Bidder role', in_array('Bidder', $ok['user']['roles'], true));
check('auth_source = local', $ok['user']['auth_source'] === 'local');
check('session row created', (int) $pdo->query('SELECT COUNT(*) c FROM sessions')->fetch()['c'] === 1);
check('last_login_at set', $pdo->query("SELECT last_login_at FROM users WHERE id='$extId'")->fetch()['last_login_at'] !== null);

check('wrong password rejected', $svc->login('ext@gmail.com', 'nope')['ok'] === false);
check('disabled account rejected', $svc->login('disabled@gmail.com', 'Secret123!')['ok'] === false);
check('unknown user rejected', $svc->login('ghost@gmail.com', 'whatever')['ok'] === false);
check('AD-source account cannot password-login', $svc->login('someone@fmdq.com', 'Secret123!')['ok'] === false);

echo "AuthService — internal (AD) path\n";
check('internal domain w/ LDAP disabled is rejected', $svc->login('someone@fmdq.com', 'anything')['ok'] === false);

echo "AuthMiddleware — verify + revocation\n";
$login = $svc->login('ext@gmail.com', 'Secret123!');
$_COOKIE[$cookieName] = $login['cookie']['value'];
$mw = new AuthMiddleware();
$authed = $mw->authenticate();
check('middleware authenticates valid cookie', $authed !== null && $authed['user']['email'] === 'ext@gmail.com');
check('middleware loads roles from DB', $authed !== null && in_array('Bidder', $authed['roles'], true));

$svc->logout($authed['jti']);              // logout deletes the session row
check('after logout, token is revoked', $mw->authenticate() === null);

$_COOKIE[$cookieName] = 'not.a.jwt';
check('garbage cookie -> anonymous', $mw->authenticate() === null);

echo "\nRESULT: $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
