import "./styles.css";
import { fetchCurrentSession, fetchMyDashboard, readAuthSession } from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatMoney = (value: number) => `NGN ${Number(value || 0).toLocaleString("en-NG")}`;
const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#dashboard-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "dashboard" })}
      <main class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">${content}</main>
    </div>
  `;
  wireAppHeader();
  revealApp();
};

const init = async () => {
  const syncedSession = await fetchCurrentSession().catch(() => readAuthSession());
  const session = syncedSession || readAuthSession();
  if (!session.signedIn) {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">Sign in first to view your bidder dashboard.</div>`);
    return;
  }
  try {
    const payload = await fetchMyDashboard();
    renderShell(`
      <section>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Bidder workspace</p>
        <h1 class="mt-2 break-words text-2xl font-semibold text-ink sm:text-3xl">Welcome, ${session.displayName}</h1>
        <p class="mt-3 text-sm text-slate">Track active bids, wins, reserve outcomes, and recent activity from one view.</p>
        <div class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Open bid positions</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.openBidCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Won auctions</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.wonAuctionCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Active sessions</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.activeSessionCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">My bid records</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.totalBidCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Closed reserve met</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.reserveMetClosedCount}</p></div>
          <div class="rounded-3xl border border-ink/10 bg-white p-5"><p class="text-xs uppercase tracking-[0.3em] text-slate">Closed reserve not met</p><p class="mt-2 text-3xl font-semibold text-ink">${payload.summary.reserveNotMetClosedCount}</p></div>
        </div>
        <section class="mt-10 rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
          <p class="text-xs uppercase tracking-[0.3em] text-slate">Recent activity</p>
          <h2 class="mt-2 text-xl font-semibold text-ink sm:text-2xl">My latest bid positions</h2>
          <div class="mt-6 grid gap-4">
            ${payload.recentBidActivity.length ? payload.recentBidActivity.map((entry) => `
              <article class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold text-ink">${entry.title}</p>
                    <p class="mt-1 text-xs text-slate">${entry.category}</p>
                  </div>
                  <span class="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink">${entry.status}</span>
                </div>
                <div class="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <p class="text-slate">Your bid <span class="font-semibold text-ink">${formatMoney(entry.yourLatestBid)}</span></p>
                  <p class="text-slate">Current bid <span class="font-semibold text-ink">${formatMoney(entry.currentBid)}</span></p>
                  <p class="text-slate">Ends <span class="font-semibold text-ink">${formatDate(entry.endTime)}</span></p>
                </div>
              </article>
            `).join("") : `<p class="text-sm text-slate">No bid activity yet.</p>`}
          </div>
        </section>
      </section>
    `);
  } catch (error) {
    console.error("Unable to load bidder dashboard.", error);
    renderShell(`
      <div class="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
        <p class="font-semibold text-ink">Unable to load your dashboard right now.</p>
        <p class="mt-3">Please refresh the page or try again in a moment.</p>
        <button id="dashboard-retry" type="button" class="mt-6 rounded-[0.9rem] bg-[#1d326c] px-6 py-3 text-sm font-semibold text-white">Try again</button>
      </div>
    `);
    document.querySelector<HTMLButtonElement>("#dashboard-retry")?.addEventListener("click", () => {
      window.location.reload();
    });
  }
};

void init();
