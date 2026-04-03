export type AuthMode = "account";
export type Role = "Guest" | "Bidder" | "Observer" | "Admin" | "SuperAdmin";

export type AuthSession = {
  mode: AuthMode;
  signedIn: boolean;
  displayName: string;
  role: Role;
  email?: string;
  userId?: string;
  csrfToken?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string | null;
  role: Role;
  roles: string[];
};

export type UserSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type DashboardSummary = {
  openBidCount: number;
  wonAuctionCount: number;
  activeSessionCount: number;
  totalBidCount: number;
  reserveMetClosedCount: number;
  reserveNotMetClosedCount: number;
};

export type DashboardBidActivity = {
  itemId: string;
  title: string;
  category: string;
  currentBid: number;
  yourLatestBid: number;
  endTime: string;
  status: "winning" | "outbid" | "won" | "lost" | "active" | "closed";
};

export type DashboardPayload = {
  summary: DashboardSummary;
  recentBidActivity: DashboardBidActivity[];
};

export type UserBidRecord = {
  itemId: string;
  title: string;
  category: string;
  lot: string;
  currentBid: number;
  yourLatestBid: number;
  endTime: string;
  lastBidAt: string;
  status: "winning" | "outbid" | "won" | "lost" | "active" | "closed";
};

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string | null;
  roles: string[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";
const authSessionKey = "fmdq_auth_session";

const defaultSession: AuthSession = {
  mode: "account",
  signedIn: false,
  displayName: "Guest",
  role: "Guest"
};

export const readAuthSession = (): AuthSession => {
  const raw = sessionStorage.getItem(authSessionKey);
  if (!raw) return defaultSession;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.signedIn !== "boolean" || !parsed.displayName || !parsed.role) {
      return defaultSession;
    }
    return {
      mode: "account",
      signedIn: parsed.signedIn,
      displayName: parsed.displayName,
      role: parsed.role as Role,
      email: parsed.email,
      userId: parsed.userId,
      csrfToken: parsed.csrfToken
    };
  } catch {
    return defaultSession;
  }
};

export const writeAuthSession = (session: AuthSession) => {
  sessionStorage.setItem(authSessionKey, JSON.stringify(session));
};

export const clearAuthSession = () => {
  sessionStorage.removeItem(authSessionKey);
};

const performApiFetch = (path: string, init?: RequestInit, csrfToken?: string) => {
  const headers = new Headers(init?.headers || {});
  if (csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers
  });
};

const readJson = async <T>(response: Response, fallbackMessage: string) => {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || fallbackMessage);
  }
  return payload;
};

function sessionFromPayload(payload: {
  signedIn: boolean;
  user: null | {
    id: string;
    email: string;
    displayName: string;
    role: string;
    csrfToken?: string;
  };
  csrfToken?: string;
}): AuthSession {
  if (!payload.signedIn || !payload.user) return defaultSession;
  return {
    mode: "account",
    signedIn: true,
    displayName: payload.user.displayName,
    role: (payload.user.role as Role) || "Guest",
    email: payload.user.email,
    userId: payload.user.id,
    csrfToken: payload.csrfToken || payload.user.csrfToken
  };
}

export const apiFetch = async (path: string, init?: RequestInit) => {
  const method = (init?.method || "GET").toUpperCase();
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
  let session = readAuthSession();
  if (isMutation && session.signedIn && !session.csrfToken) {
    const refreshResponse = await performApiFetch("/api/auth/me");
    const refreshPayload = (await refreshResponse.json().catch(() => null)) as {
      signedIn: boolean;
      user: null | { id: string; email: string; displayName: string; role: string; csrfToken?: string };
      csrfToken?: string;
    } | null;
    if (refreshResponse.ok && refreshPayload) {
      session = sessionFromPayload(refreshPayload);
      writeAuthSession(session);
    }
  }
  let response = await performApiFetch(path, init, isMutation ? session.csrfToken : undefined);
  if (!isMutation || response.status !== 403) {
    return response;
  }
  const payload = (await response.clone().json().catch(() => null)) as { error?: string } | null;
  if (payload?.error !== "Invalid or missing CSRF token.") {
    return response;
  }
  const refreshResponse = await performApiFetch("/api/auth/me");
  if (!refreshResponse.ok) {
    clearAuthSession();
    return response;
  }
  const refreshPayload = (await refreshResponse.json().catch(() => null)) as {
    signedIn: boolean;
    user: null | { id: string; email: string; displayName: string; role: string; csrfToken?: string };
    csrfToken?: string;
  } | null;
  if (!refreshPayload) {
    clearAuthSession();
    return response;
  }
  const refreshedSession = sessionFromPayload(refreshPayload);
  if (refreshedSession.signedIn) {
    writeAuthSession(refreshedSession);
    response = await performApiFetch(path, init, refreshedSession.csrfToken);
    return response;
  }
  clearAuthSession();
  return response;
};

export const fetchCurrentSession = async () => {
  const response = await apiFetch("/api/auth/me");
  const payload = (await response.json()) as {
    signedIn: boolean;
    user: null | { id: string; email: string; displayName: string; role: string; csrfToken?: string };
    csrfToken?: string;
  };
  const session = sessionFromPayload(payload);
  writeAuthSession(session);
  return session;
};

export const loginWithAccount = async (email: string, password: string) => {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; signedIn?: boolean; user?: { id: string; email: string; displayName: string; role: string } | null }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to sign in.");
  }
  const session = sessionFromPayload({
    signedIn: Boolean(payload.signedIn),
    user: payload.user || null,
    csrfToken: (payload as { csrfToken?: string }).csrfToken
  });
  writeAuthSession(session);
  return session;
};

export const registerAccount = async (displayName: string, email: string, password: string) => {
  const response = await apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, email, password })
  });
  return readJson<{ registered?: boolean; verificationRequired?: boolean; email?: string; message?: string; verificationUrl?: string }>(
    response,
    "Unable to create account."
  );
};

export const logoutAccount = async () => {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearAuthSession();
  }
};

export const verifyEmailToken = async (token: string) => {
  const response = await apiFetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  return readJson<{ verified?: boolean; message?: string }>(response, "Unable to verify email.");
};

export const resendVerification = async (email: string) => {
  const response = await apiFetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  return readJson<{ queued?: boolean; message?: string }>(response, "Unable to resend verification email.");
};

export const requestPasswordReset = async (email: string) => {
  const response = await apiFetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  return readJson<{ requested?: boolean; message?: string }>(response, "Unable to request password reset.");
};

export const resetPassword = async (token: string, password: string) => {
  const response = await apiFetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  return readJson<{ reset?: boolean; message?: string }>(response, "Unable to reset password.");
};

export const fetchMyProfile = async () => {
  const response = await apiFetch("/api/me/profile");
  return readJson<UserProfile>(response, "Unable to load your profile.");
};

export const fetchMySessions = async () => {
  const response = await apiFetch("/api/me/sessions");
  return readJson<UserSession[]>(response, "Unable to load your sessions.");
};

export const revokeMySession = async (sessionId: string) => {
  const response = await apiFetch(`/api/me/sessions/${sessionId}`, { method: "DELETE" });
  return readJson<{ revoked?: boolean; message?: string }>(response, "Unable to revoke that session.");
};

export const revokeOtherSessions = async () => {
  const response = await apiFetch("/api/me/sessions", { method: "DELETE" });
  return readJson<{ revoked?: boolean; count?: number; message?: string }>(response, "Unable to revoke other sessions.");
};

export const fetchMyDashboard = async () => {
  const response = await apiFetch("/api/me/dashboard");
  return readJson<DashboardPayload>(response, "Unable to load your dashboard.");
};

export const fetchMyBids = async () => {
  const response = await apiFetch("/api/me/bids");
  return readJson<UserBidRecord[]>(response, "Unable to load your bids.");
};

export const fetchAdminUsers = async () => {
  const response = await apiFetch("/api/admin/users");
  return readJson<AdminUser[]>(response, "Unable to load users.");
};

export const fetchAdminRoles = async () => {
  const response = await apiFetch("/api/admin/roles");
  return readJson<string[]>(response, "Unable to load roles.");
};

export const assignUserRole = async (userId: string, roleName: string) => {
  const response = await apiFetch(`/api/admin/users/${userId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleName })
  });
  return readJson<{ updated?: boolean; message?: string }>(response, "Unable to assign role.");
};

export const removeUserRole = async (userId: string, roleName: string) => {
  const response = await apiFetch(`/api/admin/users/${userId}/roles/${encodeURIComponent(roleName)}`, {
    method: "DELETE"
  });
  return readJson<{ updated?: boolean; message?: string }>(response, "Unable to remove role.");
};

export const bulkImportUsers = async (file: File) => {
  const formData = new FormData();
  formData.append("csv", file);
  const response = await apiFetch("/api/admin/users/bulk-import", {
    method: "POST",
    body: formData
  });
  return readJson<{
    created: number;
    skipped: number;
    failed: number;
    items: Array<{ row: number; status: "created" | "skipped" | "failed"; email: string; message: string }>;
  }>(response, "Unable to import users.");
};

export const getAuditHeaders = () => ({});
