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

        $pdo = new PDO($dsn, $db['user'], $db['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        // App works entirely in UTC; pin the session timezone so NOW()/CURRENT_TIMESTAMP match.
        $pdo->exec("SET time_zone = '+00:00'");

        return self::$pdo = $pdo;
    }
}
