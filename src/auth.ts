export type AuthMode = "ad" | "local" | "demo";

export type AuthSession = {
  mode: AuthMode;
  signedIn: boolean;
  displayName: string;
};

const authSessionKey = "fmdq_auth_session";
const localAuthKey = "fmdq_local_auth";
const demoAuthKey = "fmdq_demo_auth";

const defaultSession: AuthSession = {
  mode: "demo",
  signedIn: false,
  displayName: "Guest"
};

export const readAuthSession = (): AuthSession => {
  const raw = sessionStorage.getItem(authSessionKey);
  if (!raw) return defaultSession;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.mode || typeof parsed.signedIn !== "boolean" || !parsed.displayName) {
      return defaultSession;
    }
    return parsed as AuthSession;
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

export const isLocalSignedIn = () => sessionStorage.getItem(localAuthKey) === "true";
export const setLocalSignedIn = (value: boolean) => {
  sessionStorage.setItem(localAuthKey, value ? "true" : "false");
};

export const isDemoSignedIn = () => sessionStorage.getItem(demoAuthKey) === "true";
export const setDemoSignedIn = (value: boolean) => {
  sessionStorage.setItem(demoAuthKey, value ? "true" : "false");
};

export const getAuditHeaders = (role?: string) => {
  const session = readAuthSession();
  const headers: Record<string, string> = {
    "x-user": session.displayName,
    "x-auth-mode": session.mode
  };
  if (role) headers["x-role"] = role;
  return headers;
};
