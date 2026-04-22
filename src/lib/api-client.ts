import { readAuthSession, writeAuthSession, clearAuthSession } from "./auth-session";
import type { AuthSession } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type SessionApiPayload = {
  signedIn: boolean;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    csrfToken?: string;
  } | null;
  csrfToken?: string;
};

const sessionFromPayload = (payload: SessionApiPayload): AuthSession => {
  if (!payload.signedIn || !payload.user) {
    return { signedIn: false, displayName: "Guest", role: "Guest" };
  }
  return {
    signedIn: true,
    displayName: payload.user.displayName,
    role: payload.user.role as AuthSession["role"],
    email: payload.user.email,
    userId: payload.user.id,
    csrfToken: payload.csrfToken ?? payload.user.csrfToken,
  };
};

const performFetch = (path: string, init?: RequestInit, csrfToken?: string): Promise<Response> => {
  const headers = new Headers(init?.headers ?? {});
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  return fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers });
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || data === null) {
    const message =
      (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string" && data.message) ||
      data?.error ||
      "An unexpected error occurred.";
    throw new ApiError(response.status, message, data);
  }
  return data;
};

const refreshSession = async (): Promise<AuthSession | null> => {
  const response = await performFetch("/api/auth/me");
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as SessionApiPayload | null;
  if (!payload) return null;
  const session = sessionFromPayload(payload);
  writeAuthSession(session);
  return session;
};

export const apiClient = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const method = (init.method ?? "GET").toUpperCase();
  const isMutation = MUTATION_METHODS.has(method);
  let session = readAuthSession();

  // Pre-flight: ensure we have a CSRF token before any mutation
  if (isMutation && session.signedIn && !session.csrfToken) {
    const refreshed = await refreshSession();
    if (refreshed) session = refreshed;
  }

  let response = await performFetch(path, init, isMutation ? session.csrfToken : undefined);

  // CSRF token expired — refresh once and retry
  if (isMutation && response.status === 403) {
    const payload = (await response.clone().json().catch(() => null)) as { error?: string } | null;
    if (payload?.error === "Invalid or missing CSRF token.") {
      const refreshed = await refreshSession();
      if (refreshed?.signedIn) {
        response = await performFetch(path, init, refreshed.csrfToken);
      } else {
        clearAuthSession();
        return parseResponse<T>(response);
      }
    }
  }

  return parseResponse<T>(response);
};

export { sessionFromPayload };
