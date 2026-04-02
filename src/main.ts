import "./styles.css";
import {
  apiFetch,
  fetchCurrentSession,
  getAuditHeaders,
  logoutAccount,
  readAuthSession,
  writeAuthSession
} from "./auth";

type Condition = "New" | "Used" | "Fair" | "Damaged";

type Status = "Live" | "Upcoming" | "Closed";

type Role = "Guest" | "Bidder" | "Observer" | "Admin" | "SuperAdmin";

type Bid = {
  bidder: string;
  amount: number;
  time: string;
};

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
  condition: Condition;
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
  bids: Bid[];
};

const conditions: Condition[] = ["New", "Used", "Fair", "Damaged"];

const now = Date.now();

const seedItems: AuctionItem[] = [
  {
    id: "LOT-2041",
    title: "Toyota Corolla 2015",
    category: "Cars",
    lot: "CAR-015",
    sku: "FMDQ-CAR-015",
    condition: "Used",
    location: "Lagos Warehouse",
    startBid: 4500000,
    reserve: 6200000,
    increment: 50000,
    currentBid: 5750000,
    startTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now + 90 * 60 * 1000).toISOString(),
    description: "Well-maintained sedan, full service history available.",
    images: [],
    documents: [],
    bids: [
      { bidder: "J. Martins", amount: 5400000, time: "09:10" },
      { bidder: "T. Okoro", amount: 5600000, time: "09:22" },
      { bidder: "L. Bello", amount: 5750000, time: "09:33" }
    ]
  },
  {
    id: "LOT-2042",
    title: "Samsung 65 inch UHD Smart TV",
    category: "Household Appliances",
    lot: "HAP-210",
    sku: "FMDQ-HAP-210",
    condition: "Fair",
    location: "Abuja Hub",
    startBid: 180000,
    reserve: 260000,
    increment: 5000,
    currentBid: 205000,
    startTime: new Date(now - 30 * 60 * 1000).toISOString(),
    endTime: new Date(now + 40 * 60 * 1000).toISOString(),
    description: "Screen intact, minor scratches on frame.",
    images: [],
    documents: [],
    bids: [
      { bidder: "K. Yusuf", amount: 190000, time: "09:40" },
      { bidder: "H. Adele", amount: 205000, time: "09:52" }
    ]
  },
  {
    id: "LOT-2043",
    title: "Panasonic Air Conditioner",
    category: "Household Appliances",
    lot: "HAP-213",
    sku: "FMDQ-HAP-213",
    condition: "Used",
    location: "Lagos Warehouse",
    startBid: 45000,
    reserve: 80000,
    increment: 2500,
    currentBid: 47500,
    startTime: new Date(now + 15 * 60 * 1000).toISOString(),
    endTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    description: "Non-inverter, stored unit with casing wear.",
    images: [],
    documents: [],
    bids: []
  },
  {
    id: "LOT-2044",
    title: "Office Chair - Ergonomic",
    category: "Furniture",
    lot: "FUR-088",
    sku: "FMDQ-FUR-088",
    condition: "Used",
    location: "Lagos Warehouse",
    startBid: 12000,
    reserve: 25000,
    increment: 500,
    currentBid: 17000,
    startTime: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now + 20 * 60 * 1000).toISOString(),
    description: "Fabric seat, minor scuffs on arms.",
    images: [],
    documents: [],
    bids: [
      { bidder: "S. Ahmed", amount: 14500, time: "08:45" },
      { bidder: "E. Obi", amount: 17000, time: "09:01" }
    ]
  },
  {
    id: "LOT-2045",
    title: "Iphone 12 Pro 256GB",
    category: "Phones",
    lot: "PHN-054",
    sku: "FMDQ-PHN-054",
    condition: "Fair",
    location: "Abuja Hub",
    startBid: 210000,
    reserve: 280000,
    increment: 5000,
    currentBid: 235000,
    startTime: new Date(now - 90 * 60 * 1000).toISOString(),
    endTime: new Date(now + 70 * 60 * 1000).toISOString(),
    description: "Battery health 84%, minor scratches.",
    images: [],
    documents: [],
    bids: [
      { bidder: "A. Nwosu", amount: 220000, time: "09:05" },
      { bidder: "P. Bello", amount: 235000, time: "09:19" }
    ]
  },
  {
    id: "LOT-2046",
    title: "Industrial Microwave",
    category: "Kitchen Appliances",
    lot: "KIT-032",
    sku: "FMDQ-KIT-032",
    condition: "Used",
    location: "Port Harcourt",
    startBid: 95000,
    reserve: 130000,
    increment: 2500,
    currentBid: 0,
    startTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now + 5 * 60 * 60 * 1000).toISOString(),
    description: "Commercial kitchen grade unit, tested functional.",
    images: [],
    documents: [],
    bids: []
  },
  {
    id: "LOT-2047",
    title: "Executive Desk",
    category: "Furniture",
    lot: "FUR-092",
    sku: "FMDQ-FUR-092",
    condition: "Fair",
    location: "Lagos Warehouse",
    startBid: 55000,
    reserve: 90000,
    increment: 2000,
    currentBid: 65000,
    startTime: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now - 30 * 60 * 1000).toISOString(),
    description: "Hardwood desk, drawer keys missing.",
    images: [],
    documents: [],
    bids: [
      { bidder: "R. Okafor", amount: 60000, time: "08:02" },
      { bidder: "U. James", amount: 65000, time: "08:22" }
    ]
  },
  {
    id: "LOT-2048",
    title: "Honda CR-V 2014",
    category: "Cars",
    lot: "CAR-021",
    sku: "FMDQ-CAR-021",
    condition: "Used",
    location: "Lagos Warehouse",
    startBid: 5200000,
    reserve: 7000000,
    increment: 50000,
    currentBid: 6900000,
    startTime: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now + 15 * 60 * 1000).toISOString(),
    description: "SUV with service record, needs new tyres.",
    images: [],
    documents: [],
    bids: [
      { bidder: "K. Ade", amount: 6600000, time: "08:55" },
      { bidder: "A. Nwosu", amount: 6900000, time: "09:18" }
    ]
  }
];

let items: AuctionItem[] = [...seedItems];
let categories: string[] = Array.from(new Set(seedItems.map((item) => item.category))).sort((a, b) => a.localeCompare(b));

const categoryTabs = document.querySelector<HTMLDivElement>("#category-tabs");
const categoryFilters = document.querySelector<HTMLDivElement>("#category-filters");
const conditionFilters = document.querySelector<HTMLDivElement>("#condition-filters");
const searchInput = document.querySelector<HTMLInputElement>("#search-input");
const clearFilters = document.querySelector<HTMLButtonElement>("#clear-filters");
const itemGrid = document.querySelector<HTMLDivElement>("#item-grid");
const itemCount = document.querySelector<HTMLSpanElement>("#item-count");
const liveCount = document.querySelector<HTMLSpanElement>("#live-count");
const closingCount = document.querySelector<HTMLSpanElement>("#closing-count");
const detailCard = document.querySelector<HTMLDivElement>("#detail-card");
const historyList = document.querySelector<HTMLDivElement>("#history-list");
const historyCount = document.querySelector<HTMLParagraphElement>("#history-count");

const adminPanel = document.querySelector<HTMLElement>("#admin");

const adStatus = document.querySelector<HTMLSpanElement>("#ad-status");
const adUser = document.querySelector<HTMLSpanElement>("#ad-user");
const adLogin = document.querySelector<HTMLButtonElement>("#ad-login");
const adLogout = document.querySelector<HTMLButtonElement>("#ad-logout");
const activeRoleLabel = document.querySelector<HTMLSpanElement>("#active-role-label");

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const state = {
  selectedCategories: new Set<string>(),
  selectedConditions: new Set<Condition>(),
  search: "",
  selectedItemId: items[0]?.id ?? "",
  role: "Guest" as Role
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
};
const resolveMediaUrl = (url: string) =>
  url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
const canViewReserve = () => state.role === "Admin" || state.role === "SuperAdmin";
const getReserveOutcome = (item: AuctionItem) => {
  if (item.reserve <= 0) return "No reserve";
  if (getStatus(item) !== "Closed") {
    return item.currentBid >= item.reserve ? "Reserve met" : "Reserve pending";
  }
  return item.currentBid >= item.reserve ? "Reserve met" : "Reserve not met";
};

const resolveRole = () => {
  const session = readAuthSession();
  return (session.role as Role) || "Guest";
};

const formatStatusClass = (status: Status) => {
  if (status === "Live") return "bg-neon text-white";
  if (status === "Upcoming") return "bg-gold text-white";
  return "bg-slate text-white";
};

const getStatus = (item: AuctionItem): Status => {
  const nowTime = Date.now();
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (nowTime < start) return "Upcoming";
  if (nowTime > end) return "Closed";
  return "Live";
};

const getCountdown = (item: AuctionItem) => {
  const nowTime = Date.now();
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (nowTime < start) {
    return { label: "Starts in", ms: start - nowTime, closed: false };
  }
  if (nowTime > end) {
    return { label: "Closed", ms: 0, closed: true };
  }
  return { label: "Ends in", ms: end - nowTime, closed: false };
};

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
};

const canBid = (item?: AuctionItem) => {
  const session = readAuthSession();
  if (!session.signedIn) return false;
  if (!(state.role === "Bidder" || state.role === "Admin")) return false;
  if (item && getStatus(item) !== "Live") return false;
  return true;
};

const renderCategoryTabs = () => {
  if (!categoryTabs) return;
  const allTabs = ["All", ...categories];
  const active = state.selectedCategories.size === 1
    ? Array.from(state.selectedCategories)[0]
    : "All";

  categoryTabs.innerHTML = allTabs
    .map((category) => {
      const isActive = category === "All"
        ? state.selectedCategories.size === 0
        : category === active && state.selectedCategories.size === 1;
      return `
        <button
          data-category-tab="${category}"
          class="rounded-full border px-4 py-2 text-sm font-semibold ${
            isActive ? "border-ink bg-ink text-white" : "border-ink/20 text-ink"
          }"
        >
          ${category}
        </button>
      `;
    })
    .join("");
};

const renderCategoryFilters = () => {
  if (!categoryFilters) return;
  categoryFilters.innerHTML = categories
    .map(
      (category) => `
      <label class="flex items-center gap-3">
        <input
          type="checkbox"
          data-category-filter="${category}"
          class="h-4 w-4 rounded border-ink/20"
          ${state.selectedCategories.has(category) ? "checked" : ""}
        />
        <span>${category}</span>
      </label>
    `
    )
    .join("");
};

const renderConditionFilters = () => {
  if (!conditionFilters) return;
  conditionFilters.innerHTML = conditions
    .map(
      (condition) => `
      <label class="flex items-center gap-3">
        <input
          type="checkbox"
          data-condition-filter="${condition}"
          class="h-4 w-4 rounded border-ink/20"
          ${state.selectedConditions.has(condition) ? "checked" : ""}
        />
        <span>${condition}</span>
      </label>
    `
    )
    .join("");
};

const applyFilters = () => {
  const searchValue = state.search.toLowerCase();
  return items.filter((item) => {
    const matchesCategory =
      state.selectedCategories.size === 0 ||
      state.selectedCategories.has(item.category);
    const matchesCondition =
      state.selectedConditions.size === 0 ||
      state.selectedConditions.has(item.condition);
    const matchesSearch =
      item.title.toLowerCase().includes(searchValue) ||
      item.sku.toLowerCase().includes(searchValue) ||
      item.lot.toLowerCase().includes(searchValue);
    return matchesCategory && matchesCondition && matchesSearch;
  });
};

const updateSummaryCounts = () => {
  if (!itemCount || !liveCount || !closingCount) return;
  const filtered = applyFilters();
  const liveItems = filtered.filter((item) => getStatus(item) === "Live");
  const closingSoon = filtered.filter((item) => {
    const countdown = getCountdown(item);
    return !countdown.closed && countdown.ms <= 30 * 60 * 1000;
  });

  itemCount.textContent = String(filtered.length);
  liveCount.textContent = String(liveItems.length);
  closingCount.textContent = String(closingSoon.length);
};

const syncCategoriesFromItems = () => {
  categories = Array.from(new Set(items.map((item) => item.category))).sort((a, b) => a.localeCompare(b));
};

const fetchCategories = async () => {
  try {
    const response = await apiFetch("/api/categories");
    if (!response.ok) throw new Error("Failed to load categories");
    const data = (await response.json()) as string[];
    categories = data.length ? data : Array.from(new Set(seedItems.map((item) => item.category)));
  } catch {
    syncCategoriesFromItems();
  }
};

const fetchItems = async () => {
  try {
    const response = await apiFetch("/api/items");
    if (!response.ok) throw new Error("Failed to load items");
    const data = (await response.json()) as AuctionItem[];
    items = data.length ? data : [...seedItems];
    syncCategoriesFromItems();
    state.selectedItemId = items[0]?.id ?? "";
  } catch {
    items = [...seedItems];
    syncCategoriesFromItems();
    state.selectedItemId = items[0]?.id ?? "";
  }
};

const upsertItem = (updated: AuctionItem) => {
  const index = items.findIndex((entry) => entry.id === updated.id);
  if (index >= 0) {
    items[index] = updated;
  } else {
    items.unshift(updated);
  }
};

const renderItems = () => {
  if (!itemGrid) return;
  const filtered = applyFilters();
  updateSummaryCounts();

  itemGrid.innerHTML = filtered
    .map((item) => {
      const status = getStatus(item);
      const countdown = getCountdown(item);
      const highlight = item.id === state.selectedItemId ? "border-ink" : "border-ink/10";
      const currentBid = item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids";
      const reserveLabel = item.reserve > 0
        ? (canViewReserve() ? formatMoney(item.reserve) : "Confidential")
        : "No reserve";
      const reserveOutcome = getReserveOutcome(item);
      const coverUrl = item.images[0]?.url;
      return `
        <article
          data-item-card="${item.id}"
          class="card-hover grid min-h-[520px] grid-rows-[2rem_4rem_1.75rem_11rem_4rem_2.75rem] gap-y-3 rounded-3xl border ${highlight} bg-white p-5"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs uppercase tracking-[0.3em] text-slate">${item.category}</p>
            <span
              data-status-id="${item.id}"
              class="rounded-full px-3 py-1 text-xs font-semibold ${formatStatusClass(status)}"
            >
              ${status}
            </span>
          </div>
          <h3 class="text-lg font-semibold leading-snug text-ink clamp-2">${item.title}</h3>
          <p class="text-xs text-slate leading-tight">Lot ${item.lot} - ${item.location}</p>
          <div class="flex h-full items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-white p-1">
            ${
              coverUrl
                ? `<img src="${resolveMediaUrl(coverUrl)}" alt="${item.title}" class="h-full w-full object-contain" />`
                : `<div class="h-full w-full rounded-2xl photo-placeholder"></div>`
            }
          </div>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Current bid</p>
              <p class="mt-1 font-semibold text-ink">${currentBid}</p>
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Reserve</p>
              <p class="mt-1 font-semibold text-ink">${reserveLabel}</p>
              <p class="mt-1 text-xs text-slate">${reserveOutcome}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-xs text-slate">
            <span data-countdown data-countdown-id="${item.id}">${countdown.label} ${formatDuration(
              countdown.ms
            )}</span>
            <a href="/item.html?id=${item.id}" class="rounded-full border border-ink/10 px-3 py-1 font-semibold text-ink">View details</a>
          </div>
        </article>
      `;
    })
    .join("");
};

const renderDetail = () => {
  if (!detailCard) return;
  const item = items.find((entry) => entry.id === state.selectedItemId);
  if (!item) return;

  const status = getStatus(item);
  const countdown = getCountdown(item);
  const minBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;
  const bidNotice = canBid(item)
    ? `Minimum next bid: ${formatMoney(minBid)}`
    : getStatus(item) === "Live"
      ? "Accept the agreements and sign in with a bidder-enabled account to place bids."
      : "Bidding is closed or not yet open for this item.";

  const reserveLine = item.reserve > 0
    ? (canViewReserve() ? formatMoney(item.reserve) : "Confidential")
    : "No reserve";
  const reserveOutcome = getReserveOutcome(item);
  const mainImage = item.images[0]?.url;
  const thumbnailGrid = item.images.length > 1
    ? item.images
        .slice(1, 5)
        .map(
          (image) => `
            <div class="flex h-16 items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-white p-1">
              <img src="${resolveMediaUrl(image.url)}" alt="${image.name}" class="h-full w-full object-contain" />
            </div>
          `
        )
        .join("")
    : "";
  const documentsList = item.documents.length
    ? item.documents
        .map(
          (doc) => `
            <a href="${resolveMediaUrl(doc.url)}" class="flex items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 py-2 text-xs text-ink" target="_blank" rel="noreferrer">
              <span>${doc.name}</span>
              <span class="text-slate">Download</span>
            </a>
          `
        )
        .join("")
    : `<p class="text-xs text-slate">No documents uploaded.</p>`;

  detailCard.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Lot ${item.lot} - ${item.category}</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink">${item.title}</h2>
        <p class="mt-2 text-sm text-slate">${item.description}</p>
      </div>
      <span class="rounded-full px-3 py-1 text-xs font-semibold ${formatStatusClass(status)}">${status}</span>
    </div>
    <div class="mt-6 grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
      <div class="space-y-4">
        <div class="flex h-72 items-center justify-center overflow-hidden rounded-3xl border border-ink/10 bg-white p-2">
          ${
            mainImage
              ? `<img src="${resolveMediaUrl(mainImage)}" alt="${item.title}" class="h-full w-full object-contain" />`
              : `<div class="h-full w-full rounded-3xl photo-placeholder"></div>`
          }
        </div>
        ${thumbnailGrid ? `<div class="grid grid-cols-4 gap-3">${thumbnailGrid}</div>` : ""}
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-slate">Documents</p>
          <div class="mt-3 space-y-2">${documentsList}</div>
        </div>
      </div>
      <div class="space-y-4 text-sm">
        <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
          <p class="text-xs uppercase tracking-[0.3em] text-slate">Countdown</p>
          <p class="mt-2 text-lg font-semibold text-ink" data-countdown data-countdown-id="${item.id}">
            ${countdown.label} ${formatDuration(countdown.ms)}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Current bid</p>
            <p class="mt-1 font-semibold text-ink">${
              item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"
            }</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Reserve</p>
            <p class="mt-1 font-semibold text-ink">${reserveLine}</p>
            <p class="mt-1 text-xs text-slate">${reserveOutcome}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Starts</p>
            <p class="mt-1 font-semibold text-ink">${formatDate(item.startTime)}
            </p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-slate">Ends</p>
            <p class="mt-1 font-semibold text-ink">${formatDate(item.endTime)}
            </p>
          </div>
        </div>
        <div class="rounded-2xl border border-ink/10 p-4">
          <p class="text-xs uppercase tracking-[0.3em] text-slate">Item details</p>
          <p class="mt-2 text-sm text-ink">Condition: ${item.condition}</p>
          <p class="mt-1 text-sm text-ink">Location: ${item.location}</p>
          <p class="mt-1 text-sm text-ink">SKU: ${item.sku}</p>
        </div>
        <a href="/item.html?id=${item.id}" class="mt-4 inline-flex w-fit rounded-full border border-ink/20 px-4 py-2 text-center text-xs font-semibold text-ink">Open full item page</a>
      </div>
    </div>
    <form id="bid-form" class="mt-6 space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex flex-1 items-center gap-2">
          <input
            id="bid-amount"
            type="number"
            min="${minBid}"
            step="${item.increment}"
            placeholder="${formatMoney(item.currentBid || item.startBid)}"
            class="no-spin flex-1 rounded-2xl border border-ink/10 px-4 py-3 text-sm"
          />
          <button
            id="bid-step"
            type="button"
            class="rounded-full border border-ink/20 px-4 py-3 text-sm font-semibold text-ink"
            aria-label="Increase bid"
          >
            ▲
          </button>
        </div>
        <button
          id="bid-submit"
          type="submit"
          class="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
          ${canBid(item) ? "" : "disabled"}
        >
          Place bid
        </button>
      </div>
      <p id="bid-hint" class="text-xs text-slate">${bidNotice}</p>
    </form>
  `;

  const bidForm = detailCard.querySelector<HTMLFormElement>("#bid-form");
  const bidInput = detailCard.querySelector<HTMLInputElement>("#bid-amount");
  const bidHint = detailCard.querySelector<HTMLParagraphElement>("#bid-hint");
  const bidStep = detailCard.querySelector<HTMLButtonElement>("#bid-step");

  if (bidForm && bidInput && bidHint) {
    const stepValue = item.increment;
    const baseBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;

    bidStep?.addEventListener("click", () => {
      const currentValue = Number(bidInput.value || 0);
      const nextValue = currentValue >= baseBid ? currentValue + stepValue : baseBid;
      bidInput.value = String(nextValue);
    });

    bidForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canBid(item)) {
        bidHint.textContent = "Bidding disabled. Ensure you are signed in and the agreements are complete.";
        return;
      }
      const value = Number(bidInput.value);
      const requiredBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;
      if (!value || value < requiredBid) {
        bidHint.textContent = `Bid must be at least ${formatMoney(requiredBid)}.`;
        return;
      }
      if ((value - requiredBid) % item.increment !== 0) {
        bidHint.textContent = `Bids must increase by ${formatMoney(item.increment)}.`;
        return;
      }
      bidHint.textContent = "Submitting bid...";
      try {
        const response = await apiFetch(`/api/items/${item.id}/bids`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuditHeaders(),
            "x-idempotency-key": crypto.randomUUID()
          },
          body: JSON.stringify({
            amount: value,
            expectedCurrentBid: item.currentBid
          })
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(error?.error || "Bid failed");
        }
        const updated = (await response.json()) as AuctionItem;
        upsertItem(updated);
        state.selectedItemId = updated.id;
        bidInput.value = "";
        bidHint.textContent = `Bid accepted at ${formatMoney(value)}.`;
        renderItems();
        renderDetail();
        renderHistory();
      } catch (error) {
        bidHint.textContent = error instanceof Error ? error.message : "Unable to submit bid. Please try again.";
      }
    });
  }
};

const renderHistory = () => {
  if (!historyList || !historyCount) return;
  const item = items.find((entry) => entry.id === state.selectedItemId);
  if (!item) return;

  historyCount.textContent = `${item.bids.length} bids`;
  historyList.innerHTML = item.bids.length
    ? item.bids
        .map(
          (bid) => `
          <div class="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/5 px-4 py-3">
            <div>
              <p class="text-sm font-semibold text-ink">${canViewReserve() ? bid.bidder : "Anonymous bidder"}</p>
              <p class="text-xs text-slate">${bid.time}</p>
            </div>
            <p class="text-sm font-semibold text-ink">${formatMoney(bid.amount)}</p>
          </div>
        `
        )
        .join("")
    : `<p class="text-sm text-slate">No bids recorded yet.</p>`;
};

const updateCountdowns = () => {
  document.querySelectorAll<HTMLElement>("[data-countdown]").forEach((element) => {
    const itemId = element.dataset.countdownId;
    if (!itemId) return;
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const countdown = getCountdown(item);
    element.textContent = countdown.closed
      ? "Closed"
      : `${countdown.label} ${formatDuration(countdown.ms)}`;
  });

  document.querySelectorAll<HTMLElement>("[data-status-id]").forEach((element) => {
    const itemId = element.dataset.statusId;
    if (!itemId) return;
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const status = getStatus(item);
    element.textContent = status;
    element.className = `rounded-full px-3 py-1 text-xs font-semibold ${formatStatusClass(status)}`;
  });

  updateSummaryCounts();
};

const updateRoleUi = () => {
  state.role = resolveRole();
  const session = readAuthSession();
  if (activeRoleLabel) {
    activeRoleLabel.textContent = state.role;
  }
  if (adStatus) {
    adStatus.textContent = session.signedIn ? "Signed in" : "Signed out";
  }
  if (adUser) {
    adUser.textContent = session.signedIn ? session.displayName : "No active session";
  }
  if (adLogin) {
    adLogin.classList.toggle("hidden", session.signedIn);
  }
  if (adLogout) {
    adLogout.classList.toggle("hidden", !session.signedIn);
  }
  if (adminPanel) {
    adminPanel.classList.toggle("hidden", !(state.role === "Admin" || state.role === "SuperAdmin"));
  }
  renderItems();
  renderDetail();
  renderHistory();
};

const initSessionUi = async () => {
  if (!adUser || !adLogin || !adLogout || !activeRoleLabel) return;
  try {
    const session = await fetchCurrentSession();
    writeAuthSession(session);
  } catch {
    writeAuthSession(readAuthSession());
  }
  updateRoleUi();
  adLogin.addEventListener("click", () => {
    window.location.href = "/signin.html";
  });
  adLogout.addEventListener("click", async () => {
    adLogout.disabled = true;
    adLogout.textContent = "Signing out...";
    try {
      await logoutAccount();
      updateRoleUi();
      window.location.href = "/signin.html";
    } finally {
      adLogout.disabled = false;
      adLogout.textContent = "Sign out";
    }
  });
};

const wireEvents = () => {
  categoryTabs?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("[data-category-tab]");
    if (!button) return;
    const value = button.dataset.categoryTab;
    if (!value || value === "All") {
      state.selectedCategories.clear();
    } else {
      state.selectedCategories.clear();
      state.selectedCategories.add(value);
    }
    renderCategoryTabs();
    renderCategoryFilters();
    renderItems();
  });

  categoryFilters?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const value = target.dataset.categoryFilter;
    if (!value) return;
    if (target.checked) {
      state.selectedCategories.add(value);
    } else {
      state.selectedCategories.delete(value);
    }
    renderCategoryTabs();
    renderItems();
  });

  conditionFilters?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const value = target.dataset.conditionFilter as Condition | undefined;
    if (!value) return;
    if (target.checked) {
      state.selectedConditions.add(value);
    } else {
      state.selectedConditions.delete(value);
    }
    renderItems();
  });

  searchInput?.addEventListener("input", (event) => {
    state.search = (event.target as HTMLInputElement).value;
    renderItems();
  });

  clearFilters?.addEventListener("click", () => {
    state.search = "";
    state.selectedCategories.clear();
    state.selectedConditions.clear();
    if (searchInput) searchInput.value = "";
    renderCategoryTabs();
    renderCategoryFilters();
    renderConditionFilters();
    renderItems();
  });

  itemGrid?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-item-card]");
    if (!card) return;
    const id = card.dataset.itemCard;
    if (!id) return;
    state.selectedItemId = id;
    renderItems();
    renderDetail();
    renderHistory();
  });

};

const init = async () => {
  await fetchItems();
  await fetchCategories();
  categories = Array.from(new Set([...categories, ...items.map((item) => item.category)])).sort((a, b) => a.localeCompare(b));
  renderCategoryTabs();
  renderCategoryFilters();
  renderConditionFilters();
  renderItems();
  renderDetail();
  renderHistory();
  wireEvents();
  initSessionUi();
  updateRoleUi();
  revealApp();
  setInterval(updateCountdowns, 1000);
};

void init();
