import "./styles.css";

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

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;

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
};

const renderItem = (item: AuctionItem) => {
  const container = document.querySelector<HTMLDivElement>("#item-view");
  if (!container) return;

  const gallery = item.images.length
    ? item.images
        .map(
          (image) => `
          <div class="h-36 overflow-hidden rounded-2xl border border-ink/10 bg-ink/5">
            <img src="${API_BASE_URL}${image.url}" alt="${image.name}" class="h-full w-full object-cover" />
          </div>
        `
        )
        .join("")
    : `<div class="h-36 rounded-2xl border border-ink/10 bg-ink/5"></div>`;

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
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <span class="font-semibold">${new Date(item.startTime).toLocaleString()}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>End</span>
            <span class="font-semibold">${new Date(item.endTime).toLocaleString()}</span>
          </div>
        </div>
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
};

const init = async () => {
  const id = getQuery();
  if (!id) {
    renderEmpty("No item selected. Return to the auctions list.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/items/${id}`);
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


