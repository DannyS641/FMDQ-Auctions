import { logoutAccount, type AuthSession } from "./auth";

type NavKey = "desk" | "dashboard" | "bids" | "profile" | "admin" | "operations";

type NavOptions = {
  active?: NavKey;
  showAdminLinks?: boolean;
};

const navShellClass =
  "mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 rounded-[2rem] border border-ink/10 bg-white px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]";

const navActionClass =
  "inline-flex min-h-[3rem] items-center justify-center gap-2 whitespace-nowrap rounded-[0.9rem] bg-white px-6 text-sm font-semibold text-ink transition duration-200 hover:bg-[#eef3ff] hover:text-[#1d326c]";

const baseLinkClass = (active: boolean) =>
  `inline-flex min-h-[3rem] items-center justify-center px-6 text-sm font-semibold transition duration-200 ${
    active
      ? "rounded-[0.9rem] bg-[#1d326c] text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)]"
      : "rounded-[0.9rem] bg-white text-ink hover:bg-[#eef3ff] hover:text-[#1d326c]"
  }`;

const profileIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="8" r="4" />
  </svg>
`;

const signOutIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
`;

export const renderAppHeader = (session: AuthSession, options: NavOptions = {}) => {
  const active = options.active || "desk";
  const canSeeAdmin = options.showAdminLinks || session.role === "Admin" || session.role === "SuperAdmin";

  return `
    <header class="bg-white px-4 py-4 md:px-6">
      <nav class="${navShellClass}">
        <a href="/bidding.html" class="flex items-center gap-3">
          <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-12 w-auto" />
        </a>
        <div class="flex flex-wrap items-center gap-2">
          <a href="/bidding.html" class="${baseLinkClass(active === "desk")}">Auction desk</a>
          <a href="/dashboard.html" class="${baseLinkClass(active === "dashboard")}">Dashboard</a>
          <a href="/my-bids.html" class="${baseLinkClass(active === "bids")}">My bids</a>
          ${canSeeAdmin ? `<a href="/admin-item.html" class="${baseLinkClass(active === "admin")}">Items</a>` : ""}
          ${canSeeAdmin ? `<a href="/operations.html" class="${baseLinkClass(active === "operations")}">Operations</a>` : ""}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          ${session.signedIn ? `<div class="inline-flex min-h-[3rem] items-center justify-center rounded-[0.9rem] bg-[#eef3ff] px-6 text-sm font-semibold text-[#1d326c]">Role: ${session.role}</div>` : ""}
          <a href="/profile.html" class="${navActionClass}"><span>${session.signedIn ? session.displayName : "Profile"}</span>${profileIcon}</a>
          ${
            session.signedIn
              ? `<button id="global-signout-btn" class="${navActionClass}" type="button"><span>Sign out</span>${signOutIcon}</button>`
              : `<a href="/signin.html" class="${baseLinkClass(false)}">Sign in</a>`
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
