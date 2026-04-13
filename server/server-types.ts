import type { Role } from "../shared/permissions.js";

export type AuditEntry = {
  eventType: string;
  entityType: "item" | "bid" | "user" | "system" | "export" | "auth";
  entityId: string;
  actor: string;
  actorType: "system" | "user" | "integration";
  details: Record<string, string | number | boolean>;
};

export type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  status: "pending_verification" | "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
};

export type AuthContext = {
  userId?: string;
  sessionId?: string;
  actor: string;
  actorType: "system" | "user" | "integration";
  role: Role;
  trusted: boolean;
  adminAuthorized: boolean;
  signedIn: boolean;
};

export type NotificationQueueItem = {
  id: string;
  channel: "email";
  eventType: string;
  recipient: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  processedAt?: string | null;
  nextAttemptAt?: string | null;
  attemptCount?: number;
  claimToken?: string | null;
  claimExpiresAt?: string | null;
  errorMessage?: string | null;
};

export type AuditRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  actor_type: string;
  request_id: string;
  details_json: Record<string, unknown> | string;
  created_at: string;
  actor_role?: string | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
};

export type UserRow = {
  id: string;
  email: string;
  password_hash?: string;
  display_name: string;
  status: StoredUser["status"];
  created_at: string;
  last_login_at: string | null;
};
