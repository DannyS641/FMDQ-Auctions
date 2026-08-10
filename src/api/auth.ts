import axios from "axios";
import { apiClient, sessionFromPayload, ApiError } from "@/lib/api-client";
import { writeAuthSession, clearAuthSession } from "@/lib/auth-session";
import type { AuthSession, UserProfile, UserSession } from "@/types";

type LoginResponse = {
  signedIn: boolean;
  user: { id: string; email: string; displayName: string; role: string } | null;
};

type RegisterResponse = {
  registered?: boolean;
  verificationRequired?: boolean;
  email?: string;
  message?: string;
  verificationUrl?: string;
};

export const getSession = async (): Promise<AuthSession> => {
  const payload = await apiClient<LoginResponse>("/api/auth/me");
  const session = sessionFromPayload(payload);
  writeAuthSession(session);
  return session;
};

export const loginWithFallback = async (
  email: string,
  password: string,
  useAd = false,
): Promise<AuthSession> => {
  if (!useAd) {
    console.log("Logging in with standard credentials");
    const session = await login(email, password);
    return session;
  }

  let adResult: LoginResponse;
  try {
    const API_BASE = import.meta.env.VITE_AUTH_ENDPOINT ?? "";
    const basicToken = import.meta.env.VITE_BASIC_TOKEN ?? "";

    const { data } = await axios.post<LoginResponse>(
      API_BASE,
      { email, password },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicToken}`,
        },
      },
    );
    adResult = data as any;
  } catch (adErr) {
    if (axios.isAxiosError(adErr) && adErr.response?.status === 401) {
      throw new ApiError(
        adErr.response?.data?.message ?? "Invalid username or password",
        "401",
      );
    }
    throw adErr;
  }

  if (!adResult.success || adResult.data.length <= 0) {
    throw new ApiError(
      adResult?.message ?? "Invalid username or password",
      "401",
    );
  }

  const user = adResult.data[0];
  const userEmail = user.emailAddress;
  const userdisplayName = user.displayName;

  console.log("AD login result:", user);
  console.log("AD login result email:", userEmail);
  console.log("AD login result displayName:", userdisplayName);

  // AD verified them → ask the backend to provision (if new) and issue a session.
  // The backend trusts this call only if it can re-verify, so pass enough to prove it.
  const session = await loginWithADSession(userEmail, userdisplayName);
  return session;
};

export const loginWithADSession = async (
  email: string,
  displayName: string,
): Promise<AuthSession> => {
  const payload = await apiClient<LoginResponse>("/api/auth/adlogin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName }),
  });
  const session = sessionFromPayload(payload);
  writeAuthSession(session);
  return session;
};

export const login = async (
  email: string,
  password: string,
): Promise<AuthSession> => {
  const payload = await apiClient<LoginResponse>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = sessionFromPayload(payload);
  writeAuthSession(session);
  return session;
};

export const register = async (
  displayName: string,
  email: string,
  password: string,
): Promise<RegisterResponse> => {
  return apiClient<RegisterResponse>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, email, password }),
  });
};

export const logout = async (): Promise<void> => {
  await apiClient<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  clearAuthSession();
};

export const verifyEmail = async (
  token: string,
): Promise<{ verified?: boolean; message?: string }> => {
  return apiClient("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
};

export const resendVerification = async (
  email: string,
): Promise<{ queued?: boolean; message?: string }> => {
  return apiClient("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
};

export const requestPasswordReset = async (
  email: string,
): Promise<{ requested?: boolean; message?: string }> => {
  return apiClient("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
};

export const resetPassword = async (
  token: string,
  password: string,
): Promise<{ reset?: boolean; message?: string }> => {
  return apiClient("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
};

export const getMyProfile = async (): Promise<UserProfile> =>
  apiClient<UserProfile>("/api/me/profile");

export const getMySessions = async (): Promise<UserSession[]> =>
  apiClient<UserSession[]>("/api/me/sessions");

export const revokeSession = async (
  sessionId: string,
): Promise<{ revoked?: boolean }> =>
  apiClient(`/api/me/sessions/${sessionId}`, { method: "DELETE" });

export const revokeOtherSessions = async (): Promise<{
  revoked?: boolean;
  count?: number;
}> => apiClient("/api/me/sessions", { method: "DELETE" });
