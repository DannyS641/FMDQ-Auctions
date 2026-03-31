import "./styles.css";
import {
  apiFetch,
  fetchCurrentSession,
  getAuditHeaders,
  hasAcceptedAgreements,
  readAuthSession
} from "./auth";

type FileRef = {
  name: string;
  url: string;
};

type Bid = {
  bidder: string;
  amount: number;
  time: string;
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
  bids: Bid[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
};
const getStatus = (item: AuctionItem) => {
  const now = Date.now();
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (now < start) return "Upcoming";
  if (now > end) return "Closed";
  return "Live";
};

const canBid = (item: AuctionItem) => {
  const session = readAuthSession();
  if (getStatus(item) !== "Live") {
    return { allowed: false, message: "Bidding is closed or not yet open for this item." };
  }
  if (!hasAcceptedAgreements()) {
    return {
      allowed: false,
      message: "Accept the Terms and Conditions and Auction Rules on the listings page before placing a bid."
    };
  }
  if (!session.signedIn) {
    return { allowed: false, message: "Sign in to place a bid." };
  }
  if (!(session.role === "Bidder" || session.role === "Admin")) {
    return { allowed: false, message: "Your account role does not allow bidding." };
  }
  return { allowed: true, message: "" };
};

const getQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
};

const renderEmpty = (message: string) => {
  const container = document.querySelector<HTMLDivElement>("#item-view");
  if (!container) return;
  container.innerHTML = `
    <div class="rounded-3xl border border-ink/10 bg-white p-8">
      <h1 class="text-2xl font-semibold text-ink">Item not available</h1>
      <p class="mt-3 text-sm text-slate">${message}</p>
    </div>
  `;
  revealApp();
};

const renderItem = (item: AuctionItem) => {
  const container = document.querySelector<HTMLDivElement>("#item-view");
  if (!container) return;
  const bidState = canBid(item);
  const minBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;
  const session = readAuthSession();

  const mainImage = item.images[0];
  const gallery = mainImage
    ? `
        <div class="flex min-h-[28rem] items-center justify-center overflow-hidden rounded-[2rem] border border-ink/10 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.08)] lg:min-h-[36rem]">
          <img src="${API_BASE_URL}${mainImage.url}" alt="${mainImage.name}" class="h-full w-full object-contain" />
        </div>
        ${item.images.length > 1 ? `
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            ${item.images
              .slice(1)
              .map(
                (image) => `
                  <div class="flex h-44 items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-white p-2">
                    <img src="${API_BASE_URL}${image.url}" alt="${image.name}" class="h-full w-full object-contain" />
                  </div>
                `
              )
              .join("")}
          </div>
        ` : ""}
      `
    : `<div class="h-[28rem] rounded-[2rem] border border-ink/10 bg-ink/5 lg:h-[36rem]"></div>`;

  const documents = item.documents.length
    ? item.documents
        .map(
          (doc) => `
          <a href="${API_BASE_URL}${doc.url}" class="flex items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink" target="_blank" rel="noreferrer">
            <span>${doc.name}</span>
            <span class="text-xs text-slate">Download</span>
          </a>
        `
        )
        .join("")
    : `<p class="text-sm text-slate">No documents uploaded.</p>`;

  container.innerHTML = `
    <section class="space-y-6">
      <div>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Lot ${item.lot} - ${item.category}</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink">${item.title}</h1>
        <p class="mt-3 text-sm text-slate">${item.description}</p>
      </div>
      <div class="space-y-4">
        ${gallery}
      </div>
      <div>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Documents</p>
        <div class="mt-4 space-y-3">
          ${documents}
        </div>
      </div>
    </section>
    <aside class="space-y-6">
      <div class="rounded-3xl border border-ink/10 bg-white p-6">
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Auction details</p>
        <div class="mt-4 space-y-3 text-sm text-ink">
          <div class="flex items-center justify-between">
            <span>Current bid</span>
            <span class="font-semibold">${
              item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"
            }</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Start bid</span>
            <span class="font-semibold">${formatMoney(item.startBid)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Bid increment</span>
            <span class="font-semibold">${formatMoney(item.increment)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Condition</span>
            <span class="font-semibold">${item.condition}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Location</span>
            <span class="font-semibold">${item.location}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Start</span>
            <span class="font-semibold">${formatDate(item.startTime)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>End</span>
            <span class="font-semibold">${formatDate(item.endTime)}</span>
          </div>
        </div>
        ${
          session.role === "Admin"
            ? `<a href="/admin-item.html?id=${item.id}" class="mt-5 inline-flex rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Edit item</a>`
            : ""
        }
      </div>
      <div class="rounded-3xl border border-ink/10 bg-white p-6">
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Place bid</p>
        <form id="bid-form" class="mt-4 space-y-3">
          <div class="flex items-center gap-2">
            <input
              id="bid-amount"
              type="number"
              min="${minBid}"
              step="${item.increment}"
              placeholder="${formatMoney(item.currentBid || item.startBid)}"
              class="no-spin w-full rounded-2xl border border-ink/10 px-4 py-3 text-sm"
              ${bidState.allowed ? "" : "disabled"}
            />
            <button
              id="bid-step"
              type="button"
              class="rounded-full border border-ink/20 px-4 py-3 text-sm font-semibold text-ink"
              aria-label="Increase bid"
              ${bidState.allowed ? "" : "disabled"}
            >
              ▲
            </button>
          </div>
          <button
            id="bid-submit"
            type="submit"
            class="w-full rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
            ${bidState.allowed ? "" : "disabled"}
          >
            Place bid
          </button>
          ${!readAuthSession().signedIn ? `<a href="/signin.html" class="block w-full rounded-full border border-ink/20 px-5 py-3 text-center text-sm font-semibold text-ink">Sign in</a>` : ""}
          <p id="bid-hint" class="text-xs text-slate">${bidState.message}</p>
        </form>
      </div>
      <div class="rounded-3xl border border-ink/10 bg-white p-6">
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Bid history</p>
        <div class="mt-4 space-y-3">
          ${item.bids.length ?
            item.bids
              .map(
                (bid) => `
                <div class="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/5 px-4 py-2 text-sm">
                  <span>Anonymous bidder</span>
                  <span class="font-semibold">${formatMoney(bid.amount)}</span>
                </div>
              `
              )
              .join("")
            : `<p class="text-sm text-slate">No bids recorded yet.</p>`}
        </div>
      </div>
    </aside>
  `;
  revealApp();

  const bidForm = container.querySelector<HTMLFormElement>("#bid-form");
  const bidInput = container.querySelector<HTMLInputElement>("#bid-amount");
  const bidHint = container.querySelector<HTMLParagraphElement>("#bid-hint");
  const bidStep = container.querySelector<HTMLButtonElement>("#bid-step");

  const refreshBidState = () => {
    const state = canBid(item);
    if (bidInput) bidInput.disabled = !state.allowed;
    const submit = container.querySelector<HTMLButtonElement>("#bid-submit");
    if (submit) submit.disabled = !state.allowed;
    if (bidStep) bidStep.disabled = !state.allowed;
    if (bidHint) bidHint.textContent = state.message || "";
  };

  bidStep?.addEventListener("click", () => {
    const currentValue = Number(bidInput?.value || 0);
    const nextValue = currentValue >= minBid ? currentValue + item.increment : minBid;
    if (bidInput) bidInput.value = String(nextValue);
  });

  bidForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = canBid(item);
    if (!state.allowed) {
      if (bidHint) bidHint.textContent = state.message;
      return;
    }
    const value = Number(bidInput?.value || 0);
    const requiredBid = minBid;
    if (!value || value < requiredBid) {
      if (bidHint) bidHint.textContent = `Bid must be at least ${formatMoney(requiredBid)}.`;
      return;
    }
    if ((value - requiredBid) % item.increment !== 0) {
      if (bidHint) bidHint.textContent = `Bids must increase by ${formatMoney(item.increment)}.`;
      return;
    }
    if (bidHint) bidHint.textContent = "Submitting bid...";
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
      renderItem(updated);
    } catch (error) {
      if (bidHint) bidHint.textContent = error instanceof Error ? error.message : "Unable to submit bid. Please try again.";
    }
  });
};

const init = async () => {
  const id = getQuery();
  if (!id) {
    renderEmpty("No item selected. Return to the auctions list.");
    return;
  }

  try {
    await fetchCurrentSession().catch(() => undefined);
    const response = await apiFetch(`/api/items/${id}`);
    if (!response.ok) {
      renderEmpty("Unable to load item details.");
      return;
    }
    const item = (await response.json()) as AuctionItem;
    renderItem(item);
  } catch {
    renderEmpty("Unable to connect to the auction service.");
  }
};

init();
