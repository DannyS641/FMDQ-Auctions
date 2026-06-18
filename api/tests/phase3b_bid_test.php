<?php
/**
 * Phase 3b: atomic bid transaction + user bid records. Runs against the
 * configured DB (MAMP). Seeds its own isolated item.
 *
 *   php api/tests/phase3b_bid_test.php
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Bidding\BidService;
use App\Catalog\ItemReadModel;
use App\Database;
use App\Support\Uuid;

$pass = 0; $fail = 0;
function check(string $label, bool $cond): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ✅ $label\n"; } else { $fail++; echo "  ❌ $label\n"; }
}

$pdo = Database::pdo();
$itemId = 'test-bid-item';

// Seed bidder + fresh item (currentBid 0, start 100000, increment 10000, live).
$s = $pdo->prepare('SELECT id FROM users WHERE email = ?'); $s->execute(['alice@gmail.com']); $row = $s->fetch();
$alice = $row ? (string) $row['id'] : Uuid::v4();
if (!$row) {
    $pdo->prepare('INSERT INTO users (id,email,password_hash,display_name,status,auth_source) VALUES (?,?,?,?,?,?)')
        ->execute([$alice, 'alice@gmail.com', password_hash('Secret123!', PASSWORD_DEFAULT), 'Alice A', 'active', 'local']);
}
$pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$itemId]);
$pdo->prepare(
    'INSERT INTO items (id,title,category,lot,sku,`condition`,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, UTC_TIMESTAMP(6) - INTERVAL 1 HOUR, UTC_TIMESTAMP(6) + INTERVAL 2 DAY, ?)'
)->execute([$itemId, 'Bid Test Item', 'Cars', 'LOT-T', 'SKU-T', 'New', 'Lagos', 100000, 0, 10000, 0, '']);

$svc = new BidService();
$model = new ItemReadModel();
$load = fn () => $model->getItemById($itemId);

echo "Atomic placement\n";
$r1 = $svc->placeBidAtomically($load(), 110000, 0, $alice, '');
check('first valid bid ok (110000)', $r1['ok'] === true && $r1['currentBid'] === 110000.0 && $r1['bidSequence'] === 1);
check('item.currentBid updated to 110000', $load()['currentBid'] === 110000.0);

$tooLow = $svc->placeBidAtomically($load(), 110000, 110000, $alice, '');
check('too-low rejected (status 400)', $tooLow['ok'] === false && $tooLow['status'] === 400);

$badInc = $svc->placeBidAtomically($load(), 125000, 110000, $alice, '');
check('bad-increment rejected (status 400)', $badInc['ok'] === false && $badInc['status'] === 400);

$stale = $svc->placeBidAtomically($load(), 120000, 0, $alice, '');
check('stale expectedCurrentBid rejected (409)', $stale['ok'] === false && $stale['status'] === 409);
check('no partial write after failures (still 110000)', $load()['currentBid'] === 110000.0);

echo "Idempotency\n";
$r2 = $svc->placeBidAtomically($load(), 120000, 110000, $alice, 'KEY-1');
check('second valid bid ok with key (120000, seq 2)', $r2['ok'] === true && $r2['bidSequence'] === 2);
check('previous leader is alice', $r2['previousBidderUserId'] === $alice);

$replay = $svc->placeBidAtomically($load(), 120000, 999999, $alice, 'KEY-1'); // wrong expected on purpose
check('idempotent replay returns duplicate=true (ignores state)', $replay['ok'] === true && $replay['duplicate'] === true);
check('replay did not create a new bid', (int) $pdo->query("SELECT COUNT(*) c FROM bids WHERE item_id='$itemId'")->fetch()['c'] === 2);

$conflict = $svc->placeBidAtomically($load(), 130000, 120000, $alice, 'KEY-1'); // same key, different amount
check('idempotency key conflict rejected (409)', $conflict['ok'] === false && $conflict['status'] === 409);

echo "Bidding closed\n";
$pdo->prepare('UPDATE items SET end_time = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE WHERE id = ?')->execute([$itemId]);
$closed = $svc->placeBidAtomically($load(), 130000, 120000, $alice, '');
check('closed auction rejected (400)', $closed['ok'] === false && $closed['status'] === 400);
$pdo->prepare('UPDATE items SET end_time = UTC_TIMESTAMP(6) + INTERVAL 2 DAY WHERE id = ?')->execute([$itemId]);

echo "User bid records\n";
$records = $svc->getUserBidRecords($alice);
$thisItem = null;
foreach ($records as $rec) { if ($rec['itemId'] === $itemId) { $thisItem = $rec; break; } }
check('alice has a record for the item', $thisItem !== null);
check('status is winning (live + leader)', $thisItem && $thisItem['status'] === 'winning');
check('yourLatestBid is 120000', $thisItem && $thisItem['yourLatestBid'] === 120000.0);

// cleanup
$pdo->prepare('DELETE FROM items WHERE id = ?')->execute([$itemId]);

echo "\nRESULT: $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
