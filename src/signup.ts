import "./styles.css";
import { registerAccount } from "./auth";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const renderSignupPage = () => {
  document.body.innerHTML = `
    <div class="h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#eef4f1_45%,#ffffff_100%)] p-3 md:p-4">
      <div class="relative mx-auto flex h-full w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 shadow-[0_24px_70px_rgba(148,163,184,0.28)] backdrop-blur-xl md:rounded-[2.75rem]">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(226,232,240,0.5),transparent_30%)]"></div>
        <main class="relative z-10 grid h-full w-full items-center gap-4 p-3 md:gap-6 md:p-6 xl:grid-cols-[0.8fr_1.2fr]">
          <aside class="relative hidden h-full xl:block">
            <div class="relative h-full min-h-[640px] w-full overflow-hidden rounded-3xl bg-white">
              <img src="/slides/slide-3.jpg" alt="Auction showcase" class="absolute inset-0 h-full w-full object-cover object-center" />
              <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.08)_38%,rgba(15,23,42,0.18)_100%)]"></div>
            </div>
          </aside>

          <section class="flex h-full min-h-0 items-center justify-center rounded-[2rem] bg-white px-6 py-8 md:px-10 md:py-8 lg:px-14">
            <div class="w-full max-w-md">
              <div class="flex items-center justify-between gap-4">
                <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
                <a href="/signin.html" class="rounded-full border border-ink/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate">Sign in</a>
              </div>

              <h3 class="mt-6 font-display text-xl font-bold leading-tight text-ink md:text-[1.4rem]">Set up your account</h3>
              <p class="mt-4 font-display text-base text-slate">Create your account first. We’ll send a verification link to your email before you can sign in.</p>

              <form id="signup-form" class="mt-8 grid gap-3">
                <input id="signup-name" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Full name" />
                <input id="signup-email" type="email" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Email address" />
                <input id="signup-password" type="password" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Password (min. 8 characters)" />
                <button type="submit" class="rounded-full bg-[#1d326c] px-6 py-3.5 font-display text-base font-semibold text-white">Create account</button>
              </form>

              <p id="signup-note" class="mt-4 min-h-[1.25rem] rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">Create your account to receive a verification link.</p>

              <div class="mt-6 rounded-[1.5rem] border border-ink/10 bg-[#faf9f7] px-5 py-4">
                <p class="text-[11px] uppercase tracking-[0.28em] text-slate">What happens next</p>
                <p class="mt-2 text-sm text-slate">1. Create your account. 2. Open the verification link from your email. 3. Return to sign in.</p>
              </div>

            </div>
          </section>
        </main>
      </div>

      <div id="signup-consent-modal" class="pointer-events-none fixed inset-0 z-50 hidden items-center justify-center bg-[#0f172a]/45 p-4">
        <div class="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
          <p class="text-[11px] uppercase tracking-[0.28em] text-slate">Before you continue</p>
          <h4 class="mt-3 font-display text-2xl font-semibold text-ink">Confirm your agreement</h4>
          <p class="mt-4 text-sm leading-6 text-slate">By clicking this, you agree to the <a href="/terms.html" target="_blank" rel="noreferrer" class="font-semibold text-ink underline underline-offset-4">Terms &amp; Conditions</a>, <a href="/auction-rules.html" target="_blank" rel="noreferrer" class="font-semibold text-ink underline underline-offset-4">Auction Rules</a>, and <a href="/declaration.html" target="_blank" rel="noreferrer" class="font-semibold text-ink underline underline-offset-4">Declaration</a> for the FMDQ Auctions Portal.</p>
          <div class="mt-6 flex flex-wrap items-center justify-end gap-3">
            <button id="signup-consent-cancel" type="button" class="rounded-full border border-ink/15 px-5 py-3 text-sm font-semibold text-ink">Cancel</button>
            <button id="signup-consent-confirm" type="button" class="rounded-full bg-[#1d326c] px-5 py-3 text-sm font-semibold text-white">I agree, create account</button>
          </div>
        </div>
      </div>
    </div>
  `;
};

const bindEvents = () => {
  const form = document.querySelector<HTMLFormElement>("#signup-form");
  const note = document.querySelector<HTMLParagraphElement>("#signup-note");
  const modal = document.querySelector<HTMLDivElement>("#signup-consent-modal");
  const confirmBtn = document.querySelector<HTMLButtonElement>("#signup-consent-confirm");
  const cancelBtn = document.querySelector<HTMLButtonElement>("#signup-consent-cancel");
  let pendingSubmission: { displayName: string; email: string; password: string } | null = null;

  const closeModal = () => {
    if (!modal) return;
    modal.classList.add("hidden", "pointer-events-none");
    modal.classList.remove("flex");
  };

  const openModal = () => {
    if (!modal) return;
    modal.classList.remove("hidden", "pointer-events-none");
    modal.classList.add("flex");
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = (document.querySelector<HTMLInputElement>("#signup-name")?.value || "").trim();
    const email = (document.querySelector<HTMLInputElement>("#signup-email")?.value || "").trim();
    const password = document.querySelector<HTMLInputElement>("#signup-password")?.value || "";
    pendingSubmission = { displayName, email, password };
    if (note) note.textContent = "Confirm the popup agreement to finish creating your account.";
    openModal();
  });

  cancelBtn?.addEventListener("click", () => {
    closeModal();
    pendingSubmission = null;
    if (note) note.textContent = "Account creation was cancelled.";
  });

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
      pendingSubmission = null;
      if (note) note.textContent = "Account creation was cancelled.";
    }
  });

  confirmBtn?.addEventListener("click", async () => {
    if (!pendingSubmission) return;
    const { displayName, email, password } = pendingSubmission;
    closeModal();
    if (note) note.textContent = "Creating account...";
    confirmBtn.disabled = true;
    try {
      await registerAccount(displayName, email, password);
      window.location.href = `/verify.html?email=${encodeURIComponent(email)}`;
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : "Unable to create account.";
    } finally {
      confirmBtn.disabled = false;
      pendingSubmission = null;
    }
  });
};

const init = () => {
  renderSignupPage();
  bindEvents();
  revealApp();
};

void init();
