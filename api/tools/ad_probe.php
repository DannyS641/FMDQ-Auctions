<?php
/**
 * AD endpoint diagnostic. Calls the goldhive endpoint EXACTLY like the app does,
 * and prints the raw result so you can see what's really happening.
 *
 *   php api/tools/ad_probe.php <username> <password>
 *
 * Run it on the FMDQ office network (or the office server) where the firewall
 * trusts the machine. It does NOT log you in — it only shows the response.
 */
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Config;

$cfg = Config::load()['ad_endpoint'] ?? [];
$user = $argv[1] ?? 'test.user';
$pass = $argv[2] ?? 'test-password';

if (empty($cfg['enabled'])) {
    fwrite(STDERR, "ad_endpoint is not enabled in config/auth.php\n");
    exit(1);
}

$headers = ['Content-Type: application/json', 'Accept: application/json'];
if (!empty($cfg['api_key'])) {
    $headers[] = ((string) ($cfg['api_key_header'] ?? 'Authorization')) . ': ' . $cfg['api_key'];
}
$body = json_encode([
    (string) ($cfg['username_field'] ?? 'username') => $user,
    (string) ($cfg['password_field'] ?? 'password') => $pass,
]);

$ch = curl_init((string) $cfg['endpoint']);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => (int) ($cfg['timeout'] ?? 10),
    CURLOPT_USERAGENT => (string) ($cfg['user_agent']
        ?? 'Mozilla/5.0 (FMDQ-Auctions-Server) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'),
]);
// Pass --insecure to skip SSL verification (local dev diagnosis only).
if (in_array('--insecure', $argv, true) || (array_key_exists('ssl_verify', $cfg) && $cfg['ssl_verify'] === false)) {
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
}
if (!empty($cfg['cacert_file'])) {
    curl_setopt($ch, CURLOPT_CAINFO, (string) $cfg['cacert_file']);
}
$raw = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

echo "URL:    {$cfg['endpoint']}\n";
echo "Sent:   {$user} / (password hidden)\n";
echo str_repeat('-', 60) . "\n";

if ($raw === false) {
    echo "RESULT: could not connect — {$err}\n";
    echo "  -> network/firewall is blocking the server from reaching goldhive.\n";
    exit(0);
}

echo "HTTP status: {$status}\n\n";
$snippet = substr((string) $raw, 0, 800);

if ($status === 404) {
    echo "DIAGNOSIS: 404 Not Found — the URL path is wrong. Get the correct\n";
    echo "           endpoint URL from the goldhive/IT team.\n";
} elseif (stripos((string) $raw, 'Web Application Firewall') !== false || stripos((string) $raw, 'blocked') !== false) {
    echo "DIAGNOSIS: blocked by the firewall (WAF). Run this from inside the\n";
    echo "           FMDQ network, or ask IT to allow this machine/server.\n";
} elseif (($data = json_decode((string) $raw, true)) !== null) {
    echo "DIAGNOSIS: got JSON back. Here are the fields the app looks for:\n";
    foreach (['authenticated_path' => 'authenticated', 'email_path' => 'email',
              'display_name_path' => 'displayName', 'groups_path' => 'groups'] as $key => $def) {
        $path = (string) ($cfg[$key] ?? $def);
        $val = $data[$path] ?? '(not present at "' . $path . '")';
        echo "  - {$path}: " . (is_scalar($val) ? $val : json_encode($val)) . "\n";
    }
    echo "\n  If the field names above say '(not present)', tell me the real\n";
    echo "  field names from the response below and I'll adjust the config.\n";
} else {
    echo "DIAGNOSIS: non-JSON response (see below).\n";
}

echo "\n--- raw response (first 800 chars) ---\n{$snippet}\n";
