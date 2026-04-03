import "./styles.css";
import { requestPasswordReset, resetPassword } from "./auth";
import { bindPasswordVisibilityToggle } from "./password-visibility";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const getToken = () => new URLSearchParams(window.location.search).get("token") || "";

const renderPage = () => {
  const token = getToken();
  const isResetMode = Boolean(token);
  document.body.innerHTML = `
    <div class="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eef4f1_45%,#ffffff_100%)] p-3 md:p-4">
      <div class="relative mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 shadow-[0_24px_70px_rgba(148,163,184,0.28)] backdrop-blur-xl md:rounded-[2.75rem]">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(226,232,240,0.5),transparent_30%)]"></div>
        <main class="relative z-10 flex w-full items-center justify-center p-6 md:p-10">
          <section class="w-full max-w-md rounded-[2rem] bg-white px-6 py-8 md:px-10">
            <div class="flex items-center justify-between gap-4">
              <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
              <a href="/signin.html" class="rounded-full border border-ink/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate">Sign in</a>
            </div>

            <h3 class="mt-6 font-display text-xl font-bold leading-tight text-ink">${isResetMode ? "Set a new password" : "Request a reset link"}</h3>
            <p class="mt-4 text-sm text-slate">${isResetMode ? "Choose a new password for your account." : "Enter your account email and we’ll send you a password reset link."}</p>
            <form id="reset-form" class="mt-8 grid gap-3">
              ${isResetMode ? `
                <div class="flex items-center gap-2 rounded-2xl border border-ink/10 bg-white px-4 py-3">
                  <input id="reset-password" type="password" class="w-full bg-transparent text-sm outline-none" placeholder="New password (8+ chars, upper, lower, number, symbol)" />
                  <button id="reset-password-toggle" type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#1d326c] transition-colors hover:bg-[#eef4ff]" aria-label="Show new password"></button>
                </div>
                <div class="flex items-center gap-2 rounded-2xl border border-ink/10 bg-white px-4 py-3">
                  <input id="reset-password-confirm" type="password" class="w-full bg-transparent text-sm outline-none" placeholder="Confirm new password" />
                  <button id="reset-password-confirm-toggle" type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#1d326c] transition-colors hover:bg-[#eef4ff]" aria-label="Show confirm new password"></button>
                </div>
              ` : `
                <input id="reset-email" type="email" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Email address" />
              `}
              <button type="submit" class="rounded-full bg-[#1d326c] px-6 py-3.5 font-display text-base font-semibold text-white">${isResetMode ? "Update password" : "Send reset link"}</button>
            </form>
            <p id="reset-note" class="mt-5 min-h-[1.25rem] rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">${isResetMode ? "Reset links expire after 1 hour." : "We’ll email a reset link if an active account exists for the address you provide."}</p>
          </section>
        </main>
      </div>
    </div>
  `;
};

const bindEvents = () => {
  const form = document.querySelector<HTMLFormElement>("#reset-form");
  const note = document.querySelector<HTMLParagraphElement>("#reset-note");
  const token = getToken();
  const isResetMode = Boolean(token);
  bindPasswordVisibilityToggle("reset-password", "reset-password-toggle");
  bindPasswordVisibilityToggle("reset-password-confirm", "reset-password-confirm-toggle");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (isResetMode) {
        const password = document.querySelector<HTMLInputElement>("#reset-password")?.value || "";
        const confirm = document.querySelector<HTMLInputElement>("#reset-password-confirm")?.value || "";
        if (password !== confirm) {
          throw new Error("Passwords do not match.");
        }
        if (note) note.textContent = "Updating password...";
        const payload = await resetPassword(token, password);
        if (note) note.textContent = payload.message || "Password updated successfully. Redirecting to sign in...";
        window.setTimeout(() => {
          window.location.href = "/signin.html";
        }, 1800);
        return;
      }

      const email = (document.querySelector<HTMLInputElement>("#reset-email")?.value || "").trim();
      if (note) note.textContent = "Sending reset link...";
      const payload = await requestPasswordReset(email);
      if (note) note.textContent = payload.message || "If an active account exists, a reset link has been sent.";
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : "Unable to continue.";
    }
  });
};

const init = () => {
  renderPage();
  bindEvents();
  revealApp();
};

void init();
