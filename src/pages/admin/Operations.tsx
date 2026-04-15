import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, KeyRound, Download, Trophy, BarChart3, Users, Activity } from "lucide-react";
import type { Workbook, Worksheet, Cell, Row } from "exceljs";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { PageSpinner } from "@/components/ui/Spinner";
import {
  getOperations,
  getReports,
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
import { formatDate, formatMoney, formatTimeAgo } from "@/lib/formatters";
import { cn } from "@/lib/cn";
import type { AdminUser, AuditEntry } from "@/types";
import { useAuth } from "@/context/auth-context";

type Tab = "overview" | "users" | "audits" | "reports" | "notifications";
const ACTIVITY_PAGE_SIZE = 10;
const NOTIFICATION_PAGE_SIZE = 10;

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "audits", label: "Activity log" },
  { id: "reports", label: "Reports" },
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
  const isAuthEvent =
    entry.eventType.includes("LOGIN") ||
    entry.eventType.includes("LOGOUT") ||
    entry.eventType.includes("SESSION") ||
    entry.eventType.includes("PASSWORD") ||
    entry.eventType.startsWith("ACCOUNT_");

  const topic =
    entry.entityType === "user" || isAuthEvent
      ? "Users"
      : entry.entityType === "item" || entry.eventType.includes("BID")
        ? "Items"
        : entry.eventType.includes("CATEGORY")
          ? "Categories"
          : entry.entityType === "export"
            ? "Exports"
            : "System";

  const context =
    entry.eventType.includes("LOGIN") || entry.eventType.includes("LOGOUT") || entry.eventType.includes("SESSION")
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
    LOGIN_SUCCEEDED: "Logged In",
    LOGIN_FAILED: "Login Failed",
    LOGIN_BLOCKED: "Login Blocked",
    LOGOUT_SUCCEEDED: "Logged Out",
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

const downloadWorkbook = async (filename: string, workbook: Workbook) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

const BRAND_BLUE = "1D326C";
const SUCCESS_FILL = "E8F7EE";
const SUCCESS_TEXT = "0F8A5F";
const WARNING_FILL = "FFF6E5";
const WARNING_TEXT = "A16207";
const DANGER_FILL = "FDECEC";
const DANGER_TEXT = "B42318";
const INFO_FILL = "EEF3FF";
const INFO_TEXT = "1D4ED8";
const GOLD_TEXT = "E6B34A";

const buildBar = (value: number, max: number, width = 14) => {
  if (max <= 0 || value <= 0) return "";
  const size = Math.max(1, Math.round((value / max) * width));
  return "█".repeat(size);
};

const styleWorksheet = (worksheet: Worksheet) => {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).height = 22;
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_BLUE },
  };
  worksheet.getRow(1).alignment = { vertical: "middle" };
  worksheet.eachRow((row: Row, rowNumber: number) => {
    row.eachCell((cell: Cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
      if (rowNumber > 1) {
        cell.alignment = { vertical: "top", wrapText: true };
      }
    });
  });
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };
};

const addReportTitle = (worksheet: Worksheet, title: string, subtitle: string) => {
  worksheet.insertRow(1, []);
  worksheet.mergeCells(1, 1, 1, Math.max(worksheet.columnCount, 4));
  const titleCell = worksheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { size: 16, bold: true, color: { argb: BRAND_BLUE } };
  titleCell.alignment = { vertical: "middle" };

  worksheet.insertRow(2, []);
  worksheet.mergeCells(2, 1, 2, Math.max(worksheet.columnCount, 4));
  const subtitleCell = worksheet.getCell("A2");
  subtitleCell.value = subtitle;
  subtitleCell.font = { size: 11, color: { argb: "FF64748B" } };

  worksheet.spliceRows(3, 0, worksheet.getRow(1).values as []);
  const headerRow = worksheet.getRow(3);
  headerRow.eachCell((cell: Cell, colNumber: number) => {
    cell.value = worksheet.getCell(4, colNumber).value;
  });
  worksheet.spliceRows(4, 1);
  worksheet.views = [{ state: "frozen", ySplit: 3 }];
  worksheet.getRow(3).height = 22;
  worksheet.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(3).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_BLUE },
  };
  worksheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: worksheet.columnCount },
  };
};

const styleReportSheet = (worksheet: Worksheet, title: string, subtitle: string) => {
  styleWorksheet(worksheet);
  addReportTitle(worksheet, title, subtitle);
};

const stylePillCell = (cell: Cell, fill: string, text: string) => {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fill },
  };
  cell.font = {
    bold: true,
    color: { argb: text },
  };
  cell.alignment = {
    vertical: "middle",
    horizontal: "center",
  };
};

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: queryKeys.admin.operations(),
    queryFn: getOperations,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <ErrorMessage title="Could not load overview" />;

  const { summary } = data;
  const recentActivity = data.recentAudits.slice(0, 6).map(buildActivityView);
  const comparisonRows = [
    { label: "Total items", value: summary.totalItems, tone: "bg-neon" },
    { label: "Live", value: summary.liveCount, tone: "bg-emerald-500" },
    { label: "Closed", value: summary.closedCount, tone: "bg-amber-500" },
    { label: "Archived", value: summary.archivedCount, tone: "bg-rose-500" },
  ];
  const comparisonMax = Math.max(...comparisonRows.map((row) => row.value), 1);
  const overviewCards = [
    {
      label: "Wins recorded",
      value: summary.wins,
      note: summary.wins > 0 ? "Successful bid outcomes recorded" : "No wins recorded yet",
      icon: Trophy,
      accent: "from-[#ff8458] to-[#ff6b2c]",
      text: "text-white",
      muted: "text-white/80",
      iconClassName: "bg-white/20 text-white",
    },
    {
      label: "Admin accounts",
      value: summary.adminUsers + summary.superAdminUsers,
      note: `${summary.superAdminUsers} super admin · ${summary.adminUsers} admin`,
      icon: KeyRound,
      accent: "from-white to-[#f8fafc]",
      text: "text-ink",
      muted: "text-slate",
      iconClassName: "bg-[#eef3ff] text-neon",
    },
    {
      label: "Active users",
      value: summary.activeUsers,
      note: `${summary.totalUsers} total registered users`,
      icon: Users,
      accent: "from-white to-[#f8fafc]",
      text: "text-ink",
      muted: "text-slate",
      iconClassName: "bg-[#eef3ff] text-neon",
    },
    {
      label: "Activity entries",
      value: summary.auditCount,
      note: summary.pendingNotifications > 0 ? `${summary.pendingNotifications} notifications pending` : "Notification queue is clear",
      icon: Activity,
      accent: "from-white to-[#f8fafc]",
      text: "text-ink",
      muted: "text-slate",
      iconClassName: "bg-[#eef3ff] text-neon",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[2rem] border border-ink/10 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate">Auction intelligence</p>
                <h2 className="mt-2 text-[28px] font-semibold text-neon sm:text-[32px]">Overview dashboard</h2>
                <p className="mt-1.5 max-w-2xl text-sm text-slate">
                  Track platform health, operator activity, and live auction movement from one dashboard.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate">
                  <span className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1 font-medium", isFetching ? "bg-[#eef3ff] text-neon" : "bg-[#f8fafc] text-slate")}>
                    <span className={cn("h-2 w-2 rounded-full", isFetching ? "bg-neon animate-pulse" : "bg-emerald-500")} />
                    {isFetching ? "Refreshing live data" : "Live data"}
                  </span>
                  <span>Last updated {formatTimeAgo(new Date(dataUpdatedAt).toISOString())}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => void refetch()}>
                <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
                Refresh overview
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {overviewCards.map(({ label, value, note, icon: Icon, accent, text, muted, iconClassName }) => (
                <div
                  key={label}
                  className={`rounded-[1.6rem] bg-gradient-to-br ${accent} p-4 shadow-[0_16px_35px_rgba(15,23,42,0.06)]`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${muted}`}>{label}</p>
                      <p className={`mt-3 text-[2rem] font-semibold leading-none ${text}`}>{value}</p>
                      <p className={`mt-2.5 text-sm ${muted}`}>{note}</p>
                    </div>
                    <span className={cn("inline-flex h-11 w-11 items-center justify-center rounded-2xl", iconClassName)}>
                      <Icon size={20} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Card className="border-none bg-[#fbfcff] shadow-none">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef3ff] text-neon">
                <BarChart3 size={20} />
              </span>
              <div>
                <p className="text-lg font-semibold text-ink">Platform comparison</p>
                <p className="text-sm text-slate">How the major platform states compare right now.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {comparisonRows.map((row) => (
                <div key={row.label} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{row.label}</p>
                    <p className="text-sm font-semibold text-ink">{row.value}</p>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[#edf1f7]">
                    <div
                      className={`h-full rounded-full ${row.tone}`}
                      style={{ width: `${Math.max((row.value / comparisonMax) * 100, row.value > 0 ? 10 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[1.4rem] border border-ink/10 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Queue snapshot</p>
              <div className="mt-3 space-y-2">
                <p className="text-xl font-semibold text-neon">{summary.pendingNotifications}</p>
                <p className="text-sm text-slate">Pending notification(s)</p>
                <p className="text-xs text-slate">
                  {summary.pendingNotifications > 0
                    ? "There are queued notifications waiting for delivery or retry."
                    : "The notification queue is currently clear."}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Recent activity</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Latest audit events</h3>
            </div>
            <p className="text-sm text-slate">{recentActivity.length} visible event(s)</p>
          </div>
          <div className="space-y-3">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-slate">No recent activity recorded.</p>
            ) : recentActivity.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-ink/10 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-ink">{entry.action}</p>
                    <p className="mt-1 text-xs text-slate">{entry.userLabel} · {entry.topic} · {entry.context}</p>
                    <p className="mt-2 text-xs text-slate">{entry.meta}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-neon">{entry.dateLabel}</p>
                    <p className="text-xs text-slate">{entry.dateValue}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Operations summary</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Core numbers</h3>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Total users", value: summary.totalUsers },
              { label: "Disabled users", value: summary.disabledUsers },
              { label: "Super admins", value: summary.superAdminUsers },
              { label: "Closed auctions", value: summary.closedCount },
              { label: "Live auctions", value: summary.liveCount },
              { label: "Archived lots", value: summary.archivedCount },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-ink/10 bg-[#fbfcff] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate">{label}</p>
                <p className="mt-3 text-2xl font-semibold text-neon">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
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
  const [includeSecurity, setIncludeSecurity] = useState(true);
  const { data: auditPage, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.audits({ page, pageSize: ACTIVITY_PAGE_SIZE, includeSecurity: includeSecurity ? 1 : 0 }),
    queryFn: () => getAudits({ page, pageSize: ACTIVITY_PAGE_SIZE, includeSecurity: includeSecurity ? 1 : 0 }),
    staleTime: 30_000,
  });

  const activityRows = useMemo(() => (auditPage?.items ?? []).map(buildActivityView), [auditPage]);
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

  const totalPages = Math.max(1, auditPage?.pageSize ? Math.ceil((auditPage.total ?? 0) / auditPage.pageSize) : 1);

  const { mutate: exportActivityCsv, isPending: exportingActivity } = useMutation({
        mutationFn: async () => {
          const rows: Array<Array<unknown>> = [
            ["Date", "User", "Role", "IP", "Topic", "Context", "Meta", "Action"],
        ...activityRows.map((entry) => [
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
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-slate">Log scope</label>
            <select
              value={includeSecurity ? "all" : "operational"}
              onChange={(e) => {
                setIncludeSecurity(e.target.value === "all");
                setPage(1);
              }}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-neon"
            >
              <option value="all">All activity</option>
              <option value="operational">Operational only</option>
            </select>
          </div>
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
              void queryClient.invalidateQueries({ queryKey: queryKeys.admin.audits({}) });
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
                filteredActivityRows.map((entry) => (
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

      {!isLoading && !isError && (auditPage?.total ?? 0) > ACTIVITY_PAGE_SIZE && (
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

function ReportsTab() {
  const queryClient = useQueryClient();
  const [exportStage, setExportStage] = useState<string>("");
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: queryKeys.admin.reports(),
    queryFn: getReports,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const { mutate: exportReportsCsv, isPending: exportingReports } = useMutation({
    mutationFn: async () => {
      setExportStage("Refreshing report data…");
      const latestData = await queryClient.fetchQuery({
        queryKey: queryKeys.admin.reports(),
        queryFn: getReports,
        staleTime: 0,
      });

      await yieldToBrowser();
      setExportStage("Preparing workbook…");
      const ExcelJS = await import("exceljs");
      await yieldToBrowser();

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "FMDQ Auctions Portal";
      workbook.created = new Date();
      workbook.modified = new Date();

      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Metric", key: "metric", width: 24 },
        { header: "Value", key: "value", width: 14 },
        { header: "Graph", key: "graph", width: 18 },
      ];
      const summaryRows = [
        { metric: "Winning bidders", value: latestData.summary.winners },
        { metric: "Won items", value: latestData.summary.wonItems },
        { metric: "No-bid items", value: latestData.summary.noBidItems },
        { metric: "Reserve not met", value: latestData.summary.reserveNotMetItems },
      ];
      const summaryMax = Math.max(...summaryRows.map((row) => row.value), 1);
      summaryRows.forEach((row) => {
        summarySheet.addRow({
          ...row,
          graph: buildBar(row.value, summaryMax),
        });
      });
      styleReportSheet(summarySheet, "Auction Reports Summary", "Top-level auction reporting metrics");
      summarySheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 3) return;
        const metricCell = row.getCell(1);
        const valueCell = row.getCell(2);
        const graphCell = row.getCell(3);
        metricCell.font = { bold: true, color: { argb: BRAND_BLUE } };
        graphCell.font = { color: { argb: GOLD_TEXT } };
        if (Number(valueCell.value) === 0) {
          stylePillCell(valueCell, INFO_FILL, INFO_TEXT);
        } else if (metricCell.value === "Reserve not met") {
          stylePillCell(valueCell, WARNING_FILL, WARNING_TEXT);
        } else {
          stylePillCell(valueCell, SUCCESS_FILL, SUCCESS_TEXT);
        }
      });

      const winnersSheet = workbook.addWorksheet("Winners");
      winnersSheet.columns = [
        { header: "Winner", key: "bidder", width: 24 },
        { header: "Items won", key: "itemsWon", width: 12 },
        { header: "Items graph", key: "itemsGraph", width: 18 },
        { header: "Total won amount", key: "totalWonAmount", width: 18 },
        { header: "Amount graph", key: "amountGraph", width: 18 },
        { header: "Items", key: "itemTitles", width: 40 },
      ];
      const maxItemsWon = Math.max(...latestData.winners.map((winner) => winner.itemsWon), 1);
      const maxWonAmount = Math.max(...latestData.winners.map((winner) => winner.totalWonAmount), 1);
      latestData.winners.forEach((winner) => {
        winnersSheet.addRow({
          bidder: winner.bidder,
          itemsWon: winner.itemsWon,
          itemsGraph: buildBar(winner.itemsWon, maxItemsWon),
          totalWonAmount: winner.totalWonAmount,
          amountGraph: buildBar(winner.totalWonAmount, maxWonAmount),
          itemTitles: winner.itemTitles.join(", "),
        });
      });
      winnersSheet.getColumn("totalWonAmount").numFmt = '"NGN" #,##0';
      styleReportSheet(winnersSheet, "Winning Bidders", "Grouped by bidder with value and item counts");
      winnersSheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 3) return;
        row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE } };
        row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
        row.getCell(4).font = { bold: true, color: { argb: SUCCESS_TEXT } };
      });
      winnersSheet.spliceColumns(5, 1);
      winnersSheet.spliceColumns(3, 1);
      winnersSheet.getColumn(1).width = 24;
      winnersSheet.getColumn(2).width = 12;
      winnersSheet.getColumn(3).width = 18;
      winnersSheet.getColumn(4).width = 40;

      const wonItemsSheet = workbook.addWorksheet("Won Items");
      wonItemsSheet.columns = [
        { header: "Winner", key: "winner", width: 24 },
        { header: "Item", key: "title", width: 28 },
        { header: "Lot", key: "lot", width: 14 },
        { header: "Category", key: "category", width: 18 },
        { header: "Winning bid", key: "winningBid", width: 18 },
        { header: "Closed", key: "endTime", width: 22 },
        { header: "Reserve outcome", key: "reserveOutcome", width: 18 },
      ];
      latestData.wonItems.forEach((item) => {
        wonItemsSheet.addRow({
          ...item,
          endTime: formatDate(item.endTime),
        });
      });
      wonItemsSheet.getColumn("winningBid").numFmt = '"NGN" #,##0';
      styleReportSheet(wonItemsSheet, "Won Items", "Closed auction lots with successful winners");
      wonItemsSheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 3) return;
        row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE } };
        row.getCell(5).font = { bold: true, color: { argb: SUCCESS_TEXT } };
        const reserveCell = row.getCell(7);
        const reserveValue = String(reserveCell.value ?? "").toLowerCase();
        if (reserveValue === "reserve_met") {
          stylePillCell(reserveCell, SUCCESS_FILL, SUCCESS_TEXT);
          reserveCell.value = "Reserve met";
        } else if (reserveValue === "no_reserve") {
          stylePillCell(reserveCell, INFO_FILL, INFO_TEXT);
          reserveCell.value = "No reserve";
        } else {
          stylePillCell(reserveCell, WARNING_FILL, WARNING_TEXT);
          reserveCell.value = humanizeKey(String(reserveCell.value ?? ""));
        }
      });

      const noBidSheet = workbook.addWorksheet("No Bid Items");
      noBidSheet.columns = [
        { header: "Item", key: "title", width: 28 },
        { header: "Lot", key: "lot", width: 14 },
        { header: "Category", key: "category", width: 18 },
        { header: "Status", key: "status", width: 14 },
        { header: "Archived", key: "archived", width: 12 },
        { header: "End time", key: "endTime", width: 22 },
      ];
      latestData.noBidItems.forEach((item) => {
        noBidSheet.addRow({
          ...item,
          archived: item.archived ? "Yes" : "No",
          endTime: formatDate(item.endTime),
        });
      });
      styleReportSheet(noBidSheet, "No-Bid Items", "Lots with no bidding activity");
      noBidSheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 3) return;
        row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE } };
        const statusCell = row.getCell(4);
        const statusValue = String(statusCell.value ?? "");
        if (statusValue === "Closed") {
          stylePillCell(statusCell, WARNING_FILL, WARNING_TEXT);
        } else if (statusValue === "Live") {
          stylePillCell(statusCell, INFO_FILL, INFO_TEXT);
        } else if (statusValue === "Upcoming") {
          stylePillCell(statusCell, INFO_FILL, INFO_TEXT);
        } else {
          stylePillCell(statusCell, DANGER_FILL, DANGER_TEXT);
        }
        const archivedCell = row.getCell(5);
        if (String(archivedCell.value ?? "") === "Yes") {
          stylePillCell(archivedCell, DANGER_FILL, DANGER_TEXT);
        } else {
          stylePillCell(archivedCell, SUCCESS_FILL, SUCCESS_TEXT);
        }
      });

      const reserveNotMetSheet = workbook.addWorksheet("Reserve Not Met");
      reserveNotMetSheet.columns = [
        { header: "Item", key: "title", width: 28 },
        { header: "Lot", key: "lot", width: 14 },
        { header: "Category", key: "category", width: 18 },
        { header: "Current bid", key: "currentBid", width: 18 },
        { header: "Closed", key: "endTime", width: 22 },
      ];
      latestData.reserveNotMetItems.forEach((item) => {
        reserveNotMetSheet.addRow({
          ...item,
          endTime: formatDate(item.endTime),
        });
      });
      reserveNotMetSheet.getColumn("currentBid").numFmt = '"NGN" #,##0';
      styleReportSheet(reserveNotMetSheet, "Reserve Not Met", "Closed lots that received bids but did not clear reserve");
      reserveNotMetSheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 3) return;
        row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE } };
        row.getCell(4).font = { bold: true, color: { argb: WARNING_TEXT } };
      });

      setExportStage("Downloading workbook…");
      await yieldToBrowser();
      await downloadWorkbook(`auction-reports-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook);
    },
    onSuccess: () => toast.success("Reports workbook exported."),
    onError: () => toast.error("Could not export reports workbook."),
    onSettled: () => setExportStage(""),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return <ErrorMessage title="Could not load reports" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-end">
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => void refetch()}>
              <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
              Refresh reports
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="min-w-[12.5rem] shadow-[0_12px_24px_rgba(15,23,42,0.06)]"
              isLoading={exportingReports}
              onClick={() => exportReportsCsv()}
            >
              <Download size={14} />
              {exportingReports ? "Exporting workbook" : "Export reports workbook"}
            </Button>
          </div>
          <p className="min-h-[1.25rem] text-right text-xs text-slate">
            {exportStage || " "}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border-none bg-[#fbfcff] shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Leaderboard</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Winning bidders</h3>
            </div>
            <p className="text-sm text-slate">{data.winners.length} bidder(s)</p>
          </div>

          <div className="overflow-hidden rounded-[1.4rem] border border-ink/10 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Winner</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Items won</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Total won amount</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data.winners.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate">No winners yet.</td></tr>
              ) : data.winners.map((winner) => (
                <tr key={winner.bidder}>
                  <td className="px-5 py-3 font-semibold text-ink">{winner.bidder}</td>
                  <td className="px-5 py-3 text-slate">{winner.itemsWon}</td>
                  <td className="px-5 py-3 text-slate">{formatMoney(winner.totalWonAmount)}</td>
                  <td className="px-5 py-3 text-slate">{winner.itemTitles.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        </Card>

        <Card className="overflow-hidden border-none bg-[#fbfcff] shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Outcome ledger</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Won items</h3>
            </div>
            <p className="text-sm text-slate">{data.wonItems.length} successful lot(s)</p>
          </div>

          <div className="overflow-hidden rounded-[1.4rem] border border-ink/10 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Item</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Winner</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Winning bid</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data.wonItems.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate">No won items yet.</td></tr>
              ) : data.wonItems.map((item) => (
                <tr key={item.itemId}>
                  <td className="px-5 py-3">
                    <p className="font-semibold text-ink">{item.title}</p>
                    <p className="text-xs text-slate">Lot {item.lot} · {item.category}</p>
                  </td>
                  <td className="px-5 py-3 text-slate">{item.winner}</td>
                  <td className="px-5 py-3 text-slate">{formatMoney(item.winningBid)}</td>
                  <td className="px-5 py-3 text-slate">{formatDate(item.endTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-none bg-[#fbfcff] shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Attention needed</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">No-bid items</h3>
            </div>
            <p className="text-sm text-slate">{data.noBidItems.length} lot(s)</p>
          </div>
          <div className="space-y-3">
            {data.noBidItems.length === 0 ? (
              <p className="text-sm text-slate">Every tracked item has at least one bid.</p>
            ) : data.noBidItems.map((item) => (
              <div key={item.itemId} className="rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="text-xs text-slate">Lot {item.lot} · {item.category}</p>
                <p className="mt-1 text-xs text-slate">{item.status} · {formatDate(item.endTime)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-none bg-[#fbfcff] shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate">Reserve pressure</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">Reserve not met</h3>
            </div>
            <p className="text-sm text-slate">{data.reserveNotMetItems.length} lot(s)</p>
          </div>
          <div className="space-y-3">
            {data.reserveNotMetItems.length === 0 ? (
              <p className="text-sm text-slate">No closed items are currently below reserve.</p>
            ) : data.reserveNotMetItems.map((item) => (
              <div key={item.itemId} className="rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="text-xs text-slate">Lot {item.lot} · {item.category}</p>
                <p className="mt-1 text-xs text-slate">Current bid {formatMoney(item.currentBid)} · {formatDate(item.endTime)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────

function NotificationsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: notificationPage, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.notifications({ page, pageSize: NOTIFICATION_PAGE_SIZE }),
    queryFn: () => getNotifications({ page, pageSize: NOTIFICATION_PAGE_SIZE }),
    staleTime: 30_000,
  });

  const notifications = notificationPage?.items ?? [];
  const totalPages = Math.max(1, notificationPage?.pageSize ? Math.ceil((notificationPage.total ?? 0) / notificationPage.pageSize) : 1);

  const { mutate: process, isPending: processing } = useMutation({
    mutationFn: processNotifications,
    onSuccess: (result) => {
      toast.success(`Processed ${result.processed} notification(s).`);
      setPage(1);
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
        ...(notifications.map((notification) => [
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
              {notifications.length === 0 ? (
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

      {!isLoading && !isError && (notificationPage?.total ?? 0) > NOTIFICATION_PAGE_SIZE && (
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Operations() {
  const { isSuperAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const visibleTabs = isSuperAdmin ? TABS : TABS.filter(({ id }) => id !== "notifications");
  const activeTab = !isSuperAdmin && tab === "notifications" ? "overview" : tab;

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <SectionHeader title="Operations" description="System overview, user management, activity log, and notification queue." />

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto">
          {visibleTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-xl px-5 py-2.5 text-sm font-semibold whitespace-nowrap transition",
                activeTab === id
                  ? "bg-neon text-white shadow-sm"
                  : "bg-white text-slate hover:bg-[#eef3ff] hover:text-neon"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "audits" && <AuditsTab />}
        {activeTab === "reports" && <ReportsTab />}
        {isSuperAdmin && activeTab === "notifications" && <NotificationsTab />}
      </div>
    </PageShell>
  );
}
