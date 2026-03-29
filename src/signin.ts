import "./styles.css";
import { PublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  clearAuthSession,
  isDemoSignedIn,
  isLocalSignedIn,
  setDemoSignedIn,
  setLocalSignedIn,
  writeAuthSession
} from "./auth";

const renderSigninPage = () => {
  document.body.innerHTML = `
    <div class="h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#eef4f1_45%,#ffffff_100%)] p-3 md:p-4">
      <div class="relative mx-auto flex h-full w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 shadow-[0_24px_70px_rgba(148,163,184,0.28)] backdrop-blur-xl md:rounded-[2.75rem]">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.88),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(226,232,240,0.5),transparent_30%)]"></div>

        <main class="relative z-10 grid h-full w-full items-center gap-4 p-3 md:gap-6 md:p-6 xl:grid-cols-[0.8fr_1.2fr]">
          <aside class="relative hidden h-full xl:block">
            <div class="relative h-full min-h-[640px] w-full overflow-hidden rounded-3xl bg-white">
              <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,232,142,0.9)_0%,rgba(255,172,43,0.35)_42%,rgba(14,58,18,0.08)_100%)]"></div>
              <img
                src="/slides/slide-2.jpg"
                alt="Auction showcase"
                class="absolute inset-0 h-full w-full object-cover object-center"
              />
              <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.08)_38%,rgba(15,23,42,0.18)_100%)]"></div>
            </div>
          </aside>

          <section class="flex h-full min-h-0 items-center justify-center rounded-[2rem] bg-white px-6 py-8 md:px-10 md:py-8 lg:px-14">
            <div class="w-full max-w-md">
              <div class="flex items-center justify-between gap-4">
                <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
                <a
                  href="/index.html"
                  class="rounded-full border border-ink/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate transition hover:border-ink/20 hover:text-ink"
                >
                  Back
                </a>
              </div>

              <p class="mt-8 text-[11px] uppercase tracking-[0.34em] text-slate">FMDQ Auctions Portal</p>
              <h1 class="mt-4 font-display text-4xl font-bold leading-none text-ink md:text-[2.8rem]">Welcome back</h1>
              <p class="mt-4 font-display text-base text-slate">Please sign in to continue to the bidding desk.</p>

              <div class="mt-8 grid gap-3">
                <div class="rounded-full border border-ink/10 bg-[#faf9f7] px-5 py-4">
                  <p class="text-[11px] uppercase tracking-[0.28em] text-slate">User</p>
                  <p id="ad-user" class="mt-1 font-display text-base font-semibold text-ink">No active session</p>
                </div>
              </div>

              <div class="my-6 flex items-center gap-4">
                <span class="h-px flex-1 bg-ink/10"></span>
                <span class="text-[11px] uppercase tracking-[0.28em] text-slate">Secure access</span>
                <span class="h-px flex-1 bg-ink/10"></span>
              </div>

              <div class="grid gap-3">
                <button
                  id="ad-login"
                  class="rounded-full border border-ink/15 bg-white px-6 py-3.5 font-display text-base font-semibold text-ink shadow-[0_8px_25px_rgba(11,14,18,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(11,14,18,0.12)]"
                >
                  Sign in with AD
                </button>
                <button
                  id="ad-logout"
                  class="hidden rounded-full border border-ink/15 bg-white px-6 py-3.5 font-display text-base font-semibold text-ink shadow-[0_8px_25px_rgba(11,14,18,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(11,14,18,0.1)]"
                >
                  Sign out
                </button>
                <button
                  id="continue-btn"
                  class="rounded-full bg-[#ff9f1c] px-6 py-3.5 font-display text-base font-semibold text-white shadow-[0_18px_35px_rgba(255,159,28,0.32)] transition hover:-translate-y-0.5 hover:bg-[#ff9410] disabled:hover:translate-y-0 disabled:hover:bg-[#ff9f1c]"
                  disabled
                >
                  Continue to bidding
                </button>
              </div>

              <p id="signin-note" class="mt-5 min-h-[1.25rem] rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]"></p>
            </div>
          </section>
        </main>
      </div>
    </div>
  `;
};

renderSigninPage();

const adUser = document.querySelector<HTMLParagraphElement>("#ad-user");
const adLogin = document.querySelector<HTMLButtonElement>("#ad-login");
const adLogout = document.querySelector<HTMLButtonElement>("#ad-logout");
const continueBtn = document.querySelector<HTMLButtonElement>("#continue-btn");
const signInNote = document.querySelector<HTMLParagraphElement>("#signin-note");

const authMode = (import.meta.env.VITE_AUTH_MODE || "ad").toLowerCase();

const adConfig = {
  auth: {
    clientId: import.meta.env.VITE_AAD_CLIENT_ID || "",
    authority: import.meta.env.VITE_AAD_AUTHORITY || "",
    redirectUri: `${window.location.origin}/signin.html`
  },
  cache: {
    cacheLocation: "sessionStorage" as const
  }
};

const adEnabled = authMode === "ad" && Boolean(adConfig.auth.clientId && adConfig.auth.authority);
let msalClient: PublicClientApplication | null = null;
let activeAccount: AccountInfo | null = null;
let demoSignedIn = false;

const updateContinueState = (signedIn: boolean) => {
  if (!continueBtn) return;
  continueBtn.disabled = !signedIn;
};

const updateStatus = (signedIn: boolean, userLabel: string) => {
  if (adUser) adUser.textContent = userLabel;
  updateContinueState(signedIn);
};

const updateNote = (message: string) => {
  if (signInNote) signInNote.textContent = message;
};

const setSignedOutUi = () => {
  clearAuthSession();
  adLogin?.classList.remove("hidden");
  adLogout?.classList.add("hidden");
};

const setSignedInUi = () => {
  adLogin?.classList.add("hidden");
  adLogout?.classList.remove("hidden");
};

const handleContinue = () => {
  if (continueBtn?.disabled) {
    updateNote("Please sign in before continuing to the bidding desk.");
    return;
  }
  window.location.href = "/bidding.html";
};

const initDemoMode = () => {
  demoSignedIn = isDemoSignedIn();
  updateStatus(demoSignedIn, demoSignedIn ? "Demo user" : "No AD config");
  updateNote("Demo mode is active for this environment.");
  if (demoSignedIn) {
    writeAuthSession({ mode: "demo", signedIn: true, displayName: "Demo user" });
    setSignedInUi();
  } else {
    setSignedOutUi();
  }

  adLogin?.addEventListener("click", () => {
    demoSignedIn = !demoSignedIn;
    setDemoSignedIn(demoSignedIn);
    updateStatus(demoSignedIn, demoSignedIn ? "Demo user" : "No AD config");
    updateNote(demoSignedIn ? "Demo mode is active. You can continue." : "Demo mode is active for this environment.");
    if (demoSignedIn) {
      writeAuthSession({ mode: "demo", signedIn: true, displayName: "Demo user" });
      setSignedInUi();
    } else {
      setSignedOutUi();
    }
  });

  adLogout?.addEventListener("click", () => {
    demoSignedIn = false;
    setDemoSignedIn(false);
    updateStatus(false, "No AD config");
    updateNote("Demo mode is active for this environment.");
    setSignedOutUi();
  });
};

const initAd = async () => {
  if (!adLogin || !adLogout) return;

  if (authMode === "local") {
    const signedIn = isLocalSignedIn();
    updateStatus(signedIn, signedIn ? "Local user" : "Not signed in");
    updateNote("Local testing mode is active. Use sign in to continue.");
    if (signedIn) {
      writeAuthSession({ mode: "local", signedIn: true, displayName: "Local user" });
      setSignedInUi();
    } else {
      setSignedOutUi();
    }

    adLogin.addEventListener("click", () => {
      setLocalSignedIn(true);
      updateStatus(true, "Local user");
      updateNote("Local testing mode is active. You can continue.");
      writeAuthSession({ mode: "local", signedIn: true, displayName: "Local user" });
      setSignedInUi();
    });

    adLogout.addEventListener("click", () => {
      setLocalSignedIn(false);
      updateStatus(false, "Not signed in");
      updateNote("Local testing mode is active. Sign in again to continue.");
      setSignedOutUi();
    });

    return;
  }

  if (!adEnabled) {
    initDemoMode();
    return;
  }

  msalClient = new PublicClientApplication(adConfig);

  try {
    await msalClient.initialize();
    const accounts = msalClient.getAllAccounts();
    activeAccount = accounts[0] ?? null;
  } catch (error) {
    console.error("Failed to initialize MSAL", error);
  }

  if (activeAccount) {
    updateStatus(true, activeAccount.name || activeAccount.username || "Signed in");
    updateNote("You can continue to the bidding desk.");
    writeAuthSession({
      mode: "ad",
      signedIn: true,
      displayName: activeAccount.name || activeAccount.username || "Signed in"
    });
    setSignedInUi();
  } else {
    updateStatus(false, "No active session");
    updateNote("Sign in with AD to continue.");
    setSignedOutUi();
  }

  adLogin.addEventListener("click", async () => {
    if (!msalClient) return;
  try {
      const result = await msalClient.loginPopup({ scopes: ["User.Read"] });
      activeAccount = result.account;
      if (activeAccount) {
        msalClient.setActiveAccount(activeAccount);
      }
      updateStatus(true, activeAccount?.name || activeAccount?.username || "Signed in");
      updateNote("You can continue to the bidding desk.");
      writeAuthSession({
        mode: "ad",
        signedIn: true,
        displayName: activeAccount?.name || activeAccount?.username || "Signed in"
      });
      setSignedInUi();
    } catch (error) {
      console.error("AD login failed", error);
      updateNote("Sign-in failed. Please try again.");
    }
  });

  adLogout.addEventListener("click", async () => {
    if (!msalClient || !activeAccount) return;
    await msalClient.logoutPopup({ account: activeAccount });
    activeAccount = null;
    updateStatus(false, "No active session");
    updateNote("Signed out. Sign in again to continue.");
    setSignedOutUi();
  });
};

continueBtn?.addEventListener("click", handleContinue);
void initAd();
