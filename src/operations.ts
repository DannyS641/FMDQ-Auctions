import "./styles.css";
import { getAuditHeaders, readAuthSession } from "./auth";

type OperationsPayload = {
  summary: {
    totalItems: number;
    liveCount: number;
    closedCount: number;
    archivedCount: number;
    pendingNotifications: number;
    auditCount: number;
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;

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

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#operations-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      <header class="border-b border-ink/10 bg-white">
        <nav class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
          <div class="flex items-center gap-3">
            <button id="download-items-export" class="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">Export items</button>
            <button id="download-audits-export" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Export audits</button>
            <a href="/admin-item.html" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Back</a>
          </div>
        </nav>
      </header>
      <main class="mx-auto w-full max-w-7xl px-6 py-10">${content}</main>
    </div>
  `;
  revealApp();
};

const downloadExport = async (path: string, filename: string) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuditHeaders("Admin")
  });
  if (!response.ok) throw new Error("Export failed.");
  const blob = await response.blob();
  downloadBlob(blob, filename);
};

const renderError = (message: string) => {
  renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">${message}</div>`);
};

const fetchJson = async <T>(path: string) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuditHeaders("Admin")
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || String(response.status));
  }
  return (await response.json()) as T;
};

const wireActions = (items: AuctionItem[], wins: WonAuction[]) => {
  document.querySelector<HTMLButtonElement>("#download-items-export")?.addEventListener("click", async () => {
    await downloadExport("/api/exports/items.csv", "items-export.csv");
  });
  document.querySelector<HTMLButtonElement>("#download-audits-export")?.addEventListener("click", async () => {
    await downloadExport("/api/exports/audits.csv", "audit-export.csv");
  });

  document.querySelector<HTMLButtonElement>("#spool-closed-auctions")?.addEventListener("click", async () => {
    const closedItems = items.filter((item) => new Date(item.endTime).getTime() < Date.now() && !item.archivedAt);
    downloadJson({
      generatedAt: new Date().toISOString(),
      kind: "closed-auctions",
      itemCount: closedItems.length,
      items: closedItems
    }, `closed-auctions-spool-${Date.now()}.json`);
  });

  document.querySelector<HTMLButtonElement>("#spool-winner-summary")?.addEventListener("click", async () => {
    downloadJson({
      generatedAt: new Date().toISOString(),
      kind: "winner-summary",
      count: wins.length,
      winners: wins
    }, `winner-summary-spool-${Date.now()}.json`);
  });

  document.querySelector<HTMLButtonElement>("#spool-item-sheet")?.addEventListener("click", async () => {
    const itemId = (document.querySelector<HTMLInputElement>("#spool-item-id")?.value || "").trim();
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    if (!itemId) {
      if (feedback) feedback.textContent = "Enter an auction item ID first.";
      return;
    }
    const item = items.find((entry) => entry.id === itemId);
    if (!item) {
      if (feedback) feedback.textContent = "That auction item was not found.";
      return;
    }
    downloadJson({
      generatedAt: new Date().toISOString(),
      kind: "item-sheet",
      item
    }, `item-sheet-${itemId}.json`);
    if (feedback) feedback.textContent = `Item sheet spooled for ${itemId}.`;
  });

  document.querySelector<HTMLButtonElement>("#spool-audit-bundle")?.addEventListener("click", async () => {
    const from = (document.querySelector<HTMLInputElement>("#spool-from")?.value || "").trim();
    const to = (document.querySelector<HTMLInputElement>("#spool-to")?.value || "").trim();
    const itemId = (document.querySelector<HTMLInputElement>("#spool-item-id")?.value || "").trim();
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    const query = new URLSearchParams();
    if (from) query.set("from", new Date(from).toISOString());
    if (to) query.set("to", new Date(to).toISOString());
    if (itemId) query.set("itemId", itemId);
    const audits = await fetchJson<AuditEntry[]>(`/api/admin/audits?${query.toString()}`);
    downloadJson({
      generatedAt: new Date().toISOString(),
      kind: "audit-bundle",
      filters: { from, to, itemId },
      count: audits.length,
      audits
    }, `audit-bundle-${Date.now()}.json`);
    if (feedback) feedback.textContent = `Audit bundle spooled with ${audits.length} records.`;
  });

  document.querySelector<HTMLButtonElement>("#spool-notification-bundle")?.addEventListener("click", async () => {
    const notifications = await fetchJson<NotificationEntry[]>("/api/admin/notifications");
    downloadJson({
      generatedAt: new Date().toISOString(),
      kind: "notification-spool",
      count: notifications.length,
      notifications
    }, `notification-spool-${Date.now()}.json`);
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    if (feedback) feedback.textContent = `Notification spool exported with ${notifications.length} entries.`;
  });

  document.querySelector<HTMLButtonElement>("#process-notification-queue")?.addEventListener("click", async () => {
    const feedback = document.querySelector<HTMLParagraphElement>("#spool-feedback");
    if (feedback) feedback.textContent = "Processing notification queue...";
    const response = await fetch(`${API_BASE_URL}/api/admin/notifications/process`, {
      method: "POST",
      headers: getAuditHeaders("Admin")
    });
    if (!response.ok) {
      if (feedback) feedback.textContent = "Unable to process the notification queue.";
      return;
    }
    const payload = (await response.json()) as { processed: number; transport: string };
    if (feedback) feedback.textContent = `Processed ${payload.processed} queued notifications using ${payload.transport} transport. Refresh the page to see updated statuses.`;
  });
};

const init = async () => {
  const session = readAuthSession();
  if (!session.signedIn || session.role !== "Admin") {
    renderError("Admin access is required to view the operations desk.");
    return;
  }

  try {
    const [operations, items, wins] = await Promise.all([
      fetchJson<OperationsPayload>("/api/admin/operations"),
      fetchJson<AuctionItem[]>("/api/items?includeArchived=1"),
      fetch(`${API_BASE_URL}/api/me/wins`, { headers: getAuditHeaders("Admin") })
        .then(async (response) => (response.ok ? ((await response.json()) as WonAuction[]) : []))
    ]);

    renderShell(`
      <section>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Operations desk</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink">Exports and spool</h1>
        <p class="mt-3 text-sm text-slate">Review operational activity, inspect the queue, and spool auction packages by type, item, or date range.</p>

        <div class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Total items</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.totalItems}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Live / Closed</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.liveCount} / ${operations.summary.closedCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Archived</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.archivedCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Pending notifications</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.pendingNotifications}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Audit events</p><p class="mt-2 text-3xl font-semibold text-ink">${operations.summary.auditCount}</p></div>
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
              <button id="spool-closed-auctions" class="rounded-3xl border border-ink/10 bg-ink px-5 py-4 text-left text-white">
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
                <button id="spool-item-sheet" class="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Spool item sheet</button>
                <button id="spool-audit-bundle" class="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">Spool audit bundle</button>
              </div>
              <p id="spool-feedback" class="mt-4 text-sm text-slate">Use these controls to spool by auction ID or date range.</p>
            </div>
          </div>
        </section>

        <div class="mt-10 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section class="rounded-3xl border border-ink/10 bg-white p-6">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Recent audits</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Activity trail</h2>
            <div class="mt-6 space-y-3">
              ${operations.recentAudits.length
                ? operations.recentAudits.map((audit) => `
                    <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                      <div class="flex items-center justify-between gap-4">
                        <p class="text-sm font-semibold text-ink">${audit.eventType}</p>
                        <p class="text-xs text-slate">${formatDate(audit.createdAt)}</p>
                      </div>
                      <p class="mt-2 text-xs text-slate">${audit.entityType} · ${audit.entityId}</p>
                      <p class="mt-1 text-sm text-ink">Actor: ${audit.actor}</p>
                    </div>
                  `).join("")
                : `<p class="text-sm text-slate">No audit records available.</p>`}
            </div>
          </section>

          <section class="rounded-3xl border border-ink/10 bg-white p-6">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Notification spool</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">Queued messages</h2>
            <div class="mt-6 space-y-3">
              ${operations.notificationQueue.length
                ? operations.notificationQueue.map((entry) => `
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
                      ${entry.processedAt ? `<p class="mt-1 text-xs text-slate">Processed: ${formatDate(entry.processedAt)}</p>` : ""}
                      ${entry.errorMessage ? `<p class="mt-1 text-xs text-rose-700">${entry.errorMessage}</p>` : ""}
                    </div>
                  `).join("")
                : `<p class="text-sm text-slate">Notification queue is empty.</p>`}
            </div>
          </section>
        </div>
      </section>
    `);
    wireActions(items, wins);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const hint = message.includes("404")
      ? "The operations endpoint is not available from the running backend yet. Restart `npm run dev:server` so the latest server routes are loaded."
      : "Unable to load the operations desk right now.";
    renderError(hint);
  }
};

void init();
