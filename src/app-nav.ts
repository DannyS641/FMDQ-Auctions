import { logoutAccount, type AuthSession } from "./auth";

type NavKey = "desk" | "dashboard" | "bids" | "profile" | "admin" | "operations";

type NavOptions = {
  active?: NavKey;
  showAdminLinks?: boolean;
};

const navShellClass =
  "mx-auto flex w-full max-w-[112rem] flex-col items-center gap-4 rounded-[1.5rem] border border-ink/10 bg-white px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] sm:rounded-[2rem] sm:px-5 lg:flex-row lg:flex-nowrap lg:justify-between lg:px-8";

const navActionClass =
  "inline-flex min-h-[3rem] w-full max-w-full shrink-0 items-center justify-center gap-2 rounded-[0.9rem] bg-white px-6 text-sm font-semibold text-ink transition duration-200 hover:bg-[#eef3ff] hover:text-[#1d326c] sm:w-auto sm:whitespace-nowrap";

const baseLinkClass = (active: boolean) =>
  `inline-flex min-h-[3rem] w-full shrink-0 items-center justify-center px-5 text-sm font-semibold transition duration-200 sm:w-auto sm:px-6 sm:whitespace-nowrap ${
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

const menuIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-6 w-6">
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
`;

export const renderAppHeader = (session: AuthSession, options: NavOptions = {}) => {
  const active = options.active || "desk";
  const canSeeAdmin = options.showAdminLinks || session.role === "Admin" || session.role === "SuperAdmin";
  const navLinks = `
    <a href="/bidding.html" class="${baseLinkClass(active === "desk")}">Auction desk</a>
    <a href="/dashboard.html" class="${baseLinkClass(active === "dashboard")}">Dashboard</a>
    <a href="/my-bids.html" class="${baseLinkClass(active === "bids")}">My bids</a>
    ${canSeeAdmin ? `<a href="/admin-item.html" class="${baseLinkClass(active === "admin")}">Items</a>` : ""}
    ${canSeeAdmin ? `<a href="/operations.html" class="${baseLinkClass(active === "operations")}">Operations</a>` : ""}
  `;
  const accountLinks = `
    ${session.signedIn ? `<div class="inline-flex min-h-[3rem] w-full shrink-0 items-center justify-center rounded-[0.9rem] bg-[#eef3ff] px-4 text-sm font-semibold text-[#1d326c] sm:w-auto sm:px-6 sm:whitespace-nowrap">Role: ${session.role}</div>` : ""}
    <a href="/profile.html" class="${navActionClass}"><span class="min-w-0 truncate">${session.signedIn ? session.displayName : "Profile"}</span>${profileIcon}</a>
    ${
      session.signedIn
        ? `<button id="global-signout-btn" class="${navActionClass}" type="button"><span class="min-w-0 truncate">Sign out</span>${signOutIcon}</button>`
        : `<a href="/signin.html" class="${baseLinkClass(false)}">Sign in</a>`
    }
  `;

  return `
    <header class="bg-white px-4 py-4 md:px-6">
      <nav class="${navShellClass}">
        <div class="flex w-full items-center justify-between gap-4 lg:w-auto">
          <a href="/bidding.html" class="flex shrink-0 items-center gap-3">
            <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto sm:h-12" />
          </a>
          <button
            id="global-mobile-menu-toggle"
            type="button"
            class="inline-flex h-12 w-12 items-center justify-center rounded-[0.9rem] bg-[#eef3ff] text-[#1d326c] lg:hidden"
            aria-label="Open navigation menu"
            aria-expanded="false"
            aria-controls="global-mobile-menu"
          >
            ${menuIcon}
          </button>
        </div>
        <div class="hidden w-full items-center justify-center gap-2 lg:flex lg:w-auto lg:flex-1">
          ${navLinks}
        </div>
        <div class="hidden w-full items-center justify-center gap-3 lg:flex lg:w-auto lg:flex-nowrap lg:justify-end">
          ${accountLinks}
        </div>
        <div id="global-mobile-menu" class="hidden w-full space-y-3 border-t border-ink/10 pt-4 lg:hidden">
          <div class="grid grid-cols-1 gap-2">
            ${navLinks}
          </div>
          <div class="grid grid-cols-1 gap-3">
            ${accountLinks}
          </div>
        </div>
      </nav>
    </header>
  `;
};

export const wireAppHeader = () => {
  const toggle = document.querySelector<HTMLButtonElement>("#global-mobile-menu-toggle");
  const mobileMenu = document.querySelector<HTMLDivElement>("#global-mobile-menu");

  toggle?.addEventListener("click", () => {
    if (!mobileMenu) return;
    const isHidden = mobileMenu.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(!isHidden));
    toggle.setAttribute("aria-label", isHidden ? "Open navigation menu" : "Close navigation menu");
  });

  document.querySelectorAll<HTMLButtonElement>("#global-signout-btn").forEach((button) => {
    button.addEventListener("click", async () => {
    await logoutAccount();
    window.location.href = "/signin.html";
  });
  });
};
