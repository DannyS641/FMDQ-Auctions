import "./styles.css";
import { getAuditHeaders, readAuthSession } from "./auth";

type FileRef = {
  name: string;
  url: string;
};

type AuctionItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  startBid: number;
  reserve: number;
  increment: number;
  currentBid: number;
  startTime: string;
  endTime: string;
  description: string;
  images: FileRef[];
  documents: FileRef[];
  archivedAt?: string | null;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";
const defaultCategories = ["Cars", "Furniture", "Household Appliances", "Kitchen Appliances", "Phones", "Other"];
const conditions = ["New", "Used", "Fair", "Damaged"];
const itemsPerPage = 10;

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const defaultTimes = () => {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return {
    startTime: start.toISOString().slice(0, 16),
    endTime: end.toISOString().slice(0, 16)
  };
};

const createEmptyDraft = (categories: string[]) => {
  const { startTime, endTime } = defaultTimes();
  return {
    title: "",
    category: categories[0] || "Other",
    lot: "",
    sku: "",
    condition: conditions[0],
    location: "",
    startBid: 0,
    reserve: 0,
    increment: 500,
    currentBid: 0,
    startTime,
    endTime,
    description: "",
    images: [],
    documents: []
  } satisfies Omit<AuctionItem, "id">;
};

const state: {
  items: AuctionItem[];
  categories: string[];
  mode: "create" | "edit";
  selectedItemId: string | null;
  listPage: number;
  listFilter: "all" | "active" | "archived";
  confirmation:
    | {
        kind: "item" | "category";
        id: string;
        label: string;
      }
    | null;
  actionStatus:
    | {
        tone: "success" | "error";
        icon: "✓" | "❌";
        message: string;
      }
    | null;
} = {
  items: [],
  categories: [...defaultCategories],
  mode: "create",
  selectedItemId: null,
  listPage: 1,
  listFilter: "all",
  confirmation: null,
  actionStatus: null
};

const getSelectedItemIdFromQuery = () => new URLSearchParams(window.location.search).get("id");

const formatDateTimeLocal = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const resolveMediaUrl = (url: string) => (url.startsWith("http") ? url : `${API_BASE_URL}${url}`);

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#admin-item-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      <header class="border-b border-ink/10 bg-white">
        <nav class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div class="flex items-center gap-3">
            <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
          </div>
          <div class="flex items-center gap-3">
            <a href="/bidding.html" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Back</a>
          </div>
        </nav>
      </header>
      <main class="mx-auto w-full max-w-7xl px-6 py-10">${content}</main>
    </div>
  `;
};

const renderAccessDenied = () => {
  renderShell(`
    <div class="rounded-3xl border border-ink/10 bg-white p-8">
      <h1 class="text-2xl font-semibold text-ink">Admin access required</h1>
      <p class="mt-3 text-sm text-slate">Only admins can manage auction items from this page.</p>
    </div>
  `);
  revealApp();
};

const renderMessage = (title: string, message: string) => {
  renderShell(`
    <div class="rounded-3xl border border-ink/10 bg-white p-8">
      <h1 class="text-2xl font-semibold text-ink">${title}</h1>
      <p class="mt-3 text-sm text-slate">${message}</p>
    </div>
  `);
  revealApp();
};

const updateQueryState = () => {
  const url = new URL(window.location.href);
  if (state.selectedItemId) {
    url.searchParams.set("id", state.selectedItemId);
  } else {
    url.searchParams.delete("id");
  }
  window.history.replaceState({}, "", url);
};

const getSelectedItem = () => state.items.find((item) => item.id === state.selectedItemId) || null;
const getCategoryOptions = () => (state.categories.length ? state.categories : [...defaultCategories]);
const getFilteredItems = () => {
  if (state.listFilter === "archived") return state.items.filter((item) => item.archivedAt);
  if (state.listFilter === "active") return state.items.filter((item) => !item.archivedAt);
  return state.items;
};
const getTotalPages = () => Math.max(1, Math.ceil(getFilteredItems().length / itemsPerPage));
const getVisibleItems = () => {
  const startIndex = (state.listPage - 1) * itemsPerPage;
  return getFilteredItems().slice(startIndex, startIndex + itemsPerPage);
};

let actionStatusTimer: number | null = null;

const showActionStatus = (tone: "success" | "error", icon: "✓" | "❌", message: string) => {
  state.actionStatus = { tone, icon, message };
  if (actionStatusTimer) window.clearTimeout(actionStatusTimer);
  renderManager();
  bindManagerEvents();
  actionStatusTimer = window.setTimeout(() => {
    state.actionStatus = null;
    renderManager();
    bindManagerEvents();
  }, 1800);
};

const openDeleteModal = (kind: "item" | "category", id: string, label: string) => {
  state.confirmation = { kind, id, label };
  renderManager();
  bindManagerEvents();
};

const closeDeleteModal = (showCancelState = false) => {
  state.confirmation = null;
  renderManager();
  bindManagerEvents();
  if (showCancelState) {
    showActionStatus("error", "❌", "Action cancelled.");
  }
};

const renderManager = () => {
  const selectedItem = getSelectedItem();
  const categoryOptions = getCategoryOptions();
  const draft = selectedItem || createEmptyDraft(categoryOptions);
  const filteredItems = getFilteredItems();
  const activeItemsCount = state.items.filter((item) => !item.archivedAt).length;
  const archivedItemsCount = state.items.filter((item) => item.archivedAt).length;
  const totalPages = getTotalPages();
  const visibleItems = getVisibleItems();
  const startItemNumber = filteredItems.length ? (state.listPage - 1) * itemsPerPage + 1 : 0;
  const endItemNumber = filteredItems.length ? startItemNumber + visibleItems.length - 1 : 0;
  const formHeading = state.mode === "edit" && selectedItem ? `Edit ${selectedItem.title}` : "Add new item";
  const formSummary = state.mode === "edit"
    ? selectedItem?.archivedAt
      ? "Restore this archived listing or review the saved item details."
      : "Update the selected listing, append supporting files, or archive it from the portal."
    : "Create a new listing and publish it straight into the portal.";
  const confirmationTitle = state.confirmation?.kind === "category" ? "Delete category" : "Archive item";
  const confirmationMessage = state.confirmation?.kind === "category"
    ? `Delete "${state.confirmation.label}" from the category list?`
    : `Archive "${state.confirmation?.label}" from the portal? You can restore it later.`;

  renderShell(`
    <section class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div class="rounded-3xl border border-ink/10 bg-white p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Admin workflow</p>
            <h1 class="mt-2 text-3xl font-semibold text-ink">Item manager</h1>
            <p class="mt-2 text-sm text-slate">Create items, review current listings, edit records, and remove listings from one page.</p>
          </div>
          <div class="flex items-center gap-3">
            <button id="create-item-btn" type="button" class="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">Add new item</button>
            <button id="refresh-items-btn" type="button" class="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Refresh list</button>
          </div>
        </div>

        <div class="mt-8 rounded-3xl border border-ink/10 bg-ink/5 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate">${state.mode === "edit" ? "Edit mode" : "Create mode"}</p>
              <h2 class="mt-2 text-2xl font-semibold text-ink">${formHeading}</h2>
              <p class="mt-2 text-sm text-slate">${formSummary}</p>
            </div>
            ${selectedItem ? `<a href="/item.html?id=${selectedItem.id}" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">View item</a>` : ""}
          </div>

          <form id="admin-item-form" class="mt-6 grid gap-4 md:grid-cols-2">
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Item title <span class="text-rose-600">*</span></span>
              <input id="admin-title" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.title}" placeholder="Item title" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">SKU / Asset code <span class="text-rose-600">*</span></span>
              <input id="admin-sku" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.sku}" placeholder="SKU / Asset code" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Lot number <span class="text-rose-600">*</span></span>
              <input id="admin-lot" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.lot}" placeholder="Lot number" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Category <span class="text-rose-600">*</span></span>
              <select id="admin-category" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm">
                ${categoryOptions.map((category) => `<option value="${category}" ${category === draft.category ? "selected" : ""}>${category}</option>`).join("")}
              </select>
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Condition <span class="text-rose-600">*</span></span>
              <select id="admin-condition" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm">
                ${conditions.map((condition) => `<option value="${condition}" ${condition === draft.condition ? "selected" : ""}>${condition}</option>`).join("")}
              </select>
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Location <span class="text-rose-600">*</span></span>
              <input id="admin-location" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.location}" placeholder="Location" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Start time <span class="text-rose-600">*</span></span>
              <input id="admin-start" type="datetime-local" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${formatDateTimeLocal(draft.startTime)}" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">End time <span class="text-rose-600">*</span></span>
              <input id="admin-end" type="datetime-local" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${formatDateTimeLocal(draft.endTime)}" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Start bid <span class="text-rose-600">*</span></span>
              <input id="admin-starting" type="number" min="0" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.startBid}" placeholder="Starting bid (NGN)" required />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Reserve price</span>
              <input id="admin-reserve" type="number" min="0" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.reserve > 0 ? draft.reserve : ""}" placeholder="Optional: leave blank for no reserve" />
            </label>
            <label class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Bid increment <span class="text-rose-600">*</span></span>
              <input id="admin-increment" type="number" min="1" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" value="${draft.increment}" placeholder="Bid increment (NGN)" required />
            </label>
            <div class="grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Current bid</span>
              <div class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-slate">
                <span class="font-semibold text-ink">${formatMoney(draft.currentBid)}</span>
              </div>
            </div>
            <label class="md:col-span-2 grid gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Item description</span>
              <textarea id="admin-description" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" rows="4" placeholder="Item description">${draft.description}</textarea>
            </label>
            <div class="md:col-span-2 rounded-2xl border border-ink/10 bg-white p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Categories</p>
                  <p class="mt-1 text-sm text-slate">Add a new category here and it becomes available immediately in this form and on the bidding page.</p>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap items-center gap-3">
                <input id="new-category-name" class="min-w-[220px] flex-1 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="New category name" />
                <button id="add-category-btn" type="button" class="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Add category</button>
              </div>
              <p id="category-feedback" class="mt-3 text-sm text-slate"></p>
              <div class="mt-4 flex flex-wrap gap-2">
                ${categoryOptions.map((category) => {
                  const inUse = state.items.some((item) => item.category === category);
                  return `
                    <div class="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink">
                      <span class="font-semibold">${category}</span>
                      ${inUse ? `<span class="text-slate">In use</span>` : `<button data-delete-category="${category}" type="button" class="font-semibold text-rose-700">Delete</button>`}
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
            <div class="md:col-span-2 grid gap-4 lg:grid-cols-2">
              <div class="rounded-2xl border border-ink/10 bg-white p-4">
                <p class="text-xs uppercase tracking-[0.3em] text-slate">Existing images</p>
                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  ${selectedItem?.images.length
                    ? selectedItem.images.map((image) => `
                        <div class="overflow-hidden rounded-2xl border border-ink/10 bg-ink/5 p-2">
                          <div class="flex h-28 items-center justify-center overflow-hidden rounded-2xl bg-white p-2">
                            <img src="${resolveMediaUrl(image.url)}" alt="${image.name}" class="h-full w-full object-contain" />
                          </div>
                          <p class="mt-2 truncate text-xs text-slate">${image.name}</p>
                        </div>
                      `).join("")
                    : `<p class="text-sm text-slate">No images uploaded.</p>`}
                </div>
              </div>
              <div class="rounded-2xl border border-ink/10 bg-white p-4">
                <p class="text-xs uppercase tracking-[0.3em] text-slate">Existing documents</p>
                <div class="mt-3 space-y-2 text-sm text-slate">
                  ${selectedItem?.documents.length
                    ? selectedItem.documents.map((document) => `<p>${document.name}</p>`).join("")
                    : `<p>No documents uploaded.</p>`}
                </div>
              </div>
            </div>
            <input id="admin-images" type="file" multiple accept="image/*" class="md:col-span-2 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" />
            <input id="admin-documents" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx" class="md:col-span-2 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" />
            <div class="md:col-span-2 flex flex-wrap items-center gap-3">
              <button type="submit" class="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white">${state.mode === "edit" ? "Save changes" : "Create item"}</button>
              ${selectedItem?.archivedAt
                ? `<button id="restore-current-item-btn" type="button" class="rounded-full border border-emerald-200 px-6 py-3 text-sm font-semibold text-emerald-700">Restore item</button>`
                : selectedItem
                  ? `<button id="delete-current-item-btn" type="button" class="rounded-full border border-rose-200 px-6 py-3 text-sm font-semibold text-rose-700">Archive item</button>`
                  : ""}
            </div>
            <p id="admin-feedback" class="md:col-span-2 text-sm text-slate"></p>
          </form>
        </div>
      </div>

      <aside class="rounded-3xl border border-ink/10 bg-white p-8">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Current items</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink">${filteredItems.length} listings</h2>
            <p class="mt-2 text-sm text-slate">Showing ${startItemNumber}-${endItemNumber} of ${filteredItems.length}</p>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <button data-list-filter="all" type="button" class="rounded-full px-4 py-2 text-xs font-semibold ${state.listFilter === "all" ? "bg-ink text-white" : "border border-ink/15 text-ink"}">All (${state.items.length})</button>
          <button data-list-filter="active" type="button" class="rounded-full px-4 py-2 text-xs font-semibold ${state.listFilter === "active" ? "bg-ink text-white" : "border border-ink/15 text-ink"}">Active (${activeItemsCount})</button>
          <button data-list-filter="archived" type="button" class="rounded-full px-4 py-2 text-xs font-semibold ${state.listFilter === "archived" ? "bg-ink text-white" : "border border-ink/15 text-ink"}">Archived (${archivedItemsCount})</button>
        </div>

        <div class="mt-6 space-y-4">
          ${visibleItems.length
            ? visibleItems.map((item) => `
                <article class="rounded-3xl border ${item.id === state.selectedItemId ? "border-ink bg-ink/5" : "border-ink/10 bg-white"} p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-xs uppercase tracking-[0.3em] text-slate">${item.category}</p>
                      <h3 class="mt-2 text-lg font-semibold text-ink">${item.title}</h3>
                      <p class="mt-1 text-xs text-slate">Lot ${item.lot} · ${item.location}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                      ${item.archivedAt ? `<span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Archived</span>` : ""}
                      <span class="rounded-full border border-ink/10 px-3 py-1 text-xs font-semibold text-ink">${formatMoney(item.currentBid)}</span>
                    </div>
                  </div>
                  <div class="mt-4 flex flex-wrap items-center gap-2">
                    <button data-edit-item="${item.id}" type="button" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Edit</button>
                    ${item.archivedAt
                      ? `<button data-restore-item="${item.id}" type="button" class="rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700">Restore</button>`
                      : `<button data-delete-item="${item.id}" type="button" class="rounded-full border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700">Archive</button>`}
                    <a href="/item.html?id=${item.id}" class="rounded-full border border-ink/10 px-4 py-2 text-xs font-semibold text-ink">View</a>
                  </div>
                </article>
              `).join("")
            : `<p class="rounded-2xl border border-ink/10 bg-ink/5 px-4 py-6 text-sm text-slate">No ${state.listFilter === "all" ? "" : `${state.listFilter} `}auction items are available right now.</p>`}
        </div>

        ${filteredItems.length > itemsPerPage ? `
          <div class="mt-6 flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
            <button id="items-prev-page" type="button" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink ${state.listPage === 1 ? "opacity-50" : ""}" ${state.listPage === 1 ? "disabled" : ""}>Previous</button>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Page ${state.listPage} of ${totalPages}</p>
            <button id="items-next-page" type="button" class="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink ${state.listPage === totalPages ? "opacity-50" : ""}" ${state.listPage === totalPages ? "disabled" : ""}>Next</button>
          </div>
        ` : ""}
      </aside>
    </section>

    ${state.confirmation ? `
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-ink/45 px-4 backdrop-blur-[2px]">
        <div class="w-full max-w-md rounded-[2rem] border border-white/60 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate">Confirmation</p>
          <h3 class="mt-3 text-2xl font-semibold text-ink">${confirmationTitle}</h3>
          <p class="mt-3 text-sm text-slate">${confirmationMessage}</p>
          <div class="mt-6 flex items-center justify-end gap-3">
            <button id="modal-cancel-btn" type="button" class="rounded-full border border-ink/15 px-5 py-3 text-sm font-semibold text-ink">Cancel</button>
            <button id="modal-confirm-btn" type="button" class="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">${state.confirmation?.kind === "category" ? "Delete" : "Archive"}</button>
          </div>
        </div>
      </div>
    ` : ""}

    ${state.actionStatus ? `
      <div class="fixed bottom-6 right-6 z-50">
        <div class="flex items-center gap-4 rounded-[1.75rem] border ${
          state.actionStatus.tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
        } px-5 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.12)]">
          <div class="flex h-12 w-12 items-center justify-center rounded-full ${
            state.actionStatus.tone === "success" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
          } text-2xl font-bold animate-bounce">
            ${state.actionStatus.icon}
          </div>
          <p class="text-sm font-semibold ${state.actionStatus.tone === "success" ? "text-emerald-900" : "text-rose-900"}">
            ${state.actionStatus.message}
          </p>
        </div>
      </div>
    ` : ""}
  `);
  revealApp();
};

const bindManagerEvents = () => {
  const createButton = document.querySelector<HTMLButtonElement>("#create-item-btn");
  const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-items-btn");
  const form = document.querySelector<HTMLFormElement>("#admin-item-form");
  const feedback = document.querySelector<HTMLParagraphElement>("#admin-feedback");
  const categoryFeedback = document.querySelector<HTMLParagraphElement>("#category-feedback");
  const deleteCurrentButton = document.querySelector<HTMLButtonElement>("#delete-current-item-btn");
  const restoreCurrentButton = document.querySelector<HTMLButtonElement>("#restore-current-item-btn");
  const previousPageButton = document.querySelector<HTMLButtonElement>("#items-prev-page");
  const nextPageButton = document.querySelector<HTMLButtonElement>("#items-next-page");
  const modalCancelButton = document.querySelector<HTMLButtonElement>("#modal-cancel-btn");
  const modalConfirmButton = document.querySelector<HTMLButtonElement>("#modal-confirm-btn");

  createButton?.addEventListener("click", () => {
    state.mode = "create";
    state.selectedItemId = null;
    updateQueryState();
    renderManager();
    bindManagerEvents();
  });

  refreshButton?.addEventListener("click", () => {
    window.location.href = "/admin-item.html";
  });

  previousPageButton?.addEventListener("click", () => {
    state.listPage = Math.max(1, state.listPage - 1);
    renderManager();
    bindManagerEvents();
  });

  nextPageButton?.addEventListener("click", () => {
    state.listPage = Math.min(getTotalPages(), state.listPage + 1);
    renderManager();
    bindManagerEvents();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-edit-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.editItem;
      if (!itemId) return;
      state.mode = "edit";
      state.selectedItemId = itemId;
      updateQueryState();
      renderManager();
      bindManagerEvents();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-list-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.listFilter as "all" | "active" | "archived" | undefined;
      if (!filter) return;
      state.listFilter = filter;
      state.listPage = 1;
      renderManager();
      bindManagerEvents();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.deleteItem;
      const item = state.items.find((entry) => entry.id === itemId);
      if (!itemId || !item) return;
      openDeleteModal("item", itemId, item.title);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-restore-item]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.dataset.restoreItem;
      if (!itemId) return;
      await restoreItem(itemId);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.deleteCategory;
      if (!category) return;
      openDeleteModal("category", category, category);
    });
  });

  document.querySelector<HTMLButtonElement>("#add-category-btn")?.addEventListener("click", async () => {
    const input = document.querySelector<HTMLInputElement>("#new-category-name");
    const name = input?.value.trim() || "";
    if (!categoryFeedback) return;
    if (!name) {
      categoryFeedback.textContent = "Enter a category name first.";
      return;
    }
    categoryFeedback.textContent = "Adding category...";
    try {
      const response = await fetch(`${API_BASE_URL}/api/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuditHeaders("Admin")
        },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; created?: boolean } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to add category.");
      }
      if (input) input.value = "";
      await refreshData(payload?.created ? `Category "${name}" added.` : `Category "${name}" is already available.`);
    } catch (error) {
      categoryFeedback.textContent = error instanceof Error ? error.message : "Unable to add category.";
    }
  });

  deleteCurrentButton?.addEventListener("click", async () => {
    const item = getSelectedItem();
    if (!item) return;
    openDeleteModal("item", item.id, item.title);
  });

  restoreCurrentButton?.addEventListener("click", async () => {
    const item = getSelectedItem();
    if (!item) return;
    await restoreItem(item.id);
  });

  modalCancelButton?.addEventListener("click", () => {
    closeDeleteModal(true);
  });

  modalConfirmButton?.addEventListener("click", async () => {
    const confirmation = state.confirmation;
    if (!confirmation) return;
    state.confirmation = null;
    renderManager();
    bindManagerEvents();
    if (confirmation.kind === "item") {
      await deleteItem(confirmation.id);
      return;
    }
    await deleteCategory(confirmation.id);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!feedback) return;

    const title = (document.querySelector<HTMLInputElement>("#admin-title")?.value || "").trim();
    const sku = (document.querySelector<HTMLInputElement>("#admin-sku")?.value || "").trim();
    const lot = (document.querySelector<HTMLInputElement>("#admin-lot")?.value || "").trim();
    const location = (document.querySelector<HTMLInputElement>("#admin-location")?.value || "").trim();
    const category = document.querySelector<HTMLSelectElement>("#admin-category")?.value || getCategoryOptions()[0] || "Other";
    const condition = document.querySelector<HTMLSelectElement>("#admin-condition")?.value || conditions[0];
    const startTime = document.querySelector<HTMLInputElement>("#admin-start")?.value || "";
    const endTime = document.querySelector<HTMLInputElement>("#admin-end")?.value || "";
    const startBid = Number(document.querySelector<HTMLInputElement>("#admin-starting")?.value || 0);
    const reserveValue = (document.querySelector<HTMLInputElement>("#admin-reserve")?.value || "").trim();
    const reserve = reserveValue ? Number(reserveValue) : 0;
    const increment = Number(document.querySelector<HTMLInputElement>("#admin-increment")?.value || 0);
    const description = (document.querySelector<HTMLTextAreaElement>("#admin-description")?.value || "").trim();
    const imagesInput = document.querySelector<HTMLInputElement>("#admin-images");
    const documentsInput = document.querySelector<HTMLInputElement>("#admin-documents");

    if (!title || !sku || !lot || !location || !startTime || !endTime || !startBid || !increment) {
      feedback.textContent = "Please complete all required fields.";
      return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("category", category);
    formData.append("lot", lot);
    formData.append("sku", sku);
    formData.append("condition", condition);
    formData.append("location", location);
    formData.append("startBid", String(startBid));
    formData.append("reserve", reserveValue);
    formData.append("increment", String(increment));
    formData.append("startTime", startTime);
    formData.append("endTime", endTime);
    formData.append("description", description);

    if (imagesInput?.files) {
      Array.from(imagesInput.files).forEach((file) => formData.append("images", file));
    }
    if (documentsInput?.files) {
      Array.from(documentsInput.files).forEach((file) => formData.append("documents", file));
    }

    const isEdit = state.mode === "edit" && state.selectedItemId;
    feedback.textContent = isEdit ? "Saving item changes..." : "Creating item...";

    try {
      const response = await fetch(
        isEdit ? `${API_BASE_URL}/api/items/${state.selectedItemId}` : `${API_BASE_URL}/api/items`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: getAuditHeaders("Admin"),
          body: formData
        }
      );
      const payload = (await response.json().catch(() => null)) as { error?: string } | AuctionItem | null;
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error || "Unable to save item.");
      }
      const saved = payload as AuctionItem;
      if (!isEdit) {
        window.location.href = "/admin-item.html";
        return;
      }
      state.mode = "edit";
      state.selectedItemId = saved.id;
      updateQueryState();
      await refreshData("Item saved successfully.");
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : "Unable to save item.";
    }
  });
};

const deleteItem = async (itemId: string) => {
  const feedback = document.querySelector<HTMLParagraphElement>("#admin-feedback");
  if (feedback) feedback.textContent = "Archiving item...";
  try {
    const response = await fetch(`${API_BASE_URL}/api/items/${itemId}`, {
      method: "DELETE",
      headers: getAuditHeaders("Admin")
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Unable to archive item.");
    }
    state.listFilter = "archived";
    state.selectedItemId = itemId;
    state.mode = "edit";
    state.listPage = 1;
    updateQueryState();
    await refreshData("Item archived successfully.");
    showActionStatus("success", "✓", "Item archived successfully.");
  } catch (error) {
    if (feedback) {
      feedback.textContent = error instanceof Error ? error.message : "Unable to archive item.";
    }
    showActionStatus("error", "❌", error instanceof Error ? error.message : "Unable to archive item.");
  }
};

const restoreItem = async (itemId: string) => {
  const feedback = document.querySelector<HTMLParagraphElement>("#admin-feedback");
  if (feedback) feedback.textContent = "Restoring item...";
  try {
    const response = await fetch(`${API_BASE_URL}/api/items/${itemId}/restore`, {
      method: "POST",
      headers: getAuditHeaders("Admin")
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | AuctionItem | null;
    if (!response.ok) {
      throw new Error((payload as { error?: string } | null)?.error || "Unable to restore item.");
    }
    const restored = payload as AuctionItem;
    state.mode = "edit";
    state.selectedItemId = restored.id;
    state.listFilter = "active";
    state.listPage = 1;
    updateQueryState();
    await refreshData("Item restored successfully.");
    showActionStatus("success", "✓", "Item restored successfully.");
  } catch (error) {
    if (feedback) {
      feedback.textContent = error instanceof Error ? error.message : "Unable to restore item.";
    }
    showActionStatus("error", "❌", error instanceof Error ? error.message : "Unable to restore item.");
  }
};

const deleteCategory = async (category: string) => {
  const feedback = document.querySelector<HTMLParagraphElement>("#category-feedback");
  if (feedback) feedback.textContent = "Deleting category...";
  try {
    const response = await fetch(`${API_BASE_URL}/api/categories/${encodeURIComponent(category)}`, {
      method: "DELETE",
      headers: getAuditHeaders("Admin")
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Unable to delete category.");
    }
    await refreshData(`Category "${category}" deleted.`);
    showActionStatus("success", "✓", `Category "${category}" deleted.`);
  } catch (error) {
    if (feedback) {
      feedback.textContent = error instanceof Error ? error.message : "Unable to delete category.";
    }
    showActionStatus("error", "❌", error instanceof Error ? error.message : "Unable to delete category.");
  }
};

const loadItems = async () => {
  const response = await fetch(`${API_BASE_URL}/api/items?includeArchived=1`, {
    headers: getAuditHeaders("Admin")
  });
  if (!response.ok) {
    throw new Error("Unable to load auction items.");
  }
  const items = (await response.json()) as AuctionItem[];
  state.items = items;
};

const loadCategories = async () => {
  const response = await fetch(`${API_BASE_URL}/api/categories`);
  if (!response.ok) {
    throw new Error("Unable to load categories.");
  }
  const categories = (await response.json()) as string[];
  state.categories = categories.length ? categories : [...defaultCategories];
};

const refreshData = async (feedbackMessage?: string) => {
  await Promise.all([loadItems(), loadCategories()]);
  state.listPage = Math.min(state.listPage, getTotalPages());
  if (state.selectedItemId && !state.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = null;
    state.mode = "create";
  }

  if (state.mode === "create" && !state.selectedItemId) {
    state.categories = state.categories.length ? state.categories : [...defaultCategories];
  }

  renderManager();
  bindManagerEvents();

  if (feedbackMessage) {
    const feedbackTarget = feedbackMessage.startsWith("Category")
      ? document.querySelector<HTMLParagraphElement>("#category-feedback")
      : document.querySelector<HTMLParagraphElement>("#admin-feedback");
    if (feedbackTarget) feedbackTarget.textContent = feedbackMessage;
  }
};

const init = async () => {
  const session = readAuthSession();
  if (!session.signedIn || session.role !== "Admin") {
    renderAccessDenied();
    return;
  }

  const itemId = getSelectedItemIdFromQuery();
  if (itemId) {
    state.mode = "edit";
    state.selectedItemId = itemId;
  }

  try {
    await refreshData();
  } catch {
    renderMessage("Service unavailable", "Unable to load the item manager right now.");
  }
};

void init();
