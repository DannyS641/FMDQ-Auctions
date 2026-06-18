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

type SessionApiPayload = {
  signedIn: boolean;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  } | null;
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
  };
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

/**
 * Calls the PHP API. Auth is carried by an httpOnly session cookie
 * (credentials: "include"); the API uses a SameSite cookie for CSRF defense
 * on the same-origin deployment, so no CSRF token handling is needed here.
 */
export const apiClient = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
  return parseResponse<T>(response);
};

export { sessionFromPayload };
