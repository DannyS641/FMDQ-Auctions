<?php
declare(strict_types=1);

namespace App\Notifications;

/**
 * Minimal dependency-free SMTP client (the nodemailer replacement). Supports
 * STARTTLS (587), implicit SSL (465), or plain, with AUTH LOGIN. Sends a
 * multipart/alternative (text + HTML) message. Throws on any protocol error.
 */
final class SmtpMailer
{
    /** @var resource */
    private $conn;

    /** @param array<string,mixed> $cfg the 'smtp' config section */
    public function __construct(private array $cfg)
    {
    }

    public function send(string $from, string $to, string $subject, string $text, string $html): void
    {
        $host = (string) $this->cfg['host'];
        $port = (int) $this->cfg['port'];
        $secure = (string) ($this->cfg['secure'] ?? 'starttls');
        $timeout = (int) ($this->cfg['timeout'] ?? 15);
        if ($host === '') {
            throw new \RuntimeException('SMTP host is not configured.');
        }

        $transport = $secure === 'ssl' ? "ssl://{$host}" : $host;
        $conn = @stream_socket_client("{$transport}:{$port}", $errno, $errstr, $timeout);
        if ($conn === false) {
            throw new \RuntimeException("SMTP connect failed: {$errstr} ({$errno})");
        }
        stream_set_timeout($conn, $timeout);
        $this->conn = $conn;

        try {
            $this->expect('220');
            $this->ehlo($host);

            if ($secure === 'starttls') {
                $this->cmd('STARTTLS', '220');
                if (!stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT)) {
                    throw new \RuntimeException('STARTTLS negotiation failed.');
                }
                $this->ehlo($host); // re-EHLO over the encrypted channel
            }

            $user = (string) ($this->cfg['user'] ?? '');
            $pass = (string) ($this->cfg['pass'] ?? '');
            if ($user !== '') {
                $this->cmd('AUTH LOGIN', '334');
                $this->cmd(base64_encode($user), '334');
                $this->cmd(base64_encode($pass), '235');
            }

            $this->cmd('MAIL FROM:<' . self::addr($from) . '>', '250');
            $this->cmd('RCPT TO:<' . self::addr($to) . '>', '250');
            $this->cmd('DATA', '354');
            $this->write($this->buildMessage($from, $to, $subject, $text, $html) . "\r\n.");
            $this->expect('250');
            $this->cmd('QUIT', '221');
        } finally {
            @fclose($conn);
        }
    }

    private function ehlo(string $host): void
    {
        $this->cmd('EHLO ' . (gethostname() ?: 'localhost'), '250');
    }

    private function buildMessage(string $from, string $to, string $subject, string $text, string $html): string
    {
        $boundary = 'b' . bin2hex(random_bytes(12));
        $date = gmdate('D, d M Y H:i:s') . ' +0000';
        $headers = [
            'Date: ' . $date,
            'From: ' . $from,
            'To: ' . $to,
            'Subject: ' . self::encodeHeader($subject),
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        ];
        $body = "--{$boundary}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: 8bit\r\n\r\n"
            . self::dotStuff($text) . "\r\n"
            . "--{$boundary}\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: 8bit\r\n\r\n"
            . self::dotStuff($html) . "\r\n"
            . "--{$boundary}--";
        return implode("\r\n", $headers) . "\r\n\r\n" . $body;
    }

    private function cmd(string $line, string $expectedCode): void
    {
        $this->write($line);
        $this->expect($expectedCode);
    }

    private function write(string $line): void
    {
        if (fwrite($this->conn, $line . "\r\n") === false) {
            throw new \RuntimeException('SMTP write failed.');
        }
    }

    /** Read a (possibly multiline) reply and assert the leading code. */
    private function expect(string $code): void
    {
        $line = '';
        do {
            $line = fgets($this->conn, 515);
            if ($line === false) {
                throw new \RuntimeException('SMTP connection closed unexpectedly.');
            }
        } while (strlen($line) >= 4 && $line[3] === '-'); // continuation lines
        if (strncmp($line, $code, 3) !== 0) {
            throw new \RuntimeException('SMTP expected ' . $code . ' but got: ' . trim($line));
        }
    }

    private static function addr(string $value): string
    {
        if (preg_match('/<([^>]+)>/', $value, $m)) {
            return $m[1];
        }
        return trim($value);
    }

    private static function encodeHeader(string $value): string
    {
        return preg_match('/[\x80-\xFF]/', $value)
            ? '=?UTF-8?B?' . base64_encode($value) . '?='
            : $value;
    }

    private static function dotStuff(string $body): string
    {
        // RFC 5321: lines beginning with "." must be escaped as "..".
        $normalized = preg_replace("/\r\n|\r|\n/", "\r\n", $body);
        return preg_replace('/^\./m', '..', $normalized);
    }
}
