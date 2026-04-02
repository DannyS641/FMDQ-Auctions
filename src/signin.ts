import "./styles.css";
import {
  fetchCurrentSession,
  loginWithAccount,
  logoutAccount,
  readAuthSession,
  resendVerification
} from "./auth";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const renderSigninPage = () => {
  const session = readAuthSession();
  document.body.innerHTML = `
    <div class="h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#eef4f1_45%,#ffffff_100%)] p-3 md:p-4">
      <div class="relative mx-auto flex h-full w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 shadow-[0_24px_70px_rgba(148,163,184,0.28)] backdrop-blur-xl md:rounded-[2.75rem]">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(226,232,240,0.5),transparent_30%)]"></div>
        <main class="relative z-10 grid h-full w-full items-center gap-4 p-3 md:gap-6 md:p-6 xl:grid-cols-[0.8fr_1.2fr]">
          <aside class="relative hidden h-full xl:block">
            <div class="relative h-full min-h-[640px] w-full overflow-hidden rounded-3xl bg-white">
              <img src="/slides/slide-2.jpg" alt="Auction showcase" class="absolute inset-0 h-full w-full object-cover object-center" />
              <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.08)_38%,rgba(15,23,42,0.18)_100%)]"></div>
            </div>
          </aside>

          <section class="flex h-full min-h-0 items-center justify-center rounded-[2rem] bg-white px-6 py-8 md:px-10 md:py-8 lg:px-14">
            <div class="w-full max-w-md">
              <div class="flex items-center justify-between gap-4">
                <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
                <a href="/index.html" class="rounded-full border border-ink/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate">Back</a>
              </div>

              <p class="mt-8 text-[11px] uppercase tracking-[0.34em] text-slate">FMDQ Auctions Portal</p>
              <h3 class="mt-6 font-display text-xl font-bold leading-tight text-ink md:text-[1.4rem]">Welcome back</h3>
              <p class="mt-4 font-display text-base text-slate">Sign in to continue to the bidding desk.</p>

              <div class="mt-8 rounded-full border border-ink/10 bg-[#faf9f7] px-5 py-4">
                <p class="text-[11px] uppercase tracking-[0.28em] text-slate">User</p>
                <p id="session-user" class="mt-1 font-display text-base font-semibold text-ink">${session.signedIn ? session.displayName : "No active session"}</p>
              </div>

              <div class="my-6 flex items-center gap-4">
                <span class="h-px flex-1 bg-ink/10"></span>
                <span class="text-[11px] uppercase tracking-[0.28em] text-slate">Secure access</span>
                <span class="h-px flex-1 bg-ink/10"></span>
              </div>

              ${
                session.signedIn
                  ? `
                    <div class="grid gap-3">
                      <button id="logout-btn" class="rounded-full border border-ink/15 bg-white px-6 py-3.5 font-display text-base font-semibold text-ink">Sign out</button>
                      <button id="continue-btn" class="rounded-full bg-[#1d326c] px-6 py-3.5 font-display text-base font-semibold text-white">Continue to bidding</button>
                    </div>
                  `
                  : `
                    <form id="login-form" class="grid gap-3">
                      <p class="text-xs uppercase tracking-[0.28em] text-slate">Sign in</p>
                      <input id="login-email" type="email" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Email address" />
                      <input id="login-password" type="password" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Password" />
                      <a href="/reset-password.html" class="text-right text-xs font-semibold text-[#1d326c]">Forgot password?</a>
                      <button type="submit" class="rounded-full bg-[#1d326c] px-6 py-3.5 font-display text-base font-semibold text-white">Sign in</button>
                    </form>
                    <button id="resend-verification-btn" class="mt-3 hidden text-left text-xs font-semibold text-[#1d326c]">Resend verification email</button>
                    <div class="mt-6 grid gap-3">
                      <a href="/signup.html" class="rounded-full border border-ink/15 bg-white px-6 py-3.5 text-center font-display text-base font-semibold text-ink shadow-[0_8px_25px_rgba(11,14,18,0.07)]">Create account</a>
                    </div>
                  `
              }

              <p id="signin-note" class="mt-5 min-h-[1.25rem] rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">${session.signedIn ? `Signed in as ${session.displayName} (${session.role}).` : "New users should create an account first, verify their email, then sign in."}</p>
            </div>
          </section>
        </main>
      </div>
    </div>
  `;
};

const bindEvents = () => {
  const loginForm = document.querySelector<HTMLFormElement>("#login-form");
  const note = document.querySelector<HTMLParagraphElement>("#signin-note");
  const continueBtn = document.querySelector<HTMLButtonElement>("#continue-btn");
  const logoutBtn = document.querySelector<HTMLButtonElement>("#logout-btn");
  const resendVerificationBtn = document.querySelector<HTMLButtonElement>("#resend-verification-btn");

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = (document.querySelector<HTMLInputElement>("#login-email")?.value || "").trim();
    const password = document.querySelector<HTMLInputElement>("#login-password")?.value || "";
    try {
      await loginWithAccount(email, password);
      renderSigninPage();
      bindEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in.";
      if (note) note.textContent = message;
      if (resendVerificationBtn) {
        resendVerificationBtn.classList.toggle("hidden", !message.toLowerCase().includes("verify your email"));
        resendVerificationBtn.dataset.email = email;
      }
    }
  });

  resendVerificationBtn?.addEventListener("click", async () => {
    const email = resendVerificationBtn.dataset.email || "";
    if (!email) return;
    resendVerificationBtn.disabled = true;
    try {
      const payload = await resendVerification(email);
      if (note) note.textContent = payload.message || "A fresh verification email has been sent.";
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : "Unable to resend verification email.";
    } finally {
      resendVerificationBtn.disabled = false;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await logoutAccount();
    renderSigninPage();
    bindEvents();
  });

  continueBtn?.addEventListener("click", () => {
    if (continueBtn.disabled && note) {
      note.textContent = "Please sign in before continuing to the bidding desk.";
      return;
    }
    window.location.href = "/bidding.html";
  });
};

const init = async () => {
  try {
    await fetchCurrentSession();
  } catch {
    // Ignore and render the unauthenticated state.
  }
  renderSigninPage();
  bindEvents();
  revealApp();
};

void init();
