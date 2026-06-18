<?php
/**
 * Dev helper: create/refresh a demo EXTERNAL (local) login account so you can
 * try the auth flow in the browser. Safe to re-run.
 *
 *   php api/tools/seed_demo_user.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Database;
use App\Support\Uuid;

$email = 'demo@auction.test';
$password = 'Demo12345!';
$display = 'Demo Bidder';
$role = 'Bidder';

$pdo = Database::pdo();

$existing = $pdo->prepare('SELECT id FROM users WHERE email = ?');
$existing->execute([$email]);
$row = $existing->fetch();

if ($row) {
    $id = (string) $row['id'];
    $pdo->prepare('UPDATE users SET password_hash = ?, display_name = ?, status = ?, auth_source = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), $display, 'active', 'local', $id]);
} else {
    $id = Uuid::v4();
    $pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,?,?,?,?)')
        ->execute([$id, $email, password_hash($password, PASSWORD_DEFAULT), $display, 'active', 'local']);
}

$pdo->prepare('INSERT IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)')->execute([$id, $role]);

echo "Demo user ready:\n  email:    {$email}\n  password: {$password}\n  role:     {$role}\n";
