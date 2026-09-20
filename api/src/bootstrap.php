<?php
/**
 * Minimal PSR-4-ish autoloader + config bootstrap (no Composer dependency).
 * Maps the App\ namespace to api/src/.
 */
declare(strict_types=1);

// Defense-in-depth: never let a raw stack trace / file path reach the client,
// even for a fatal error that happens before index.php's top-level try/catch
// can run (e.g. during autoload). The real production setting still belongs
// in php.ini, but this doesn't rely on that being configured correctly.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

require __DIR__ . '/Config.php';
