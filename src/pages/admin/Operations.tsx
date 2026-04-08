import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, KeyRound, Download } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { PageSpinner } from "@/components/ui/Spinner";
import {
  getOperations,
  getAdminUsers,
  getAudits,
  getNotifications,
  processNotifications,
  disableUser,
  enableUser,
  forcePasswordReset,
  bulkPasswordReset,
} from "@/api/admin";
import { queryKeys } from "@/lib/query-keys";
import { formatDate, formatTimeAgo } from "@/lib/formatters";
import { cn } from "@/lib/cn";
import type { AdminUser, AuditEntry } from "@/types";

type Tab = "overview" | "users" | "audits" | "notifications";
const ACTIVITY_PAGE_SIZE = 10;

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "audits", label: "Activity log" },
  { id: "notifications", label: "Notifications" },
];

type ActivityView = {
  id: string;
  dateLabel: string;
  dateValue: string;
  userLabel: string;
  roleLabel: string;
  ip: string;
  topic: string;
  context: string;
  meta: string;
  action: string;
};

const formatActivityEvent = (eventType: string) =>
  eventType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const parseActivityDetails = (details: string) => {
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const humanizeKey = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatMetaValue = (value: unknown) => {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

const resolveActivityRoleLabel = (entry: AuditEntry, details: Record<string, unknown>) => {
  if (entry.actorRole && entry.actorRole.trim()) {
    return humanizeKey(entry.actorRole.trim());
  }

  const detailRole =
    details.actorRole ||
    details.role ||
    details.roleName ||
    details.userRole;

  if (typeof detailRole === "string" && detailRole.trim()) {
    return humanizeKey(detailRole.trim());
  }

  if (entry.actorType === "user") return "User";
  if (!entry.actorType) return "System";
  return humanizeKey(entry.actorType);
};

const buildActivityView = (entry: AuditEntry): ActivityView => {
  const details = parseActivityDetails(entry.details);
  const requestIp = String(details.requestIp || details.ip || details.clientIp || "—");

  const topic =
    entry.entityType === "user" || entry.eventType.includes("SESSION") || entry.eventType.includes("PASSWORD")
      ? "Users"
      : entry.entityType === "item" || entry.eventType.includes("BID")
        ? "Items"
        : entry.eventType.includes("CATEGORY")
          ? "Categories"
          : entry.entityType === "export"
            ? "Exports"
            : "System";

  const context =
    entry.eventType.includes("SESSION")
      ? "Session"
      : entry.eventType.includes("PASSWORD")
        ? "Password"
        : entry.eventType.includes("ROLE")
          ? "Roles"
          : entry.entityType === "item"
            ? "Auction item"
            : entry.entityType === "user"
              ? "User account"
              : entry.entityType === "export"
                ? "Data export"
                : topic;

  const actionMap: Record<string, string> = {
    ACCOUNT_REGISTERED: "Registered",
    ACCOUNT_VERIFIED: "Verified",
    ACCOUNT_VERIFICATION_RESENT: "Verification Resent",
    PASSWORD_RESET_REQUESTED: "Reset Requested",
    PASSWORD_RESET_COMPLETED: "Password Reset",
    PASSWORD_RESET_FORCED: "Password Reset Sent",
    PASSWORD_RESET_BULK_FORCED: "Bulk Password Reset Sent",
    SESSION_REVOKED: "Logged Out",
    SESSIONS_REVOKED: "All Sessions Revoked",
    USER_DISABLED: "Disabled",
    USER_ENABLED: "Enabled",
    USER_ROLE_ASSIGNED: "Role Assigned",
    USER_ROLE_REMOVED: "Role Removed",
    USER_BULK_IMPORTED: "Bulk Imported",
    ITEM_CREATED: "Created",
    ITEM_UPDATED: "Updated",
    ITEM_ARCHIVED: "Archived",
    ITEM_RESTORED: "Restored",
    ITEM_BULK_IMPORTED: "Bulk Imported",
    CATEGORY_DELETED: "Deleted",
    BID_PLACED: "Bid Placed",
    EXPORT_ITEMS: "Items Exported",
    EXPORT_AUDITS: "Activity Exported",
  };

  const metaEntries = Object.entries(details).filter(([key, value]) => {
    if (["requestIp", "ip", "clientIp"].includes(key)) return false;
    return value != null && value !== "";
  });

  const meta = metaEntries.length
    ? metaEntries.map(([key, value]) => `${humanizeKey(key)}: ${formatMetaValue(value)}`).join(" | ")
    : "—";

  return {
    id: entry.id,
    dateLabel: formatTimeAgo(entry.createdAt),
    dateValue: formatDate(entry.createdAt),
    userLabel: entry.actor || "System",
    roleLabel: resolveActivityRoleLabel(entry, details),
    ip: requestIp,
    topic,
    context,
    meta,
    action: actionMap[entry.eventType] ?? formatActivityEvent(entry.eventType),
  };
};

const csvEscape = (value: unknown) => {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const buildCsv = (rows: Array<Array<unknown>>) => rows.map((row) => row.map(csvEscape).join(",")).join("\n");

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.operations(),
    queryFn: getOperations,
    staleTime: 30_000,
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <ErrorMessage title="Could not load overview" />;

  const { summary } = data;

  const stats = [
    { label: "Total items", value: summary.totalItems },
    { label: "Live", value: summary.liveCount },
    { label: "Closed", value: summary.closedCount },
    { label: "Archived", value: summary.archivedCount },
    { label: "Total users", value: summary.totalUsers },
    { label: "Active users", value: summary.activeUsers },
    { label: "Admins", value: summary.adminUsers },
    { label: "Wins", value: summary.wins },
    { label: "Pending notifications", value: summary.pendingNotifications },
    { label: "Activity entries", value: summary.auditCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(({ label, value }) => (
          <Card key={label} padding="sm" className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate">{label}</p>
            <p className="text-2xl font-bold text-ink">{value}</p>
          </Card>
        ))}
      </div>

      {data.recentAudits.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-slate">
            Recent activity
          </h2>
          <div className="flex flex-col divide-y divide-ink/5">
            {data.recentAudits.slice(0, 8).map((entry) => (
              <div key={entry.id} className="flex items-start justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{entry.eventType}</p>
                  <p className="text-xs text-slate">{entry.actor} · {entry.entityType} {entry.entityId}</p>
                </div>
                <p className="shrink-0 text-xs text-slate">{formatTimeAgo(entry.createdAt)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  selected,
  onToggleSelected,
}: {
  user: AdminUser;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const queryClient = useQueryClient();

  const refreshAdminViews = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.operations() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.audits() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
  };

  const { mutate: toggleStatus, isPending: togglingStatus } = useMutation({
    mutationFn: () => user.status === "disabled" ? enableUser(user.id) : disableUser(user.id),
    onSuccess: () => {
      toast.success(user.status === "disabled" ? "User enabled." : "User disabled.");
      refreshAdminViews();
    },
    onError: () => toast.error("Could not update user."),
  });

  const { mutate: resetPassword, isPending: resettingPassword } = useMutation({
    mutationFn: () => forcePasswordReset(user.id),
    onSuccess: () => {
      toast.success(`Password reset queued for ${user.email}.`);
      refreshAdminViews();
    },
    onError: () => toast.error("Could not queue password reset."),
  });

  return (
    <tr className="transition hover:bg-ash/50">
      <td className="px-5 py-4">
        <input
          type="checkbox"
          aria-label={`Select ${user.displayName}`}
          disabled={user.status !== "active"}
          checked={selected}
          onChange={onToggleSelected}
          className="h-4 w-4 rounded border-ink/20 accent-neon"
        />
      </td>
      <td className="px-5 py-4">
        <p className="text-sm font-semibold text-ink">{user.displayName}</p>
        <p className="text-xs text-slate">{user.email}</p>
      </td>
      <td className="hidden px-5 py-4 sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {user.roles.length > 0
            ? user.roles.map((r) => (
                <span key={r} className="rounded-full bg-[#eef3ff] px-2 py-0.5 text-xs font-semibold text-neon">
                  {r}
                </span>
              ))
            : <span className="text-xs text-slate">No roles</span>}
        </div>
      </td>
      <td className="px-5 py-4">
        <Badge status={user.status} label={user.status.replace("_", " ")} />
      </td>
      <td className="hidden px-5 py-4 text-xs text-slate md:table-cell">
        {user.lastLoginAt ? formatTimeAgo(user.lastLoginAt) : "Never"}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={resettingPassword}
            disabled={user.status !== "active"}
            onClick={() => resetPassword()}
          >
            <KeyRound size={14} />
            Reset password
          </Button>
          <Button
            variant={user.status === "disabled" ? "secondary" : "ghost"}
            size="sm"
            isLoading={togglingStatus}
            onClick={() => toggleStatus()}
          >
            {user.status === "disabled" ? "Enable" : "Disable"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState("");
  const queryClient = useQueryClient();

  const { data: users, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: getAdminUsers,
    staleTime: 30_000,
  });

  const filtered = (users ?? []).filter(
    (u) =>
      !search ||
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const roles = Array.from(new Set((users ?? []).flatMap((user) => user.roles))).sort();
  const activeFilteredUsers = filtered.filter((user) => user.status === "active");
  const activeSelectedUsers = activeFilteredUsers.filter((user) => selectedIds.includes(user.id));

  const toggleSelection = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = activeFilteredUsers.map((user) => user.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !filteredIds.includes(id))
        : Array.from(new Set([...current, ...filteredIds]))
    );
  };

  const refreshAdminViews = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.operations() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.audits() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
  };

  const { mutate: resetSelected, isPending: resettingSelected } = useMutation({
    mutationFn: () => bulkPasswordReset("selected", undefined, activeSelectedUsers.map((user) => user.id)),
    onSuccess: (result) => {
      toast.success(`Queued password resets for ${result.count ?? activeSelectedUsers.length} selected user(s).`);
      setSelectedIds([]);
      refreshAdminViews();
    },
    onError: () => toast.error("Could not queue selected password resets."),
  });

  const { mutate: resetRole, isPending: resettingRole } = useMutation({
    mutationFn: () => bulkPasswordReset("role", bulkRole),
    onSuccess: (result) => {
      toast.success(`Queued password resets for ${result.count ?? 0} user(s) in ${bulkRole}.`);
      refreshAdminViews();
    },
    onError: () => toast.error("Could not queue role-based password resets."),
  });

  const { mutate: resetAll, isPending: resettingAll } = useMutation({
    mutationFn: () => bulkPasswordReset("all"),
    onSuccess: (result) => {
      toast.success(`Queued password resets for ${result.count ?? 0} active user(s).`);
      setSelectedIds([]);
      refreshAdminViews();
    },
    onError: () => toast.error("Could not queue password resets for all users."),
  });

  const { mutate: exportUsersCsv, isPending: exportingUsers } = useMutation({
    mutationFn: async () => {
      const rows: Array<Array<unknown>> = [
        ["Name", "Email", "Status", "Roles", "Created", "Last Login"],
        ...filtered.map((user) => [
          user.displayName,
          user.email,
          user.status,
          user.roles.join(", "),
          user.createdAt,
          user.lastLoginAt || "Never",
        ]),
      ];
      downloadCsv(`users-export-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows));
    },
    onSuccess: () => toast.success("Users CSV exported."),
    onError: () => toast.error("Could not export users CSV."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-3xl border border-ink/10 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
              Search users
            </label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or email…"
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon"
            />
          </div>
          <div className="min-w-[14rem]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">
              Bulk by role
            </label>
            <select
              value={bulkRole}
              onChange={(e) => setBulkRole(e.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-neon"
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" isLoading={exportingUsers} onClick={() => exportUsersCsv()}>
            <Download size={14} />
            Export users
          </Button>

          <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={activeSelectedUsers.length === 0}
            isLoading={resettingSelected}
            onClick={() => resetSelected()}
          >
            <KeyRound size={14} />
            Reset selected ({activeSelectedUsers.length})
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!bulkRole}
            isLoading={resettingRole}
            onClick={() => resetRole()}
          >
            <KeyRound size={14} />
            Reset role
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isLoading={resettingAll}
            onClick={() => resetAll()}
          >
            <KeyRound size={14} />
            Reset all active users
          </Button>
          </div>
        </div>
      </div>

      {isLoading && <PageSpinner />}
      {isError && <ErrorMessage title="Could not load users" />}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">
                  <input
                    type="checkbox"
                    aria-label="Select all active filtered users"
                    checked={activeFilteredUsers.length > 0 && activeFilteredUsers.every((user) => selectedIds.includes(user.id))}
                    onChange={toggleSelectAllFiltered}
                    className="h-4 w-4 rounded border-ink/20 accent-neon"
                  />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">User</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate sm:table-cell">Roles</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Status</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate md:table-cell">Last login</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    selected={selectedIds.includes(user.id)}
                    onToggleSelected={() => toggleSelection(user.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Audits ───────────────────────────────────────────────────────────────────

function AuditsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedTopic, setSelectedTopic] = useState("all");
  const [selectedAction, setSelectedAction] = useState("all");
  const { data: audits, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.audits(),
    queryFn: () => getAudits(),
    staleTime: 30_000,
  });

  const activityRows = useMemo(() => (audits ?? []).map(buildActivityView), [audits]);
  const userOptions = useMemo(
    () => Array.from(new Set(activityRows.map((entry) => entry.userLabel))).sort(),
    [activityRows]
  );
  const topicOptions = useMemo(
    () => Array.from(new Set(activityRows.map((entry) => entry.topic))).sort(),
    [activityRows]
  );
  const actionOptions = useMemo(
    () => Array.from(new Set(activityRows.map((entry) => entry.action))).sort(),
    [activityRows]
  );

  const filteredActivityRows = useMemo(
    () =>
      activityRows.filter((entry) => {
        if (selectedUser !== "all" && entry.userLabel !== selectedUser) return false;
        if (selectedTopic !== "all" && entry.topic !== selectedTopic) return false;
        if (selectedAction !== "all" && entry.action !== selectedAction) return false;
        return true;
      }),
    [activityRows, selectedAction, selectedTopic, selectedUser]
  );

  const totalPages = Math.max(1, Math.ceil(filteredActivityRows.length / ACTIVITY_PAGE_SIZE));
  const pagedAudits = useMemo(() => {
    const start = (page - 1) * ACTIVITY_PAGE_SIZE;
    return filteredActivityRows.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [filteredActivityRows, page]);

  const { mutate: exportActivityCsv, isPending: exportingActivity } = useMutation({
    mutationFn: async () => {
      const rows: Array<Array<unknown>> = [
        ["Date", "User", "Role", "IP", "Topic", "Context", "Meta", "Action"],
        ...filteredActivityRows.map((entry) => [
          entry.dateValue,
          entry.userLabel,
          entry.roleLabel,
          entry.ip,
          entry.topic,
          entry.context,
          entry.meta,
          entry.action,
        ]),
      ];
      downloadCsv(`activity-log-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows));
    },
    onSuccess: () => toast.success("Activity log CSV exported."),
    onError: () => toast.error("Could not export activity log CSV."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border border-ink/10 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[11rem]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">User</label>
            <select
              value={selectedUser}
              onChange={(e) => {
                setSelectedUser(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-neon"
            >
              <option value="all">All users</option>
              {userOptions.map((user) => <option key={user} value={user}>{user}</option>)}
            </select>
          </div>
          <div className="min-w-[11rem]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">Topic</label>
            <select
              value={selectedTopic}
              onChange={(e) => {
                setSelectedTopic(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-neon"
            >
              <option value="all">All topics</option>
              {topicOptions.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
            </select>
          </div>
          <div className="min-w-[11rem]">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">Action</label>
            <select
              value={selectedAction}
              onChange={(e) => {
                setSelectedAction(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-neon"
            >
              <option value="all">All actions</option>
              {actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate">{filteredActivityRows.length} item(s)</p>
          <Button variant="secondary" size="sm" isLoading={exportingActivity} onClick={() => exportActivityCsv()}>
            <Download size={14} />
            Export activity logs
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPage(1);
              void queryClient.invalidateQueries({ queryKey: queryKeys.admin.audits() });
            }}
          >
            <RefreshCw size={14} />
            Refresh activity log
          </Button>
        </div>
      </div>

      {isLoading && <PageSpinner />}
      {isError && <ErrorMessage title="Could not load activity log" />}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Date</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">User</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate md:table-cell">IP</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate lg:table-cell">Topic</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate xl:table-cell">Context</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate xl:table-cell">Meta</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {filteredActivityRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate">No activity entries.</td>
                </tr>
              ) : (
                pagedAudits.map((entry) => (
                  <tr key={entry.id} className="hover:bg-ash/50">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-ink">{entry.dateLabel}</p>
                      <p className="text-xs text-slate">{entry.dateValue}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-neon">{entry.userLabel}</p>
                      <p className="text-xs text-slate">{entry.roleLabel}</p>
                    </td>
                    <td className="hidden px-5 py-3 text-slate md:table-cell">{entry.ip}</td>
                    <td className="hidden px-5 py-3 text-slate lg:table-cell">{entry.topic}</td>
                    <td className="hidden px-5 py-3 text-slate xl:table-cell">{entry.context}</td>
                    <td className="hidden px-5 py-3 text-xs text-slate xl:table-cell">
                      <div className="max-w-md whitespace-normal break-words">{entry.meta}</div>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-neon">{entry.action}</p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && (audits?.length ?? 0) > ACTIVITY_PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-3xl border border-ink/10 bg-white px-4 py-3">
          <p className="text-sm text-slate">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────

function NotificationsTab() {
  const queryClient = useQueryClient();

  const { data: notifications, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.notifications(),
    queryFn: getNotifications,
    staleTime: 30_000,
  });

  const { mutate: process, isPending: processing } = useMutation({
    mutationFn: processNotifications,
    onSuccess: (result) => {
      toast.success(`Processed ${result.processed} notification(s).`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.operations() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.audits() });
    },
    onError: () => toast.error("Processing failed."),
  });

  const { mutate: exportNotificationsCsv, isPending: exportingNotifications } = useMutation({
    mutationFn: async () => {
      const rows: Array<Array<unknown>> = [
        ["Recipient", "Subject", "Status", "Created", "Processed", "Attempts", "Error"],
        ...((notifications ?? []).map((notification) => [
          notification.recipient,
          notification.subject,
          notification.status,
          notification.createdAt,
          notification.processedAt || "—",
          notification.attemptCount ?? 0,
          notification.errorMessage || "—",
        ])),
      ];
      downloadCsv(`notifications-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(rows));
    },
    onSuccess: () => toast.success("Notifications CSV exported."),
    onError: () => toast.error("Could not export notifications CSV."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" isLoading={exportingNotifications} onClick={() => exportNotificationsCsv()}>
          <Download size={14} />
          Export notifications
        </Button>
        <Button variant="secondary" size="sm" isLoading={processing} onClick={() => process()}>
          <RefreshCw size={14} />
          Process queue
        </Button>
      </div>

      {isLoading && <PageSpinner />}
      {isError && <ErrorMessage title="Could not load notifications" />}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Recipient</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate sm:table-cell">Subject</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Status</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {(!notifications || notifications.length === 0) ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate">No notifications in queue.</td>
                </tr>
              ) : (
                notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-ash/50">
                    <td className="px-5 py-3 text-sm text-ink">{n.recipient}</td>
                    <td className="hidden px-5 py-3 text-slate sm:table-cell">{n.subject}</td>
                    <td className="px-5 py-3">
                      <Badge status={n.status} />
                    </td>
                    <td className="hidden px-5 py-3 text-xs text-slate md:table-cell">
                      {formatTimeAgo(n.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Operations() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <SectionHeader title="Operations" description="System overview, user management, activity log, and notification queue." />

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-xl px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition",
                tab === id
                  ? "bg-neon text-white shadow-sm"
                  : "bg-white text-slate hover:bg-[#eef3ff] hover:text-neon"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab />}
        {tab === "audits" && <AuditsTab />}
        {tab === "notifications" && <NotificationsTab />}
      </div>
    </PageShell>
  );
}
