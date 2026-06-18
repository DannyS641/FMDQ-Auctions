<?php
/**
 * Dev helper: seed one auction item with images, documents (varied visibility),
 * and two bids from two users, so the catalog read + sanitization can be tried.
 * Safe to re-run (clears its own demo rows first).
 *
 *   php api/tools/seed_demo_catalog.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Database;
use App\Support\Uuid;

$pdo = Database::pdo();
$itemId = 'demo-item-0001';

// clean previous demo rows
$pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$itemId]); // cascades files/bids

// two bidder users (re-use or create)
function ensureUser(\PDO $pdo, string $email, string $name): string {
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    $row = $s->fetch();
    if ($row) return (string) $row['id'];
    $id = \App\Support\Uuid::v4();
    $pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,?,?,?,?)')
        ->execute([$id, $email, password_hash('Secret123!', PASSWORD_DEFAULT), $name, 'active', 'local']);
    $pdo->prepare('INSERT IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)')->execute([$id, 'Bidder']);
    return $id;
}
$alice = ensureUser($pdo, 'alice@gmail.com', 'Alice A');
$bob   = ensureUser($pdo, 'bob@gmail.com', 'Bob B');

// item: live auction, reserve 500000, current bid 120000
$pdo->prepare(
    'INSERT INTO items (id,title,category,lot,sku,`condition`,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(6) - INTERVAL 1 DAY, UTC_TIMESTAMP(6) + INTERVAL 3 DAY, ?)'
)->execute([$itemId, 'Demo Toyota Camry', 'Cars', 'LOT-001', 'SKU-001', 'Used', 'Lagos', 100000, 500000, 10000, 120000, 'A clean demo car.']);

// files: one image, three documents with different visibilities (vis: prefix)
$pdo->prepare('INSERT INTO item_files (id,item_id,kind,name,url) VALUES (?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'image', 'front.jpg', '/uploads/images/front.jpg']);
$pdo->prepare('INSERT INTO item_files (id,item_id,kind,name,url) VALUES (?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'document', 'vis:bidder_visible::inspection.pdf', '/uploads/documents/inspection.pdf']);
$pdo->prepare('INSERT INTO item_files (id,item_id,kind,name,url) VALUES (?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'document', 'vis:admin_only::ownership.pdf', '/uploads/documents/ownership.pdf']);
$pdo->prepare('INSERT INTO item_files (id,item_id,kind,name,url) VALUES (?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'document', 'vis:winner_only::handover.pdf', '/uploads/documents/handover.pdf']);

// two bids: bob 110000, alice 120000 (current leader)
$pdo->prepare('INSERT INTO bids (id,item_id,bidder_alias,bidder_user_id,amount,bid_time) VALUES (?,?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'Bidder-001', $bob, 110000, '09:00']);
$pdo->prepare('INSERT INTO bids (id,item_id,bidder_alias,bidder_user_id,amount,bid_time) VALUES (?,?,?,?,?,?)')
    ->execute([Uuid::v4(), $itemId, 'Bidder-002', $alice, 120000, '09:05']);

echo "Seeded item {$itemId} with 1 image, 3 docs (bidder/admin/winner), 2 bids.\n";
echo "Bidders: alice@gmail.com, bob@gmail.com (password Secret123!)\n";
