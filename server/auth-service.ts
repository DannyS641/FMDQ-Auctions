import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { AuthContext, Role, SessionRow, StoredUser, UserRow } from "./server-types.js";
import { isAdminRole } from "../shared/permissions.js";

type RoleRow = { role_name: string };
type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;
type HandleSupabaseMaybe = <T>(result: { data: T | null; error: { message: string } | null }, allowNotFound?: boolean) => T | null;

type CreateAuthServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  handleSupabaseMaybe: HandleSupabaseMaybe;
  parseCookies: (req: express.Request) => Record<string, string>;
  sessionCookieName: string;
  sessionTtlMs: number;
  setSessionCookie: (res: express.Response, sessionId: string, expiresAt: string) => void;
  buildCsrfToken: (sessionId: string) => string;
  normalizeRole: (roles: string[]) => Role;
  getUserById: (id: string) => Promise<UserRow | null>;
};

export const createAuthService = ({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  parseCookies,
  sessionCookieName,
  sessionTtlMs,
  setSessionCookie,
  buildCsrfToken,
  normalizeRole,
  getUserById,
}: CreateAuthServiceOptions) => {
  const getUserRoles = async (userId: string) =>
    handleSupabase(
      await supabase.from("user_roles").select("role_name").eq("user_id", userId)
    ) as RoleRow[];

  const getSessionRow = async (sessionId: string) =>
    handleSupabaseMaybe<SessionRow>(
      await supabase.from("sessions").select("id,user_id,created_at,expires_at").eq("id", sessionId).maybeSingle(),
      true
    );

  const getUserSessions = async (userId: string) =>
    handleSupabase(
      await supabase.from("sessions").select("id,user_id,created_at,expires_at").eq("user_id", userId).order("created_at", { ascending: false })
    ) as SessionRow[];

  const deleteSessionRow = async (sessionId: string) => {
    await handleSupabase(await supabase.from("sessions").delete().eq("id", sessionId));
  };

  const createUserSession = async (res: express.Response, userId: string) => {
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    await handleSupabase(
      await supabase.from("sessions").insert({ id: sessionId, user_id: userId, created_at: createdAt, expires_at: expiresAt })
    );
    setSessionCookie(res, sessionId, expiresAt);
    return { sessionId, createdAt, expiresAt };
  };

  const getAuthContext = async (req: express.Request, adminApiToken?: string): Promise<AuthContext> => {
    if (adminApiToken && req.header("x-admin-token") === adminApiToken) {
      return {
        userId: "admin-token",
        sessionId: undefined,
        actor: "Admin API token",
        actorType: "integration",
        role: "Admin",
        trusted: true,
        adminAuthorized: true,
        signedIn: true,
      };
    }
    const sessionId = parseCookies(req)[sessionCookieName];
    if (!sessionId) {
      return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
    }
    const sessionRow = await getSessionRow(sessionId);
    if (!sessionRow || new Date(sessionRow.expires_at).getTime() <= Date.now()) {
      await deleteSessionRow(sessionId).catch(() => undefined);
      return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
    }
    const user = await getUserById(sessionRow.user_id);
    if (!user || user.status !== "active") {
      await deleteSessionRow(sessionId).catch(() => undefined);
      return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
    }
    const roleRows = await getUserRoles(user.id);
    const role = normalizeRole(roleRows.map((row) => row.role_name));
    return {
      userId: user.id,
      sessionId,
      actor: user.display_name,
      actorType: "user",
      role,
      trusted: true,
      adminAuthorized: isAdminRole(role),
      signedIn: true,
    };
  };

  const serializeSession = async (req: express.Request, adminApiToken?: string): Promise<((StoredUser & { role: Role }) & { csrfToken?: string }) | null> => {
    const auth = await getAuthContext(req, adminApiToken);
    if (!auth.signedIn || !auth.userId) return null;
    const user = await getUserById(auth.userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      role: auth.role,
      csrfToken: auth.sessionId ? buildCsrfToken(auth.sessionId) : undefined,
    };
  };

  return {
    getUserRoles,
    getSessionRow,
    getUserSessions,
    deleteSessionRow,
    createUserSession,
    getAuthContext,
    serializeSession,
  };
};
