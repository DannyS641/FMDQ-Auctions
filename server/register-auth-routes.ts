import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuthContext, Role, SessionRow, UserRow } from "./server-types.js";

type AsyncRouteHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

type AuthRoleRow = { role_name: string };
type StoredBidRecord = { status: string };
type StoredItemSummary = { endTime: string; currentBid: number; reserve?: number };
type EmailVerificationRow = { id: string; user_id: string; token: string; created_at: string; expires_at: string };

type RegisterAuthRoutesOptions = {
  app: express.Express;
  supabase: SupabaseClient;
  asyncHandler: (fn: AsyncRouteHandler) => express.RequestHandler;
  serializeSession: (req: express.Request) => Promise<unknown>;
  normalizeEmail: (value: string) => string;
  sanitizeDisplayName: (value: string) => string;
  checkAuthRateLimit: (req: express.Request, key: string) => Promise<boolean>;
  getClientKey: (req: express.Request, scope?: string) => string;
  getUserByEmail: (email: string) => Promise<(UserRow & { password_hash?: string }) | null>;
  getUserById: (id: string) => Promise<UserRow | null>;
  getUserByIdWithPassword: (id: string) => Promise<(UserRow & { password_hash?: string }) | null>;
  getUserRoles: (userId: string) => Promise<AuthRoleRow[]>;
  getUserSessions: (userId: string) => Promise<SessionRow[]>;
  getSessionRow: (sessionId: string) => Promise<SessionRow | null>;
  deleteSessionRow: (sessionId: string) => Promise<void>;
  createUserSession: (res: express.Response, userId: string) => Promise<{ sessionId: string }>;
  getAuthContext: (req: express.Request) => Promise<AuthContext>;
  normalizeRole: (roles: string[]) => Role;
  normalizeDisplayRoleName: (role: string) => string;
  createEmailVerificationToken: (userId: string) => Promise<{ verifyUrl: string }>;
  getEmailVerificationRow: (token: string) => Promise<EmailVerificationRow | null>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
  queuePasswordReset: (user: UserRow & { password_hash?: string }, triggeredBy?: string) => Promise<unknown>;
  appendAudit: (req: express.Request, entry: AuditEntry) => Promise<void>;
  notificationTransport: string;
  isStrongPassword: (value: string) => boolean;
  passwordRuleMessage: string;
  handleSupabase: <T>(result: { data: T; error: { message: string } | null }) => T;
  hashPassword: (value: string) => string;
  verifyPassword: (value: string, hash: string) => boolean;
  buildCsrfToken: (sessionId: string) => string;
  parseSignedToken: <T>(token: string) => T | null;
  passwordHashFingerprint: (passwordHash: string) => string;
  parseCookies: (req: express.Request) => Record<string, string>;
  sessionCookieName: string;
  clearSessionCookie: (res: express.Response) => void;
  getUserBidRecords: (userId: string) => Promise<StoredBidRecord[]>;
  getItems: (includeArchived?: boolean) => Promise<StoredItemSummary[]>;
  getReserveState: (item: StoredItemSummary) => string;
  randomUUID: () => string;
};

export const registerAuthRoutes = ({
  app,
  supabase,
  asyncHandler,
  serializeSession,
  normalizeEmail,
  sanitizeDisplayName,
  checkAuthRateLimit,
  getClientKey,
  getUserByEmail,
  getUserById,
  getUserByIdWithPassword,
  getUserRoles,
  getUserSessions,
  getSessionRow,
  deleteSessionRow,
  createUserSession,
  getAuthContext,
  normalizeRole,
  normalizeDisplayRoleName,
  createEmailVerificationToken,
  getEmailVerificationRow,
  queueNotification,
  queuePasswordReset,
  appendAudit,
  notificationTransport,
  isStrongPassword,
  passwordRuleMessage,
  handleSupabase,
  hashPassword,
  verifyPassword,
  buildCsrfToken,
  parseSignedToken,
  passwordHashFingerprint,
  parseCookies,
  sessionCookieName,
  clearSessionCookie,
  getUserBidRecords,
  getItems,
  getReserveState,
  randomUUID,
}: RegisterAuthRoutesOptions) => {
  app.get("/api/auth/me", asyncHandler(async (req, res) => {
    const session = await serializeSession(req);
    res.json(session ? { signedIn: true, user: session } : { signedIn: false, user: null });
  }));

  app.post("/api/auth/resend-verification", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email || ""));
    if (!email) {
      res.status(400).json({ error: "Email is required." });
      return;
    }
    if (!(await checkAuthRateLimit(req, getClientKey(req, `resend:${email}`)))) {
      res.status(429).json({ error: "Too many verification attempts. Please wait and try again." });
      return;
    }
    const user = await getUserByEmail(email);
    if (!user || user.status !== "pending_verification") {
      res.json({ queued: true, message: "If a pending account exists for that email, a fresh verification link has been sent." });
      return;
    }
    const verification = await createEmailVerificationToken(user.id);
    await queueNotification(
      "ACCOUNT_VERIFICATION",
      "Confirm your FMDQ Auctions account",
      { email: user.email, displayName: user.display_name, verifyUrl: verification.verifyUrl },
      user.email
    );
    await appendAudit(req, {
      eventType: "ACCOUNT_VERIFICATION_RESENT",
      entityType: "system",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email },
    });
    res.json({ queued: true, message: "A new verification link has been sent to your email." });
  }));

  app.post("/api/auth/register", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email || ""));
    const password = String(req.body?.password || "");
    const displayName = sanitizeDisplayName(String(req.body?.displayName || ""));
    if (!(await checkAuthRateLimit(req, getClientKey(req, `register:${email}`)))) {
      res.status(429).json({ error: "Too many signup attempts. Please wait and try again." });
      return;
    }
    if (!email || !displayName || !password) {
      res.status(400).json({ error: "Display name, email, and password are required." });
      return;
    }
    if (!isStrongPassword(password)) {
      res.status(400).json({ error: passwordRuleMessage });
      return;
    }
    const existing = await getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    const userId = randomUUID();
    const createdAt = new Date().toISOString();
    await handleSupabase(
      await supabase.from("users").insert({
        id: userId,
        email,
        password_hash: hashPassword(password),
        display_name: displayName,
        status: "pending_verification",
        created_at: createdAt,
        last_login_at: null,
      })
    );
    await handleSupabase(
      await supabase.from("user_roles").insert({ user_id: userId, role_name: "Bidder", created_at: createdAt })
    );
    const verification = await createEmailVerificationToken(userId);
    await queueNotification(
      "ACCOUNT_VERIFICATION",
      "Confirm your FMDQ Auctions account",
      { email, displayName, verifyUrl: verification.verifyUrl },
      email
    );
    await appendAudit(req, {
      eventType: "ACCOUNT_REGISTERED",
      entityType: "system",
      entityId: userId,
      actor: displayName,
      actorType: "user",
      details: { email, status: "pending_verification" },
    });
    res.status(201).json({
      registered: true,
      verificationRequired: true,
      email,
      verificationUrl: process.env.NODE_ENV === "production" || notificationTransport === "smtp" ? undefined : verification.verifyUrl,
      message: "Account created. Check your email to verify your account, then sign in.",
    });
  }));

  app.post("/api/auth/login", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email || ""));
    const password = String(req.body?.password || "");
    const auditActor = sanitizeDisplayName(email) || "unknown";
    if (!(await checkAuthRateLimit(req, getClientKey(req, `login:${email}`)))) {
      res.status(429).json({ error: "Too many sign-in attempts. Please wait and try again." });
      return;
    }
    const user = await getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash || "")) {
      await appendAudit(req, {
        eventType: "LOGIN_FAILED",
        entityType: "auth",
        entityId: email || "unknown",
        actor: auditActor,
        actorType: "user",
        details: { email, reason: "invalid_credentials" },
      });
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    if (user.status === "pending_verification") {
      await appendAudit(req, {
        eventType: "LOGIN_BLOCKED",
        entityType: "auth",
        entityId: user.id,
        actor: user.display_name,
        actorType: "user",
        details: { email: user.email, reason: "pending_verification" },
      });
      res.status(403).json({ error: "Please verify your email before signing in." });
      return;
    }
    if (user.status !== "active") {
      await appendAudit(req, {
        eventType: "LOGIN_BLOCKED",
        entityType: "auth",
        entityId: user.id,
        actor: user.display_name,
        actorType: "user",
        details: { email: user.email, reason: `status_${user.status}` },
      });
      res.status(403).json({ error: "This account is not active." });
      return;
    }
    const lastLoginAt = new Date().toISOString();
    await handleSupabase(await supabase.from("users").update({ last_login_at: lastLoginAt }).eq("id", user.id));
    const sessionRecord = await createUserSession(res, user.id);
    const roles = await getUserRoles(user.id);
    const role = normalizeRole(roles.map((row) => row.role_name));
    await appendAudit(req, {
      eventType: "LOGIN_SUCCEEDED",
      entityType: "auth",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email, role },
    });
    res.json({
      signedIn: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt,
        role,
      },
      csrfToken: buildCsrfToken(sessionRecord.sessionId),
    });
  }));

  app.post("/api/auth/verify-email", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
    const token = String(req.body?.token || "").trim();
    if (!(await checkAuthRateLimit(req, getClientKey(req, `verify:${token.slice(0, 12)}`)))) {
      res.status(429).json({ error: "Too many verification attempts. Please wait and try again." });
      return;
    }
    if (!token) {
      res.status(400).json({ error: "Verification token is required." });
      return;
    }
    const row = await getEmailVerificationRow(token);
    if (!row) {
      res.status(404).json({ error: "Verification link is invalid or has already been used." });
      return;
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("token", token));
      res.status(410).json({ error: "Verification link has expired. Please create your account again or request a new link." });
      return;
    }
    const user = await getUserById(row.user_id);
    if (!user) {
      await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("token", token));
      res.status(404).json({ error: "Account not found for this verification link." });
      return;
    }
    await handleSupabase(await supabase.from("users").update({ status: "active" }).eq("id", user.id));
    await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("user_id", user.id));
    await queueNotification(
      "ACCOUNT_VERIFIED",
      "FMDQ Auctions account verified",
      { email: user.email, displayName: user.display_name },
      user.email
    );
    await appendAudit(req, {
      eventType: "ACCOUNT_VERIFIED",
      entityType: "system",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email, status: "active" },
    });
    res.json({ verified: true, message: "Your account has been verified. You can now sign in." });
  }));

  app.post("/api/auth/request-password-reset", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
    const email = normalizeEmail(String(req.body?.email || ""));
    if (!(await checkAuthRateLimit(req, getClientKey(req, `reset-request:${email}`)))) {
      res.status(429).json({ error: "Too many password reset requests. Please wait and try again." });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "Email is required." });
      return;
    }
    const user = await getUserByEmail(email);
    if (user && user.status === "active") {
      await queuePasswordReset(user, "self-service");
      await appendAudit(req, {
        eventType: "PASSWORD_RESET_REQUESTED",
        entityType: "system",
        entityId: user.id,
        actor: user.display_name,
        actorType: "user",
        details: { email: user.email, channel: "email" },
      });
    }
    res.json({
      requested: true,
      message: "If an active account exists for that email, a password reset link has been sent.",
    });
  }));

  app.post("/api/auth/reset-password", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    if (!(await checkAuthRateLimit(req, getClientKey(req, `reset:${token.slice(0, 12)}`)))) {
      res.status(429).json({ error: "Too many password reset attempts. Please wait and try again." });
      return;
    }
    if (!token || !password) {
      res.status(400).json({ error: "Token and new password are required." });
      return;
    }
    if (!isStrongPassword(password)) {
      res.status(400).json({ error: passwordRuleMessage });
      return;
    }
    const payload = parseSignedToken<{ type: string; sub: string; exp: string; fp: string }>(token);
    if (!payload || payload.type !== "password-reset") {
      res.status(400).json({ error: "Password reset link is invalid." });
      return;
    }
    if (new Date(payload.exp).getTime() <= Date.now()) {
      res.status(410).json({ error: "Password reset link has expired." });
      return;
    }
    const user = await getUserByIdWithPassword(payload.sub);
    if (!user || user.status !== "active") {
      res.status(404).json({ error: "Account not found for this reset link." });
      return;
    }
    if (passwordHashFingerprint(user.password_hash || "") !== payload.fp) {
      res.status(409).json({ error: "This reset link is no longer valid. Request a new one." });
      return;
    }
    await handleSupabase(await supabase.from("users").update({ password_hash: hashPassword(password) }).eq("id", user.id));
    await handleSupabase(await supabase.from("sessions").delete().eq("user_id", user.id));
    await appendAudit(req, {
      eventType: "PASSWORD_RESET_COMPLETED",
      entityType: "system",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email },
    });
    res.json({ reset: true, message: "Password updated successfully. You can now sign in." });
  }));

  app.post("/api/auth/logout", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    const sessionId = parseCookies(req)[sessionCookieName];
    if (auth.signedIn && auth.userId) {
      await appendAudit(req, {
        eventType: "LOGOUT_SUCCEEDED",
        entityType: "auth",
        entityId: auth.userId,
        actor: auth.actor,
        actorType: auth.actorType,
        details: { currentSession: Boolean(sessionId) },
      });
    }
    if (sessionId) {
      await deleteSessionRow(sessionId).catch(() => undefined);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  app.get("/api/me/profile", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const user = await getUserById(auth.userId);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const roles = await getUserRoles(user.id);
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      role: auth.role,
      roles: roles.map((row) => normalizeDisplayRoleName(row.role_name)),
    });
  }));

  app.get("/api/me/sessions", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const currentSessionId = parseCookies(req)[sessionCookieName] || "";
    const sessions = await getUserSessions(auth.userId);
    res.json(sessions.map((session) => ({
      id: session.id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      current: session.id === currentSessionId,
    })));
  }));

  app.delete("/api/me/sessions/:id", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const session = await getSessionRow(String(req.params.id || ""));
    if (!session || session.user_id !== auth.userId) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await deleteSessionRow(session.id);
    const currentSessionId = parseCookies(req)[sessionCookieName] || "";
    if (session.id === currentSessionId) {
      clearSessionCookie(res);
    }
    await appendAudit(req, {
      eventType: "SESSION_REVOKED",
      entityType: "user",
      entityId: auth.userId,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { revoked: 1 },
    });
    res.json({ revoked: true, message: "Session revoked." });
  }));

  app.delete("/api/me/sessions", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const currentSessionId = parseCookies(req)[sessionCookieName] || "";
    const sessions = await getUserSessions(auth.userId);
    const revocable = sessions.filter((session) => session.id !== currentSessionId);
    for (const session of revocable) {
      await deleteSessionRow(session.id);
    }
    await appendAudit(req, {
      eventType: "SESSIONS_REVOKED",
      entityType: "user",
      entityId: auth.userId,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { count: revocable.length },
    });
    res.json({ revoked: true, count: revocable.length, message: `Revoked ${revocable.length} other session(s).` });
  }));

  app.get("/api/me/dashboard", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const bidRecords = await getUserBidRecords(auth.userId);
    const sessions = await getUserSessions(auth.userId);
    const closedItems = (await getItems(true)).filter((item) => new Date(item.endTime).getTime() < Date.now());
    res.json({
      summary: {
        openBidCount: bidRecords.filter((record) => ["winning", "outbid", "active"].includes(record.status)).length,
        wonAuctionCount: bidRecords.filter((record) => record.status === "won").length,
        activeSessionCount: sessions.length,
        totalBidCount: bidRecords.length,
        reserveMetClosedCount: closedItems.filter((item) => getReserveState(item) === "reserve_met").length,
        reserveNotMetClosedCount: closedItems.filter((item) => getReserveState(item) === "reserve_not_met").length,
      },
      recentBidActivity: bidRecords.slice(0, 8),
    });
  }));

  app.get("/api/me/bids", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    res.json(await getUserBidRecords(auth.userId));
  }));
};
