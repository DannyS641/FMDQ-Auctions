import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditRow, NotificationQueueItem, UserRow } from "./server-types.js";

type NotificationRow = {
  id: string;
  channel: "email";
  event_type: string;
  recipient: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  payload_json: Record<string, unknown> | string;
  created_at: string;
  processed_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  error_message: string | null;
};

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;
type ListUsersWithRolesResult = Array<{
  id: string;
  email: string;
  displayName: string;
  status: UserRow["status"];
  createdAt: string;
  lastLoginAt: string | null;
  roles: string[];
}>;

type CreateAdminServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  parseAuditDetails: (value: Record<string, unknown> | string | null | undefined) => Record<string, unknown>;
  normalizeDisplayRoleName: (value: string) => string;
  normalizeRole: (roles: string[]) => string | null;
  securityTelemetryEvents: Set<string>;
};

const SENSITIVE_AUDIT_DETAIL_KEYS = new Set([
  "sessionId",
  "bidId",
  "bidderUserId",
  "auctionItemId",
  "claimToken",
  "resetToken",
  "csrfToken",
  "actorUserId",
]);

export const createAdminService = ({
  supabase,
  handleSupabase,
  parseAuditDetails,
  normalizeDisplayRoleName,
  normalizeRole,
  securityTelemetryEvents,
}: CreateAdminServiceOptions) => {
  const listUsersWithRoles = async () => {
    const users = handleSupabase(
      await supabase
        .from("users")
        .select("id,email,display_name,status,created_at,last_login_at")
        .order("created_at", { ascending: false })
    ) as Array<Omit<UserRow, "password_hash">>;
    const roles = handleSupabase(
      await supabase.from("user_roles").select("user_id,role_name")
    ) as Array<{ user_id: string; role_name: string }>;
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      roles: roles.filter((role) => role.user_id === user.id).map((role) => normalizeDisplayRoleName(role.role_name)),
    })) as ListUsersWithRolesResult;
  };

  const getAuditActorRoleLookup = async () => {
    const users = await listUsersWithRoles();
    const roleLookup = new Map<string, string | null>();

    for (const user of users) {
      const normalizedRole = normalizeRole(user.roles);
      const existing = roleLookup.get(user.displayName);
      if (existing === undefined) {
        roleLookup.set(user.displayName, normalizedRole);
        continue;
      }
      if (existing !== normalizedRole) {
        roleLookup.set(user.displayName, null);
      }
    }

    return roleLookup;
  };

  const redactSensitiveAuditDetails = (value: Record<string, unknown>) => {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, entryValue]) => {
      if (SENSITIVE_AUDIT_DETAIL_KEYS.has(key)) return acc;
      acc[key] = entryValue;
      return acc;
    }, {});
  };

  const sanitizeNotificationPayloadForAdmin = (payload: Record<string, unknown>) => {
    return Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (/token/i.test(key)) return acc;
      if (/reseturl/i.test(key)) return acc;
      if (/verifyurl/i.test(key)) return acc;
      if (/itemurl/i.test(key)) return acc;
      if (key === "_meta" && typeof value === "object" && value !== null) {
        const meta = value as Record<string, unknown>;
        acc[key] = {
          attempts: meta.attempts,
          lastError: meta.lastError,
        };
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {});
  };

  const mapAuditRowToEntry = (row: AuditRow, actorRoleLookup?: Map<string, string | null>) => {
    const parsedDetails = redactSensitiveAuditDetails(parseAuditDetails(row.details_json));
    return {
      id: row.id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: row.actor,
      actorType: row.actor_type,
      actorRole: actorRoleLookup?.get(row.actor) ?? undefined,
      requestId: row.request_id,
      details: JSON.stringify(parsedDetails),
      createdAt: row.created_at,
    };
  };

  const getRecentAudits = async (limit = 20) => {
    const actorRoleLookup = await getAuditActorRoleLookup();
    const rows = handleSupabase(
      await supabase
        .from("audits")
        .select("id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at")
        .order("created_at", { ascending: false })
        .limit(limit + 100)
    ) as AuditRow[];
    return rows
      .filter((row) => !securityTelemetryEvents.has(row.event_type))
      .slice(0, limit)
      .map((row) => mapAuditRowToEntry(row, actorRoleLookup));
  };

  const mapNotificationRow = (row: NotificationRow): NotificationQueueItem => ({
    id: row.id,
    channel: row.channel,
    eventType: row.event_type,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json || "{}") : row.payload_json || {},
    createdAt: row.created_at,
    processedAt: row.processed_at,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: Number(row.attempt_count || 0),
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at,
    errorMessage: row.error_message,
  });

  const mapNotificationRowForAdmin = (row: NotificationRow): NotificationQueueItem => ({
    ...mapNotificationRow(row),
    payload: sanitizeNotificationPayloadForAdmin(
      typeof row.payload_json === "string" ? JSON.parse(row.payload_json || "{}") : row.payload_json || {}
    ),
    claimToken: null,
    claimExpiresAt: null,
  });

  const getNotificationQueue = async (limit = 20, offset = 0) => {
    const rows = handleSupabase(
      await supabase
        .from("notification_queue")
        .select("id,channel,event_type,recipient,subject,status,payload_json,created_at,processed_at,next_attempt_at,attempt_count,claim_token,claim_expires_at,error_message")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
    ) as NotificationRow[];
    return rows.map(mapNotificationRowForAdmin);
  };

  return {
    listUsersWithRoles,
    getAuditActorRoleLookup,
    redactSensitiveAuditDetails,
    sanitizeNotificationPayloadForAdmin,
    mapAuditRowToEntry,
    mapNotificationRow,
    mapNotificationRowForAdmin,
    getRecentAudits,
    getNotificationQueue,
  };
};
