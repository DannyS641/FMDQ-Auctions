import "./styles.css";
import {
  AdminUser,
  apiFetch,
  assignUserRole,
  bulkImportUsers,
  fetchAdminRoles,
  fetchAdminUsers,
  fetchCurrentSession,
  getAuditHeaders,
  readAuthSession,
  removeUserRole
} from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

type OperationsPayload = {
  summary: {
    totalItems: number;
    liveCount: number;
    closedCount: number;
    archivedCount: number;
    pendingNotifications: number;
    auditCount: number;
    totalUsers?: number;
    activeUsers?: number;
    disabledUsers?: number;
    adminUsers?: number;
    superAdminUsers?: number;
  };
  recentAudits: AuditEntry[];
  notificationQueue: NotificationEntry[];
};

type AuditEntry = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actor: string;
  createdAt: string;
  details?: string;
};

type NotificationEntry = {
  id: string;
  eventType: string;
  recipient: string;
  subject: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  errorMessage?: string;
};

type AuctionItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  location: string;
  currentBid: number;
  startBid: number;
  reserve: number;
  increment: number;
  startTime: string;
  endTime: string;
  archivedAt?: string | null;
};

type WonAuction = {
  id: string;
  title: string;
  category: string;
  lot: string;
  location: string;
  currentBid: number;
  endTime: string;
  wonAt: string;
};

const TILE_PAGE_SIZE = 10;

let visibleAudits: AuditEntry[] = [];
let visibleNotifications: NotificationEntry[] = [];
let auditPage = 1;
let notificationPage = 1;

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const sortByMostRecent = <T extends { createdAt: string }>(entries: T[]) =>
  [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
const slicePage = <T>(entries: T[], page: number) => entries.slice((page - 1) * TILE_PAGE_SIZE, page * TILE_PAGE_SIZE);
const renderPageButtons = (totalItems: number, currentPage: number, kind: "audit" | "notification") => {
  const totalPages = Math.max(1, Math.ceil(totalItems / TILE_PAGE_SIZE));
  return Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    const active = page === currentPage;
    return `
      <button
        data-page-kind="${kind}"
        data-page-number="${page}"
        class="h-10 min-w-10 rounded-[0.9rem] px-3 text-xs font-semibold transition ${
          active
            ? "bg-[#1d326c] text-white"
            : "border border-ink/10 bg-white text-ink hover:border-[#1d326c]/25 hover:text-[#1d326c]"
        }"
      >
        ${page}
      </button>
    `;
  }).join("");
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const downloadJson = (payload: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, filename);
};

const fetchJson = async <T>(path: string) => {
  const response = await apiFetch(path, {
    headers: getAuditHeaders()
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload;
};

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#operations-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "operations", showAdminLinks: true })}
      <main class="mx-auto w-full max-w-7xl px-6 py-10">${content}</main>
    </div>
  `;
  wireAppHeader();
  revealApp();
};

const renderError = (message: string) => {
  renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">${message}</div>`);
};

const renderAuditTiles = () => {
  const results = document.querySelector<HTMLDivElement>("#audit-results");
  const summary = document.querySelector<HTMLParagraphElement>("#audit-page-summary");
  const pager = document.querySelector<HTMLDivElement>("#audit-pager");
  if (!results || !summary || !pager) return;

  const totalPages = Math.max(1, Math.ceil(visibleAudits.length / TILE_PAGE_SIZE));
  auditPage = Math.min(Math.max(1, auditPage), totalPages);
  const pageItems = slicePage(visibleAudits, auditPage);

  results.innerHTML = pageItems.length
    ? pageItems
        .map(
          (audit) => `
            <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
              <div class="flex items-center justify-between gap-4">
                <p class="text-sm font-semibold text-ink">${audit.eventType}</p>
                <p class="text-xs text-slate">${formatDate(audit.createdAt)}</p>
              </div>
              <p class="mt-2 text-xs text-slate">${audit.entityType} · ${audit.entityId}</p>
              <p class="mt-1 text-sm text-ink">Actor: ${audit.actor}</p>
            </div>
          `
        )
        .join("")
    : `<p class="text-sm text-slate">No audit records available.</p>`;

  const start = visibleAudits.length ? (auditPage - 1) * TILE_PAGE_SIZE + 1 : 0;
  const end = visibleAudits.length ? Math.min(auditPage * TILE_PAGE_SIZE, visibleAudits.length) : 0;
  summary.textContent = `Showing ${start}-${end} of ${visibleAudits.length}`;
  pager.innerHTML = renderPageButtons(visibleAudits.length, auditPage, "audit");
};

const renderNotificationTiles = () => {
  const results = document.querySelector<HTMLDivElement>("#notification-results");
  const summary = document.querySelector<HTMLParagraphElement>("#notification-page-summary");
  const pager = document.querySelector<HTMLDivElement>("#notification-pager");
  if (!results || !summary || !pager) return;

  const totalPages = Math.max(1, Math.ceil(visibleNotifications.length / TILE_PAGE_SIZE));
  notificationPage = Math.min(Math.max(1, notificationPage), totalPages);
  const pageItems = slicePage(visibleNotifications, notificationPage);

  results.innerHTML = pageItems.length
    ? pageItems
        .map(
          (entry) => `
            <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
              <div class="flex items-center justify-between gap-4">
                <p class="text-sm font-semibold text-ink">${entry.eventType}</p>
                <span class="rounded-full ${
                  entry.status === "sent"
                    ? "bg-emerald-100 text-emerald-800"
                    : entry.status === "failed"
                      ? "bg-rose-100 text-rose-800"
                      : "bg-[#fff7e8] text-[#9a6408]"
                } px-3 py-1 text-xs font-semibold">${entry.status}</span>
              </div>
              <p class="mt-2 text-sm text-ink">${entry.subject}</p>
              <p class="mt-1 text-xs text-slate">${entry.recipient}</p>
              <p class="mt-1 text-xs text-slate">${formatDate(entry.createdAt)}</p>
            </div>
          `
        )
        .join("")
    : `<p class="text-sm text-slate">Notification queue is empty.</p>`;

  const start = visibleNotifications.length ? (notificationPage - 1) * TILE_PAGE_SIZE + 1 : 0;
  const end = visibleNotifications.length ? Math.min(notificationPage * TILE_PAGE_SIZE, visibleNotifications.length) : 0;
  summary.textContent = `Showing ${start}-${end} of ${visibleNotifications.length}`;
  pager.innerHTML = renderPageButtons(visibleNotifications.length, notificationPage, "notification");
};

const reserveState = (item: AuctionItem) => {
  if (item.reserve <= 0) return "No reserve";
  if (new Date(item.endTime).getTime() > Date.now()) return item.currentBid >= item.reserve ? "Reserve met" : "Reserve pending";
  return item.currentBid >= item.reserve ? "Reserve met" : "Reserve not met";
};

const renderPage = (
  sessionRole: string,
  operations: OperationsPayload,
  items: AuctionItem[],
  wins: WonAuction[],
  users: AdminUser[],
  roles: string[],
  audits: AuditEntry[]
) => {
  const isSuperAdmin = sessionRole === "SuperAdmin";
  visibleAudits = sortByMostRecent(audits);
  visibleNotifications = sortByMostRecent(operations.notificationQueue);
  auditPage = 1;
  notificationPage = 1;
  renderShell(`
    <section>
      <p class="text-xs uppercase tracking-[0.3em] text-slate">Operations desk</p>
      <h1 class="mt-2 text-3xl font-semibold text-ink">Platform controls</h1>
      <p class="mt-3 text-sm text-slate">Monitor activity, manage users and roles, review audits, and generate operational bundles from one workspace.</p>

      <div class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Total items</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.totalItems}</p></div>
        <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Live / Closed</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.liveCount} / ${operations.summary.closedCount}</p></div>
        <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Users</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.totalUsers ?? users.length}</p><p class="mt-2 text-xs text-slate">Active ${operations.summary.activeUsers ?? users.filter((user) => user.status === "active").length} · Disabled ${operations.summary.disabledUsers ?? users.filter((user) => user.status === "disabled").length}</p></div>
        <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Pending notifications</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.pendingNotifications}</p></div>
        <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Audit events</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.auditCount}</p><p class="mt-2 text-xs text-slate">Admins ${operations.summary.adminUsers ?? users.filter((user) => user.roles.includes("Admin")).length} · Super admins ${operations.summary.superAdminUsers ?? users.filter((user) => user.roles.includes("SuperAdmin")).length}</p></div>
      </div>

      <section class="mt-10 rounded-3xl border border-ink/10 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Spool workspace</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Generate auction bundles</h2>
          </div>
          <div class="rounded-2xl border border-ink/10 bg-ink/5 px-4 py-3 text-sm text-slate">
            Closed auctions: <span class="font-semibold text-ink">${items.filter((item) => new Date(item.endTime).getTime() < Date.now() && !item.archivedAt).length}</span> · Wins: <span class="font-semibold text-ink">${wins.length}</span>
          </div>
        </div>
        <div class="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div class="grid gap-4">
            <button id="spool-closed-auctions" class="rounded-[0.9rem] border border-[#1d326c] bg-[#1d326c] px-5 py-4 text-left text-white">
              <p class="text-xs uppercase tracking-[0.3em] text-white/70">Closed auctions</p>
              <p class="mt-2 text-lg font-semibold">Spool closed auction details</p>
            </button>
            <button id="spool-winner-summary" class="rounded-3xl border border-ink/10 bg-white px-5 py-4 text-left">
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Winner summary</p>
              <p class="mt-2 text-lg font-semibold text-ink">Spool winner summary bundle</p>
            </button>
            <button id="spool-notification-bundle" class="rounded-3xl border border-ink/10 bg-white px-5 py-4 text-left">
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Notification queue</p>
              <p class="mt-2 text-lg font-semibold text-ink">Spool notification queue snapshot</p>
            </button>
            <button id="process-notification-queue" class="rounded-3xl border border-ink/10 bg-white px-5 py-4 text-left">
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Queue processor</p>
              <p class="mt-2 text-lg font-semibold text-ink">Process notification queue now</p>
            </button>
          </div>
          <div class="rounded-3xl border border-ink/10 bg-ink/5 p-5">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Filtered bundle</p>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <label class="grid gap-2">
                <span class="text-xs uppercase tracking-[0.24em] text-slate">Auction item ID</span>
                <input id="spool-item-id" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink" placeholder="LOT-2041" />
              </label>
              <label class="grid gap-2">
                <span class="text-xs uppercase tracking-[0.24em] text-slate">From</span>
                <input id="spool-from" type="datetime-local" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink" />
              </label>
              <label class="grid gap-2 md:col-span-2">
                <span class="text-xs uppercase tracking-[0.24em] text-slate">To</span>
                <input id="spool-to" type="datetime-local" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3">
              <button id="spool-item-sheet" class="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Spool item sheet</button>
              <button id="spool-audit-bundle" class="rounded-[0.9rem] bg-[#1d326c] px-5 py-3 text-sm font-semibold text-white">Spool audit bundle</button>
            </div>
            <p id="spool-feedback" class="mt-4 text-sm text-slate">Use these controls to spool by auction ID or date range.</p>
          </div>
        </div>
      </section>

      <div class="mt-10 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section class="rounded-3xl border border-ink/10 bg-white p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Audit search</p>
              <h2 class="mt-2 text-2xl font-semibold text-ink">Activity trail</h2>
            </div>
            <button id="apply-audit-filters" class="rounded-[0.9rem] bg-[#1d326c] px-5 py-3 text-sm font-semibold text-white">Apply filters</button>
          </div>
          <div class="mt-5 grid gap-3 md:grid-cols-2">
            <input id="audit-item-id" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" placeholder="Item ID" />
            <input id="audit-actor" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" placeholder="Actor name" />
            <input id="audit-event-type" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" placeholder="Event type" />
            <input id="audit-entity-type" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" placeholder="Entity type" />
            <input id="audit-from" type="datetime-local" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" />
            <input id="audit-to" type="datetime-local" class="rounded-2xl border border-ink/10 px-4 py-3 text-sm" />
          </div>
          <p id="audit-feedback" class="mt-4 text-sm text-slate">Search by actor, event type, entity type, item, or date range.</p>
          <div id="audit-results" class="mt-4 space-y-3"></div>
          <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
            <p id="audit-page-summary" class="text-xs text-slate">Showing 0-0 of 0</p>
            <div id="audit-pager" class="flex flex-wrap items-center gap-2"></div>
          </div>
        </section>

        <section class="rounded-3xl border border-ink/10 bg-white p-6">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Notification spool</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Queued messages</h2>
          </div>
          <div id="notification-results" class="mt-4 space-y-3"></div>
          <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
            <p id="notification-page-summary" class="text-xs text-slate">Showing 0-0 of 0</p>
            <div id="notification-pager" class="flex flex-wrap items-center gap-2"></div>
          </div>
        </section>
      </div>

      <section class="mt-10 rounded-3xl border border-ink/10 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">User security</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Accounts, resets, and access</h2>
            <p class="mt-2 text-sm text-slate">Issue password resets, disable or re-enable users, and review role assignments from one panel.</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button data-bulk-reset="all" class="rounded-[0.9rem] bg-[#1d326c] px-5 py-3 text-sm font-semibold text-white">Reset all users</button>
            <button data-bulk-reset="role" data-bulk-role="Bidder" class="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Reset all bidders</button>
            <button data-bulk-reset="role" data-bulk-role="Admin" class="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Reset all admins</button>
          </div>
        </div>
        <p id="reset-feedback" class="mt-4 rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">Use these controls to issue password reset emails, disable users, and manage roles.</p>
        <div class="mt-6 grid gap-3">
          ${users.length ? users.map((user) => `
            <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-[260px] flex-1">
                  <p class="text-sm font-semibold text-ink">${user.displayName}</p>
                  <p class="mt-1 text-xs text-slate">${user.email}</p>
                  <p class="mt-2 text-xs text-slate">Roles: ${user.roles.length ? user.roles.join(", ") : "None"} · Status: ${user.status}</p>
                  <p class="mt-1 text-xs text-slate">Last login: ${user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}</p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    ${user.roles.map((role) => `
                      <span class="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink">
                        ${role}
                        ${isSuperAdmin && !((user.roles.length === 1) && role) ? `<button data-remove-role="${user.id}" data-role-name="${role}" class="text-rose-700">×</button>` : ""}
                      </span>
                    `).join("")}
                  </div>
                  ${isSuperAdmin ? `
                    <div class="mt-3 flex flex-wrap gap-2">
                      <select data-role-select="${user.id}" class="rounded-[0.9rem] border border-ink/10 bg-white px-4 py-2 text-xs text-ink">
                        <option value="">Assign role</option>
                        ${roles.map((role) => `<option value="${role}">${role}</option>`).join("")}
                      </select>
                      <button data-assign-role="${user.id}" class="rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Assign</button>
                    </div>
                  ` : ""}
                </div>
                <div class="flex min-w-[260px] flex-col gap-2">
                  <button data-user-reset="${user.id}" class="rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Send reset</button>
                  ${user.status === "disabled"
                    ? `<button data-user-enable="${user.id}" class="rounded-[0.9rem] border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-800">Enable user</button>`
                    : `
                        <input data-disable-reason="${user.id}" class="rounded-[0.9rem] border border-ink/10 px-4 py-2 text-xs" placeholder="Disable reason (audit note)" />
                        <button data-user-disable="${user.id}" class="rounded-[0.9rem] border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700">Disable user</button>
                      `}
                </div>
              </div>
            </div>
          `).join("") : `<p class="text-sm text-slate">No users available.</p>`}
        </div>
      </section>

      ${isSuperAdmin ? `
        <section class="mt-10 grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div class="rounded-3xl border border-ink/10 bg-white p-6">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Bulk user import</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Upload user CSV</h2>
            <p class="mt-2 text-sm text-slate">Import users with email, display name, optional roles, and optional status.</p>
            <div class="mt-5 flex flex-wrap items-center gap-3">
              <label class="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">
                <input id="bulk-user-csv" type="file" accept=".csv,text/csv" class="hidden" />
                Choose CSV
              </label>
              <span id="bulk-user-csv-name" class="text-sm text-slate">No file selected</span>
            </div>
            <div class="mt-5 flex flex-wrap gap-3">
              <button id="bulk-user-import" class="rounded-[0.9rem] bg-[#1d326c] px-5 py-3 text-sm font-semibold text-white">Import users</button>
              <button id="download-user-template" class="rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Download template</button>
            </div>
            <p id="bulk-user-feedback" class="mt-4 text-sm text-slate">Template columns: email, display_name, roles, status.</p>
          </div>
          <div class="rounded-3xl border border-ink/10 bg-white p-6">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Auction outcomes</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Reserve visibility snapshot</h2>
            <div class="mt-5 grid gap-3">
              ${items.slice(0, 6).map((item) => `
                <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <p class="text-sm font-semibold text-ink">${item.title}</p>
                      <p class="mt-1 text-xs text-slate">Lot ${item.lot} · ${item.category}</p>
                    </div>
                    <span class="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink">${reserveState(item)}</span>
                  </div>
                  <p class="mt-2 text-xs text-slate">Current bid ${item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"} · Reserve ${item.reserve > 0 ? formatMoney(item.reserve) : "No reserve"}</p>
                </div>
              `).join("")}
            </div>
          </div>
        </section>
      ` : ""}
    </section>
  `);
  renderAuditTiles();
  renderNotificationTiles();
};

const downloadExport = async (path: string, filename: string) => {
  const response = await apiFetch(path, { headers: getAuditHeaders() });
  if (!response.ok) throw new Error("Export failed.");
  downloadBlob(await response.blob(), filename);
};

const wireActions = async (sessionRole: string, items: AuctionItem[], wins: WonAuction[], users: AdminUser[]) => {
  document.querySelector<HTMLButtonElement>("#download-items-export")?.addEventListener("click", async () => {
    await downloadExport("/api/exports/items.csv", "items-export.csv");
  });
  document.querySelector<HTMLButtonElement>("#download-audits-export")?.addEventListener("click", async () => {
    await downloadExport("/api/exports/audits.csv", "audit-export.csv");
  });

  document.querySelector<HTMLButtonElement>("#spool-closed-auctions")?.addEventListener("click", () => {
    const closedItems = items.filter((item) => new Date(item.endTime).getTime() < Date.now() && !item.archivedAt);
    downloadJson({ generatedAt: new Date().toISOString(), kind: "closed-auctions", itemCount: closedItems.length, items: closedItems }, `closed-auctions-spool-${Date.now()}.json`);
  });
  document.querySelector<HTMLButtonElement>("#spool-winner-summary")?.addEventListener("click", () => {
    downloadJson({ generatedAt: new Date().toISOString(), kind: "winner-summary", count: wins.length, winners: wins }, `winner-summary-spool-${Date.now()}.json`);
  });
  document.querySelector<HTMLButtonElement>("#spool-notification-bundle")?.addEventListener("click", async () => {
    const notifications = await fetchJson<NotificationEntry[]>("/api/admin/notifications");
    downloadJson({ generatedAt: new Date().toISOString(), kind: "notification-spool", count: notifications.length, notifications }, `notification-spool-${Date.now()}.json`);
  });
  document.querySelector<HTMLButtonElement>("#process-notification-queue")?.addEventListener("click", async () => {
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    if (feedback) feedback.textContent = "Processing notification queue...";
    const response = await apiFetch("/api/admin/notifications/process", { method: "POST", headers: getAuditHeaders() });
    const payload = await response.json().catch(() => null) as { processed?: number; transport?: string; error?: string } | null;
    if (feedback) {
      feedback.textContent = response.ok
        ? `Processed ${payload?.processed || 0} queued notifications using ${payload?.transport || "configured"} transport.`
        : "Unable to process the notification queue right now. Please try again in a moment.";
    }
    if (!response.ok) console.error("Unable to process notification queue.", payload?.error || payload);
  });
  document.querySelector<HTMLButtonElement>("#spool-item-sheet")?.addEventListener("click", () => {
    const itemId = (document.querySelector<HTMLInputElement>("#spool-item-id")?.value || "").trim();
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    const item = items.find((entry) => entry.id === itemId);
    if (!item) {
      if (feedback) feedback.textContent = "Enter a valid item ID first.";
      return;
    }
    downloadJson({ generatedAt: new Date().toISOString(), kind: "item-sheet", item }, `item-sheet-${item.id}.json`);
    if (feedback) feedback.textContent = `Item sheet spooled for ${item.id}.`;
  });
  document.querySelector<HTMLButtonElement>("#spool-audit-bundle")?.addEventListener("click", async () => {
    const itemId = (document.querySelector<HTMLInputElement>("#spool-item-id")?.value || "").trim();
    const from = (document.querySelector<HTMLInputElement>("#spool-from")?.value || "").trim();
    const to = (document.querySelector<HTMLInputElement>("#spool-to")?.value || "").trim();
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    const params = new URLSearchParams();
    if (itemId) params.set("itemId", itemId);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const audits = await fetchJson<AuditEntry[]>(`/api/admin/audits?${params.toString()}`);
    downloadJson({ generatedAt: new Date().toISOString(), kind: "audit-bundle", filters: { itemId, from, to }, count: audits.length, audits }, `audit-bundle-${Date.now()}.json`);
    if (feedback) feedback.textContent = `Audit bundle spooled with ${audits.length} records.`;
  });

  document.querySelector<HTMLButtonElement>("#apply-audit-filters")?.addEventListener("click", async () => {
    const params = new URLSearchParams();
    const itemId = (document.querySelector<HTMLInputElement>("#audit-item-id")?.value || "").trim();
    const actor = (document.querySelector<HTMLInputElement>("#audit-actor")?.value || "").trim();
    const eventType = (document.querySelector<HTMLInputElement>("#audit-event-type")?.value || "").trim();
    const entityType = (document.querySelector<HTMLInputElement>("#audit-entity-type")?.value || "").trim();
    const from = (document.querySelector<HTMLInputElement>("#audit-from")?.value || "").trim();
    const to = (document.querySelector<HTMLInputElement>("#audit-to")?.value || "").trim();
    if (itemId) params.set("itemId", itemId);
    if (actor) params.set("actor", actor);
    if (eventType) params.set("eventType", eventType);
    if (entityType) params.set("entityType", entityType);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const feedback = document.querySelector<HTMLParagraphElement>("#audit-feedback");
    if (feedback) feedback.textContent = "Loading filtered audit results...";
    const audits = await fetchJson<AuditEntry[]>(`/api/admin/audits?${params.toString()}`);
    visibleAudits = sortByMostRecent(audits);
    auditPage = 1;
    renderAuditTiles();
    if (feedback) feedback.textContent = `Loaded ${audits.length} audit record(s).`;
  });

  document.querySelector<HTMLDivElement>("#audit-pager")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page-kind='audit']");
    if (!button) return;
    const page = Number(button.dataset.pageNumber || 1);
    if (!page || page === auditPage) return;
    auditPage = page;
    renderAuditTiles();
  });
  document.querySelector<HTMLDivElement>("#notification-pager")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page-kind='notification']");
    if (!button) return;
    const page = Number(button.dataset.pageNumber || 1);
    if (!page || page === notificationPage) return;
    notificationPage = page;
    renderNotificationTiles();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-user-reset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.dataset.userReset;
      const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
      if (!userId) return;
      button.disabled = true;
      const response = await apiFetch(`/api/admin/users/${userId}/password-reset`, { method: "POST", headers: getAuditHeaders() });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (feedback) {
        feedback.textContent = response.ok
          ? (payload?.message || "Reset email sent.")
          : "Unable to send the reset email right now. Please try again in a moment.";
      }
      if (!response.ok) console.error(`Unable to send admin reset email for user ${userId}.`, payload?.error || payload);
      button.disabled = false;
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-user-disable]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.dataset.userDisable;
      const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
      const reason = (document.querySelector<HTMLInputElement>(`[data-disable-reason="${userId}"]`)?.value || "").trim();
      if (!userId) return;
      button.disabled = true;
      const response = await apiFetch(`/api/admin/users/${userId}/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuditHeaders() },
        body: JSON.stringify({ reason })
      });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (feedback) {
        feedback.textContent = response.ok
          ? (payload?.message || "User disabled.")
          : "Unable to disable this user right now. Please try again in a moment.";
      }
      if (!response.ok) console.error(`Unable to disable user ${userId}.`, payload?.error || payload);
      button.disabled = false;
      if (response.ok) window.location.reload();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-user-enable]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.dataset.userEnable;
      const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
      if (!userId) return;
      button.disabled = true;
      const response = await apiFetch(`/api/admin/users/${userId}/enable`, { method: "POST", headers: getAuditHeaders() });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (feedback) {
        feedback.textContent = response.ok
          ? (payload?.message || "User enabled.")
          : "Unable to enable this user right now. Please try again in a moment.";
      }
      if (!response.ok) console.error("Unable to enable user.", payload?.error || payload);
      button.disabled = false;
      if (response.ok) window.location.reload();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-bulk-reset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
      const scope = button.dataset.bulkReset || "selected";
      const role = button.dataset.bulkRole || "";
      const response = await apiFetch("/api/admin/users/password-resets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuditHeaders() },
        body: JSON.stringify({ scope, role })
      });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (feedback) {
        feedback.textContent = response.ok
          ? (payload?.message || "Bulk reset queued.")
          : "Unable to queue the bulk reset right now. Please try again in a moment.";
      }
      if (!response.ok) console.error("Unable to queue bulk password reset.", payload?.error || payload);
    });
  });

  if (sessionRole === "SuperAdmin") {
    document.querySelectorAll<HTMLButtonElement>("[data-assign-role]").forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.assignRole || "";
        const select = document.querySelector<HTMLSelectElement>(`[data-role-select="${userId}"]`);
        const roleName = select?.value || "";
        const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
        if (!userId || !roleName) return;
        button.disabled = true;
        try {
          const payload = await assignUserRole(userId, roleName);
          if (feedback) feedback.textContent = payload.message || "Role assigned.";
          window.location.reload();
        } catch (error) {
          console.error(`Unable to assign role ${roleName} to user ${userId}.`, error);
          if (feedback) feedback.textContent = "Unable to assign that role right now. Please try again.";
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-remove-role]").forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.removeRole || "";
        const roleName = button.dataset.roleName || "";
        const feedback = document.querySelector<HTMLParagraphElement>("#reset-feedback");
        if (!userId || !roleName) return;
        button.disabled = true;
        try {
          const payload = await removeUserRole(userId, roleName);
          if (feedback) feedback.textContent = payload.message || "Role removed.";
          window.location.reload();
        } catch (error) {
          console.error(`Unable to remove role ${roleName} from user ${userId}.`, error);
          if (feedback) feedback.textContent = "Unable to remove that role right now. Please try again.";
        } finally {
          button.disabled = false;
        }
      });
    });

    const csvInput = document.querySelector<HTMLInputElement>("#bulk-user-csv");
    const csvName = document.querySelector<HTMLSpanElement>("#bulk-user-csv-name");
    const bulkFeedback = document.querySelector<HTMLParagraphElement>("#bulk-user-feedback");
    csvInput?.addEventListener("change", () => {
      if (csvName) csvName.textContent = csvInput.files?.[0]?.name || "No file selected";
    });
    document.querySelector<HTMLButtonElement>("#bulk-user-import")?.addEventListener("click", async () => {
      const file = csvInput?.files?.[0];
      if (!file) {
        if (bulkFeedback) bulkFeedback.textContent = "Choose a CSV first.";
        return;
      }
      if (bulkFeedback) bulkFeedback.textContent = "Importing users...";
      try {
        const report = await bulkImportUsers(file);
        if (bulkFeedback) bulkFeedback.textContent = `Created ${report.created}, skipped ${report.skipped}, failed ${report.failed}.`;
      } catch (error) {
        console.error("Unable to bulk import users.", error);
        if (bulkFeedback) {
          bulkFeedback.textContent =
            "Unable to import users right now. Please review the CSV template and try again.";
        }
      }
    });
    document.querySelector<HTMLButtonElement>("#download-user-template")?.addEventListener("click", () => {
      const csv = "email,display_name,roles,status\njane@example.com,Jane Doe,Bidder,pending_verification\nops@example.com,Ops Admin,\"Admin|Observer\",active";
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "user-import-template.csv");
    });
  }
};

const init = async () => {
  await fetchCurrentSession().catch(() => undefined);
  const session = readAuthSession();
  if (!session.signedIn || !["Admin", "SuperAdmin"].includes(session.role)) {
    renderError("Admin access is required to view the operations desk.");
    return;
  }

  try {
    const [operations, items, wins, users, roles] = await Promise.all([
      fetchJson<OperationsPayload>("/api/admin/operations"),
      fetchJson<AuctionItem[]>("/api/items?includeArchived=1"),
      fetchJson<WonAuction[]>("/api/me/wins"),
      fetchAdminUsers(),
      session.role === "SuperAdmin" ? fetchAdminRoles() : Promise.resolve<string[]>(["Admin", "Bidder", "Observer", "SuperAdmin"])
    ]);
    renderPage(session.role, operations, items, wins, users, roles, operations.recentAudits);
    await wireActions(session.role, items, wins, users);
  } catch (error) {
    console.error("Unable to load operations desk.", error);
    const message = error instanceof Error ? error.message : "";
    const hint = message.includes("404")
      ? "The operations endpoint is not available from the running backend yet. Restart `npm run dev:server` so the latest server routes are loaded."
      : "Unable to load the operations desk right now.";
    renderError(hint);
  }
};

void init();
