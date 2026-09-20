<?php
declare(strict_types=1);

namespace App;

use PDO;

/**
 * PDO (MySQL) connection factory. Single shared connection per request.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $db = Config::get('db');

        if (!empty($db['unix_socket'])) {
            $dsn = sprintf('mysql:unix_socket=%s;dbname=%s;charset=%s', $db['unix_socket'], $db['dbname'], $db['charset']);
        } else {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $db['host'], (int) $db['port'], $db['dbname'], $db['charset']);
        }

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        // A non-local DB host means credentials and query data would otherwise
        // cross the network in the clear. Require TLS in that case; set
        // db.ssl_ca in config to a CA bundle path if the server's certificate
        // isn't already publicly trusted.
        $isRemoteHost = empty($db['unix_socket'])
            && !in_array(strtolower((string) ($db['host'] ?? '')), ['127.0.0.1', 'localhost', '::1'], true);
        if ($isRemoteHost) {
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = ($db['ssl_verify'] ?? true) !== false;
            if (!empty($db['ssl_ca'])) {
                $options[PDO::MYSQL_ATTR_SSL_CA] = (string) $db['ssl_ca'];
            }
        }

        $pdo = new PDO($dsn, $db['user'], $db['pass'], $options);
        // App works entirely in UTC; pin the session timezone so NOW()/CURRENT_TIMESTAMP match.
        $pdo->exec("SET time_zone = '+00:00'");

        return self::$pdo = $pdo;
    }
}
