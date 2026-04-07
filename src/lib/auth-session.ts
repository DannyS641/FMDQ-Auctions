import type { AuthSession } from "@/types";
import { DEFAULT_SESSION } from "@/types";

const SESSION_KEY = "fmdq_auth_session";

export const readAuthSession = (): AuthSession => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.signedIn !== "boolean" || !parsed.displayName || !parsed.role) {
      return DEFAULT_SESSION;
    }
    return {
      signedIn: parsed.signedIn,
      displayName: parsed.displayName,
      role: parsed.role,
      email: parsed.email,
      userId: parsed.userId,
      csrfToken: parsed.csrfToken,
    };
  } catch {
    return DEFAULT_SESSION;
  }
};

export const writeAuthSession = (session: AuthSession): void => {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearAuthSession = (): void => {
  sessionStorage.removeItem(SESSION_KEY);
};
