import "./styles.css";
import { fetchCurrentSession, fetchMyBids, readAuthSession } from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#my-bids-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "bids" })}
      <main class="mx-auto w-full max-w-7xl px-6 py-10">${content}</main>
    </div>
  `;
  wireAppHeader();
  revealApp();
};

const init = async () => {
  await fetchCurrentSession().catch(() => undefined);
  const session = readAuthSession();
  if (!session.signedIn) {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Sign in first to review your bid history.</div>`);
    return;
  }
  try {
    const bids = await fetchMyBids();
    renderShell(`
      <section>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Bidder workspace</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink">My bids</h1>
        <p class="mt-3 text-sm text-slate">${bids.length} auction listing(s) currently have bids from ${session.displayName}.</p>
        <div class="mt-8 grid gap-4">
          ${bids.length ? bids.map((entry) => `
            <article class="rounded-3xl border border-ink/10 bg-white p-6">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-[0.3em] text-slate">${entry.category}</p>
                  <h2 class="mt-2 text-2xl font-semibold text-ink">${entry.title}</h2>
                  <p class="mt-2 text-sm text-slate">Lot ${entry.lot}</p>
                </div>
                <span class="rounded-full border border-ink/10 bg-ink/5 px-3 py-1 text-xs font-semibold text-ink">${entry.status}</span>
              </div>
              <div class="mt-6 grid gap-4 md:grid-cols-4">
                <div><p class="text-xs uppercase tracking-[0.24em] text-slate">Your latest bid</p><p class="mt-2 text-lg font-semibold text-ink">${formatMoney(entry.yourLatestBid)}</p></div>
                <div><p class="text-xs uppercase tracking-[0.24em] text-slate">Current bid</p><p class="mt-2 text-lg font-semibold text-ink">${formatMoney(entry.currentBid)}</p></div>
                <div><p class="text-xs uppercase tracking-[0.24em] text-slate">Last bid placed</p><p class="mt-2 text-sm font-semibold text-ink">${formatDate(entry.lastBidAt)}</p></div>
                <div><p class="text-xs uppercase tracking-[0.24em] text-slate">Auction end</p><p class="mt-2 text-sm font-semibold text-ink">${formatDate(entry.endTime)}</p></div>
              </div>
              <a href="/item.html?id=${entry.itemId}" class="mt-6 inline-flex rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">Open listing</a>
            </article>
          `).join("") : `<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">No bid history is available for your account yet.</div>`}
        </div>
      </section>
    `);
  } catch {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Unable to load your bids right now.</div>`);
  }
};

void init();
