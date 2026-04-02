import { logoutAccount, type AuthSession } from "./auth";

type NavKey = "desk" | "dashboard" | "bids" | "profile" | "admin" | "operations";

type NavOptions = {
  active?: NavKey;
  showAdminLinks?: boolean;
};

const baseLinkClass = (active: boolean) =>
  `rounded-full px-4 py-2 text-xs font-semibold transition ${
    active
      ? "bg-[#1d326c] text-white"
      : "border border-ink/10 bg-white/80 text-ink hover:border-[#1d326c]/25 hover:text-[#1d326c]"
  }`;

export const renderAppHeader = (session: AuthSession, options: NavOptions = {}) => {
  const active = options.active || "desk";
  const canSeeAdmin = options.showAdminLinks || session.role === "Admin" || session.role === "SuperAdmin";

  return `
    <header class="border-b border-ink/8 bg-white/92 backdrop-blur">
      <nav class="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <a href="/bidding.html" class="flex items-center gap-3">
          <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
        </a>
        <div class="flex flex-wrap items-center gap-2">
          <a href="/bidding.html" class="${baseLinkClass(active === "desk")}">Auction desk</a>
          <a href="/dashboard.html" class="${baseLinkClass(active === "dashboard")}">Dashboard</a>
          <a href="/my-bids.html" class="${baseLinkClass(active === "bids")}">My bids</a>
          ${canSeeAdmin ? `<a href="/admin-item.html" class="${baseLinkClass(active === "admin")}">Items</a>` : ""}
          ${canSeeAdmin ? `<a href="/operations.html" class="${baseLinkClass(active === "operations")}">Operations</a>` : ""}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          ${session.signedIn ? `<div class="rounded-full border border-[#d7dfef] bg-[#eef3ff] px-4 py-2 text-xs font-semibold text-[#1d326c]">Role: ${session.role}</div>` : ""}
          <a href="/profile.html" class="rounded-full border border-ink/10 bg-white/80 px-4 py-2 text-xs font-semibold text-ink">${session.signedIn ? session.displayName : "Profile"}</a>
          ${
            session.signedIn
              ? `<button id="global-signout-btn" class="rounded-full border border-ink/10 bg-white/80 px-4 py-2 text-xs font-semibold text-ink">Sign out</button>`
              : `<a href="/signin.html" class="rounded-full bg-[#1d326c] px-4 py-2 text-xs font-semibold text-white">Sign in</a>`
          }
        </div>
      </nav>
    </header>
  `;
};

export const wireAppHeader = () => {
  document.querySelector<HTMLButtonElement>("#global-signout-btn")?.addEventListener("click", async () => {
    await logoutAccount();
    window.location.href = "/signin.html";
  });
};
