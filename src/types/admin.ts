export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: "pending_verification" | "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string | null;
  roles: string[];
};

export type AuditEntry = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  actorType: string;
  actorRole?: string | null;
  requestId: string;
  details: string;
  createdAt: string;
};

export type NotificationEntry = {
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

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type OperationsSummary = {
  totalItems: number;
  liveCount: number;
  closedCount: number;
  archivedCount: number;
  pendingNotifications: number;
  auditCount: number;
  wins: number;
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  adminUsers: number;
  superAdminUsers: number;
};

export type OperationsPayload = {
  summary: OperationsSummary;
  metrics: Record<string, number>;
  recentAudits: AuditEntry[];
  notificationQueue: NotificationEntry[];
};
