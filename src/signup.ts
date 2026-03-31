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

              <p class="mt-8 text-[11px] uppercase tracking-[0.34em] text-slate">Create account</p>
              <h1 class="mt-4 font-display text-4xl font-bold leading-none text-ink md:text-[2.8rem]">Set up your portal account</h1>
              <p class="mt-4 font-display text-base text-slate">Create your account first. We’ll send a verification link to your email before you can sign in.</p>

              <form id="signup-form" class="mt-8 grid gap-3">
                <input id="signup-name" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Display name" />
                <input id="signup-email" type="email" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Email address" />
                <input id="signup-password" type="password" class="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm" placeholder="Password (min. 8 characters)" />
                <button type="submit" class="rounded-full bg-[#ff9f1c] px-6 py-3.5 font-display text-base font-semibold text-white shadow-[0_18px_35px_rgba(255,159,28,0.32)]">Create account</button>
              </form>

              <div class="mt-6 rounded-[1.5rem] border border-ink/10 bg-[#faf9f7] px-5 py-4">
                <p class="text-[11px] uppercase tracking-[0.28em] text-slate">What happens next</p>
                <p class="mt-2 text-sm text-slate">1. Create your account. 2. Open the verification link from your email. 3. Return to sign in.</p>
              </div>

              <p id="signup-note" class="mt-5 min-h-[1.25rem] rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">Use the same email address you want linked to your role in the database.</p>
            </div>
          </section>
        </main>
      </div>
    </div>
  `;
};

const bindEvents = () => {
  const form = document.querySelector<HTMLFormElement>("#signup-form");
  const note = document.querySelector<HTMLParagraphElement>("#signup-note");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = (document.querySelector<HTMLInputElement>("#signup-name")?.value || "").trim();
    const email = (document.querySelector<HTMLInputElement>("#signup-email")?.value || "").trim();
    const password = document.querySelector<HTMLInputElement>("#signup-password")?.value || "";
    if (note) note.textContent = "Creating account...";
    try {
      await registerAccount(displayName, email, password);
      window.location.href = `/verify.html?email=${encodeURIComponent(email)}`;
    } catch (error) {
      if (note) note.textContent = error instanceof Error ? error.message : "Unable to create account.";
    }
  });
};

const init = () => {
  renderSignupPage();
  bindEvents();
  revealApp();
};

void init();
