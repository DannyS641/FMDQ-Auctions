import { apiClient } from "@/lib/api-client";
import type { AdminUser, AuditEntry, NotificationEntry, OperationsPayload, BulkImportReport, PaginatedResult } from "@/types";

type AuditEntryApiRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  actor_type: string;
  actor_role?: string | null;
  request_id: string;
  details_json: unknown;
  created_at: string;
};

const toSearchParams = (params: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {})
  ).toString();

export const getAdminUsers = async (): Promise<AdminUser[]> =>
  apiClient<AdminUser[]>("/api/admin/users");

export const getRoles = async (): Promise<string[]> =>
  apiClient<string[]>("/api/admin/roles");

export const assignRole = async (userId: string, roleName: string): Promise<{ updated?: boolean }> =>
  apiClient(`/api/admin/users/${userId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleName }),
  });

export const removeRole = async (userId: string, roleName: string): Promise<{ updated?: boolean }> =>
  apiClient(`/api/admin/users/${userId}/roles/${encodeURIComponent(roleName)}`, {
    method: "DELETE",
  });

export const disableUser = async (userId: string, reason?: string): Promise<{ updated?: boolean }> =>
  apiClient(`/api/admin/users/${userId}/disable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });

export const enableUser = async (userId: string): Promise<{ updated?: boolean }> =>
  apiClient(`/api/admin/users/${userId}/enable`, { method: "POST" });

export const forcePasswordReset = async (userId: string): Promise<{ queued?: boolean }> =>
  apiClient(`/api/admin/users/${userId}/password-reset`, { method: "POST" });

export const bulkPasswordReset = async (
  scope: "all" | "role" | "selected",
  role?: string,
  userIds?: string[]
): Promise<{ queued?: boolean; count?: number }> =>
  apiClient("/api/admin/users/password-resets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, role, userIds }),
  });

export const bulkImportUsers = async (file: File): Promise<BulkImportReport> => {
  const formData = new FormData();
  formData.append("csv", file);
  return apiClient<BulkImportReport>("/api/admin/users/bulk-import", {
    method: "POST",
    body: formData,
  });
};

export const getOperations = async (): Promise<OperationsPayload> =>
  apiClient<OperationsPayload>("/api/admin/operations");

export const getAudits = async (
  filters: Record<string, string | number> = {}
): Promise<PaginatedResult<AuditEntry>> => {
  const params = toSearchParams(filters);
  const payload = await apiClient<{
    items: AuditEntryApiRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/admin/audits${params ? `?${params}` : ""}`);
  return {
    total: payload.total,
    page: payload.page,
    pageSize: payload.pageSize,
    items: payload.items.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: row.actor,
      actorType: row.actor_type,
      actorRole: row.actor_role ?? null,
      requestId: row.request_id,
      details: typeof row.details_json === "string" ? row.details_json : JSON.stringify(row.details_json ?? {}),
      createdAt: row.created_at,
    })),
  };
};

export const getNotifications = async (
  params: Record<string, string | number> = {}
): Promise<PaginatedResult<NotificationEntry>> => {
  const query = toSearchParams(params);
  return apiClient<PaginatedResult<NotificationEntry>>(`/api/admin/notifications${query ? `?${query}` : ""}`);
};

export const processNotifications = async (): Promise<{ processed: number }> =>
  apiClient("/api/admin/notifications/process", { method: "POST" });
