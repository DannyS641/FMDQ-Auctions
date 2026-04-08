import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
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
} from "@/api/admin";
import { queryKeys } from "@/lib/query-keys";
import { formatTimeAgo } from "@/lib/formatters";
import { cn } from "@/lib/cn";
import type { AdminUser } from "@/types";

type Tab = "overview" | "users" | "audits" | "notifications";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "audits", label: "Audit log" },
  { id: "notifications", label: "Notifications" },
];

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
    { label: "Audit entries", value: summary.auditCount },
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
            Recent audit activity
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

function UserRow({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();

  const { mutate: toggleStatus, isPending: togglingStatus } = useMutation({
    mutationFn: () => user.status === "disabled" ? enableUser(user.id) : disableUser(user.id),
    onSuccess: () => {
      toast.success(user.status === "disabled" ? "User enabled." : "User disabled.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: () => toast.error("Could not update user."),
  });

  return (
    <tr className="transition hover:bg-ash/50">
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
        <Button
          variant={user.status === "disabled" ? "secondary" : "ghost"}
          size="sm"
          isLoading={togglingStatus}
          onClick={() => toggleStatus()}
        >
          {user.status === "disabled" ? "Enable" : "Disable"}
        </Button>
      </td>
    </tr>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
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

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search users by name or email…"
        className="w-full max-w-sm rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon"
      />

      {isLoading && <PageSpinner />}
      {isError && <ErrorMessage title="Could not load users" />}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
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
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => <UserRow key={user.id} user={user} />)
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
  const { data: audits, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.audits(),
    queryFn: () => getAudits(),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col gap-4">
      {isLoading && <PageSpinner />}
      {isError && <ErrorMessage title="Could not load audit log" />}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-ash text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Event</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate sm:table-cell">Actor</th>
                <th className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate md:table-cell">Entity</th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {(!audits || audits.length === 0) ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate">No audit entries.</td>
                </tr>
              ) : (
                audits.map((entry) => (
                  <tr key={entry.id} className="hover:bg-ash/50">
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-ink">{entry.eventType}</p>
                    </td>
                    <td className="hidden px-5 py-3 text-slate sm:table-cell">{entry.actor}</td>
                    <td className="hidden px-5 py-3 text-slate md:table-cell">
                      {entry.entityType} · {entry.entityId}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate">{formatTimeAgo(entry.createdAt)}</td>
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
    },
    onError: () => toast.error("Processing failed."),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
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
        <SectionHeader title="Operations" description="System overview, user management, audit log, and notification queue." />

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
