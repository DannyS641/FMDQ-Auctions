export type AuthMode = "account";
export type Role = "Guest" | "Bidder" | "Observer" | "Admin";

export type AuthSession = {
  mode: AuthMode;
  signedIn: boolean;
  displayName: string;
  role: Role;
  email?: string;
  userId?: string;
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
      userId: parsed.userId
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

export const apiFetch = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.headers || {})
    }
  });

const sessionFromPayload = (payload: {
  signedIn: boolean;
  user: null | {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
}): AuthSession => {
  if (!payload.signedIn || !payload.user) return defaultSession;
  return {
    mode: "account",
    signedIn: true,
    displayName: payload.user.displayName,
    role: (payload.user.role as Role) || "Guest",
    email: payload.user.email,
    userId: payload.user.id
  };
};

export const fetchCurrentSession = async () => {
  const response = await apiFetch("/api/auth/me");
  const payload = (await response.json()) as {
    signedIn: boolean;
    user: null | { id: string; email: string; displayName: string; role: string };
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
    user: payload.user || null
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
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; registered?: boolean; verificationRequired?: boolean; email?: string; message?: string; verificationUrl?: string }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to create account.");
  }
  return payload;
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
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; verified?: boolean; message?: string }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to verify email.");
  }
  return payload;
};

export const requestPasswordReset = async (email: string) => {
  const response = await apiFetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; requested?: boolean; message?: string }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to request password reset.");
  }
  return payload;
};

export const resetPassword = async (token: string, password: string) => {
  const response = await apiFetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; reset?: boolean; message?: string }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Unable to reset password.");
  }
  return payload;
};

export const getAuditHeaders = () => ({});
