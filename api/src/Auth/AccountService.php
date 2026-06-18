<?php
declare(strict_types=1);

namespace App\Auth;

use App\Audit\AuditService;
use App\Config;
use App\Notifications\NotificationQueue;
use App\Repository\EmailVerificationRepository;
use App\Repository\SessionRepository;
use App\Repository\UserRepository;

/**
 * External-account lifecycle (port of the register / verify / resend /
 * password-reset routes in register-auth-routes.ts). Each method returns
 * {status, body} for the front controller to emit. Responses are written to
 * avoid disclosing whether an account exists.
 */
final class AccountService
{
    public function __construct(
        private UserRepository $users = new UserRepository(),
        private EmailVerificationRepository $verifications = new EmailVerificationRepository(),
        private SessionRepository $sessions = new SessionRepository(),
        private NotificationQueue $notifications = new NotificationQueue(),
        private AuditService $audit = new AuditService(),
    ) {
    }

    /** @return array{status:int,body:array<string,mixed>} */
    public function register(string $emailRaw, string $password, string $displayNameRaw): array
    {
        $email = Credentials::normalizeEmail($emailRaw);
        $displayName = Credentials::sanitizeDisplayName($displayNameRaw);
        if ($email === '' || $displayName === '' || $password === '') {
            return $this->err(400, 'Display name, email, and password are required.');
        }
        if (!Credentials::isStrongPassword($password)) {
            return $this->err(400, Credentials::PASSWORD_RULE_MESSAGE);
        }
        if ($this->users->findByEmail($email) !== null) {
            return $this->err(409, 'An account with that email already exists.');
        }

        $userId = $this->users->createLocalPending($email, password_hash($password, PASSWORD_DEFAULT), $displayName);
        $this->users->assignRole($userId, 'Bidder');
        $verifyUrl = $this->issueVerification($userId, $email, $displayName);

        $this->audit->append(AuthContext::guest(), 'ACCOUNT_REGISTERED', 'system', $userId, [
            'email' => $email, 'status' => 'pending_verification',
        ], $displayName);

        return ['status' => 201, 'body' => [
            'registered' => true,
            'verificationRequired' => true,
            'email' => $email,
            // Only surfaced in dev (file transport) so you can verify without email.
            'verificationUrl' => $this->devLink($verifyUrl),
            'message' => 'Account created. Check your email to verify your account, then sign in.',
        ]];
    }

    /** @return array{status:int,body:array<string,mixed>} */
    public function resendVerification(string $emailRaw): array
    {
        $email = Credentials::normalizeEmail($emailRaw);
        if ($email === '') {
            return $this->err(400, 'Email is required.');
        }
        $user = $this->users->findByEmail($email);
        if ($user === null || ($user['status'] ?? '') !== 'pending_verification') {
            return ['status' => 200, 'body' => ['queued' => true, 'message' => 'If a pending account exists for that email, a fresh verification link has been sent.']];
        }
        $this->issueVerification((string) $user['id'], (string) $user['email'], (string) $user['display_name']);
        $this->audit->append(AuthContext::guest(), 'ACCOUNT_VERIFICATION_RESENT', 'system', (string) $user['id'], [
            'email' => $user['email'],
        ], (string) $user['display_name']);
        return ['status' => 200, 'body' => ['queued' => true, 'message' => 'A new verification link has been sent to your email.']];
    }

    /** @return array{status:int,body:array<string,mixed>} */
    public function verifyEmail(string $token): array
    {
        $token = trim($token);
        if ($token === '') {
            return $this->err(400, 'Verification token is required.');
        }
        $row = $this->verifications->findByToken($token);
        if ($row === null) {
            return $this->err(404, 'Verification link is invalid or has already been used.');
        }
        if (strtotime((string) $row['expires_at'] . ' UTC') <= time()) {
            $this->verifications->deleteByToken($token);
            return $this->err(410, 'Verification link has expired. Please create your account again or request a new link.');
        }
        $user = $this->users->findById((string) $row['user_id']);
        if ($user === null) {
            $this->verifications->deleteByToken($token);
            return $this->err(404, 'Account not found for this verification link.');
        }
        $this->users->setStatus((string) $user['id'], 'active');
        $this->verifications->deleteForUser((string) $user['id']);
        $this->notifications->enqueue('ACCOUNT_VERIFIED', 'FMDQ Auctions account verified', [
            'email' => $user['email'], 'displayName' => $user['display_name'],
        ], (string) $user['email']);
        $this->audit->append(AuthContext::guest(), 'ACCOUNT_VERIFIED', 'system', (string) $user['id'], [
            'email' => $user['email'],
        ], (string) $user['display_name']);
        return ['status' => 200, 'body' => ['verified' => true, 'message' => 'Your account is verified. You can now sign in.']];
    }

    /** @return array{status:int,body:array<string,mixed>} */
    public function requestPasswordReset(string $emailRaw): array
    {
        $email = Credentials::normalizeEmail($emailRaw);
        if ($email === '') {
            return $this->err(400, 'Email is required.');
        }
        $user = $this->users->findByEmail($email);
        if ($user !== null && ($user['status'] ?? '') === 'active') {
            $this->queuePasswordReset($user, 'self-service');
            $this->audit->append(AuthContext::guest(), 'PASSWORD_RESET_REQUESTED', 'system', (string) $user['id'], [
                'email' => $user['email'], 'channel' => 'email',
            ], (string) $user['display_name']);
        }
        return ['status' => 200, 'body' => ['requested' => true, 'message' => 'If an active account exists for that email, a password reset link has been sent.']];
    }

    /** @return array{status:int,body:array<string,mixed>} */
    public function resetPassword(string $token, string $password): array
    {
        $token = trim($token);
        if ($token === '' || $password === '') {
            return $this->err(400, 'Token and new password are required.');
        }
        if (!Credentials::isStrongPassword($password)) {
            return $this->err(400, Credentials::PASSWORD_RULE_MESSAGE);
        }
        $payload = SignedToken::parse($token);
        if ($payload === null || ($payload['type'] ?? '') !== 'password-reset') {
            return $this->err(400, 'Password reset link is invalid.');
        }
        if (strtotime((string) ($payload['exp'] ?? '')) <= time()) {
            return $this->err(410, 'Password reset link has expired.');
        }
        $user = $this->users->findById((string) ($payload['sub'] ?? ''));
        if ($user === null || ($user['status'] ?? '') !== 'active') {
            return $this->err(404, 'Account not found for this reset link.');
        }
        if (self::passwordHashFingerprint((string) ($user['password_hash'] ?? '')) !== ($payload['fp'] ?? '')) {
            return $this->err(409, 'This reset link is no longer valid. Request a new one.');
        }
        $this->users->setPasswordHash((string) $user['id'], password_hash($password, PASSWORD_DEFAULT));
        $this->sessions->deleteAllForUser((string) $user['id']); // force re-login everywhere
        $this->notifications->enqueue('PASSWORD_CHANGED', 'Your FMDQ Auctions password was changed', [
            'email' => $user['email'], 'displayName' => $user['display_name'],
        ], (string) $user['email']);
        $this->audit->append(AuthContext::guest(), 'PASSWORD_RESET_COMPLETED', 'system', (string) $user['id'], [
            'email' => $user['email'],
        ], (string) $user['display_name']);
        return ['status' => 200, 'body' => ['reset' => true, 'message' => 'Your password has been reset. Sign in with your new password.']];
    }

    // --- helpers -------------------------------------------------------------

    private function issueVerification(string $userId, string $email, string $displayName): string
    {
        $ttl = (int) (Config::get('auth')['email_verification_ttl_seconds'] ?? 86400);
        $token = $this->verifications->create($userId, $ttl);
        $verifyUrl = $this->baseUrl() . '/verify?token=' . rawurlencode($token);
        $this->notifications->enqueue('ACCOUNT_VERIFICATION', 'Confirm your FMDQ Auctions account', [
            'email' => $email, 'displayName' => $displayName, 'verifyUrl' => $verifyUrl,
        ], $email);
        return $verifyUrl;
    }

    /** @param array<string,mixed> $user */
    private function queuePasswordReset(array $user, string $triggeredBy): void
    {
        $ttl = (int) (Config::get('auth')['password_reset_ttl_seconds'] ?? 3600);
        $expiresAt = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->modify("+{$ttl} seconds")->format('Y-m-d\TH:i:s.v\Z');
        $token = SignedToken::sign([
            'type' => 'password-reset',
            'sub' => (string) $user['id'],
            'email' => (string) $user['email'],
            'exp' => $expiresAt,
            'fp' => self::passwordHashFingerprint((string) ($user['password_hash'] ?? '')),
        ]);
        $resetUrl = $this->baseUrl() . '/reset-password?token=' . rawurlencode($token);
        $this->notifications->enqueue('PASSWORD_RESET', 'Reset your FMDQ Auctions password', [
            'email' => (string) $user['email'], 'displayName' => (string) $user['display_name'],
            'resetUrl' => $resetUrl, 'expiresAt' => $expiresAt, 'triggeredBy' => $triggeredBy,
        ], (string) $user['email']);
    }

    private static function passwordHashFingerprint(string $passwordHash): string
    {
        $secret = (string) Config::get('jwt')['secret'];
        return substr(hash_hmac('sha256', $passwordHash, $secret), 0, 24);
    }

    private function baseUrl(): string
    {
        return rtrim((string) (Config::load()['app']['base_url'] ?? ''), '/');
    }

    private function devLink(string $url): ?string
    {
        $transport = (string) (Config::load()['notify']['transport'] ?? 'file');
        return $transport === 'file' ? $url : null;
    }

    /** @return array{status:int,body:array<string,mixed>} */
    private function err(int $status, string $message): array
    {
        return ['status' => $status, 'body' => ['error' => $message]];
    }
}
