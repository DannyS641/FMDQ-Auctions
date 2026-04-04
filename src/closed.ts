import "./styles.css";
import { apiFetch, fetchCurrentSession, readAuthSession } from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

type FileRef = {
  name: string;
  url: string;
};

type AuctionItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  location: string;
  currentBid: number;
  reserve: number;
  endTime: string;
  images: FileRef[];
};

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174";
const resolveMediaUrl = (url: string) => (url.startsWith("http") ? url : `${API_BASE_URL}${url}`);
const getReserveOutcome = (item: AuctionItem) => {
  if (item.reserve <= 0) return "No reserve";
  return item.currentBid >= item.reserve ? "Reserve met" : "Reserve not met";
};

const renderClosedStatus = () => `
  <span class="inline-flex items-center gap-2 text-xs font-semibold text-ink">
    <span class="h-2.5 w-2.5 rounded-full bg-slate"></span>
    <span>Closed</span>
  </span>
`;

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#closed-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "desk" })}
      <main class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">${content}</main>
    </div>
  `;
  wireAppHeader();
  revealApp();
};

const renderClosed = (items: AuctionItem[]) => {
  renderShell(`
    <section>
      <p class="text-xs uppercase tracking-[0.3em] text-slate">Auction archive</p>
      <h1 class="mt-2 text-2xl font-semibold text-ink sm:text-3xl">Closed auctions</h1>
      <p class="mt-3 text-sm text-slate">${items.length} completed listings are available for review.</p>
      <div class="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        ${items.length
          ? items.map((item) => `
              <article class="rounded-3xl border border-ink/10 bg-white p-5">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs uppercase tracking-[0.3em] text-slate">${item.category}</p>
                  ${renderClosedStatus()}
                </div>
                <h2 class="mt-3 text-xl font-semibold text-ink">${item.title}</h2>
                <p class="mt-2 text-xs text-slate">Lot ${item.lot} · ${item.location}</p>
                <div class="mt-4 flex h-64 items-center justify-center overflow-hidden rounded-3xl border border-ink/10 bg-white p-2">
                  ${item.images[0]?.url ? `<img src="${resolveMediaUrl(item.images[0].url)}" alt="${item.title}" class="h-full w-full object-contain" />` : `<div class="h-full w-full rounded-3xl photo-placeholder"></div>`}
                </div>
                <div class="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p class="text-xs uppercase tracking-[0.3em] text-slate">Final bid</p>
                    <p class="mt-1 text-lg font-semibold text-ink">${item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"}</p>
                    <p class="mt-1 text-xs text-slate">${getReserveOutcome(item)}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs uppercase tracking-[0.3em] text-slate">Ended</p>
                    <p class="mt-1 text-sm font-semibold text-ink">${formatDate(item.endTime)}</p>
                  </div>
                </div>
                <a href="/item.html?id=${item.id}" class="mt-5 inline-flex rounded-[0.9rem] bg-[#1d326c] px-4 py-2 text-xs font-semibold text-white">Open details</a>
              </article>
            `).join("")
          : `<div class="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">No closed auctions are available yet.</div>`}
      </div>
    </section>
  `);
};

const init = async () => {
  try {
    await fetchCurrentSession().catch(() => undefined);
    const response = await apiFetch("/api/items");
    if (!response.ok) throw new Error();
    const items = ((await response.json()) as AuctionItem[])
      .filter((item) => new Date(item.endTime).getTime() < Date.now())
      .sort((left, right) => new Date(right.endTime).getTime() - new Date(left.endTime).getTime());
    renderClosed(items);
  } catch {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">Unable to load closed auctions right now.</div>`);
  }
};

void init();
