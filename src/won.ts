import "./styles.css";
import { apiFetch, fetchCurrentSession, getAuditHeaders, readAuthSession } from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

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

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatMoney = (value: number) => `NGN ${value.toLocaleString("en-NG")}`;
const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const renderWonStatus = () => `
  <span class="inline-flex items-center gap-2 text-xs font-semibold text-ink">
    <span class="h-2.5 w-2.5 rounded-full bg-[#d4af37]"></span>
    <span>Won</span>
  </span>
`;

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#won-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "desk" })}
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
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Sign in first to review auctions won by your current user.</div>`);
    return;
  }

  try {
    const response = await apiFetch("/api/me/wins", {
      headers: getAuditHeaders()
    });
    if (!response.ok) throw new Error();
    const wins = (await response.json()) as WonAuction[];
    renderShell(`
      <section>
        <p class="text-xs uppercase tracking-[0.3em] text-slate">Bid outcomes</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink">Won auctions</h1>
        <p class="mt-3 text-sm text-slate">${wins.length} closed listings are currently attributed to ${session.displayName}.</p>
        <div class="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          ${wins.length
            ? wins.map((item) => `
                <article class="rounded-3xl border border-ink/10 bg-white p-5">
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-xs uppercase tracking-[0.3em] text-slate">${item.category}</p>
                    ${renderWonStatus()}
                  </div>
                  <h2 class="mt-3 text-xl font-semibold text-ink">${item.title}</h2>
                  <p class="mt-2 text-xs text-slate">Lot ${item.lot} · ${item.location}</p>
                  <div class="mt-5 space-y-3 rounded-3xl border border-ink/10 bg-ink/5 p-4 text-sm">
                    <div class="flex items-center justify-between"><span class="text-slate">Winning bid</span><span class="font-semibold text-ink">${formatMoney(item.currentBid)}</span></div>
                    <div class="flex items-center justify-between"><span class="text-slate">Auction ended</span><span class="font-semibold text-ink">${formatDate(item.endTime)}</span></div>
                    <div class="flex items-center justify-between"><span class="text-slate">Winning event</span><span class="font-semibold text-ink">${formatDate(item.wonAt)}</span></div>
                  </div>
                  <a href="/item.html?id=${item.id}" class="mt-5 inline-flex rounded-[0.9rem] bg-[#1d326c] px-4 py-2 text-xs font-semibold text-white">Open details</a>
                </article>
              `).join("")
            : `<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">No won auctions are assigned to this user yet. In this build, wins are resolved from the audit trail of closed auctions.</div>`}
        </div>
      </section>
    `);
  } catch {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Unable to load won auctions right now.</div>`);
  }
};

void init();
