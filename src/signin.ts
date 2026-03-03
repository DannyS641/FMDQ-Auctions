import "./styles.css";
import { PublicClientApplication, AccountInfo } from "@azure/msal-browser";

const adStatus = document.querySelector<HTMLParagraphElement>("#ad-status");
const adUser = document.querySelector<HTMLParagraphElement>("#ad-user");
const adLogin = document.querySelector<HTMLButtonElement>("#ad-login");
const adLogout = document.querySelector<HTMLButtonElement>("#ad-logout");
const continueBtn = document.querySelector<HTMLButtonElement>("#continue-btn");
const signInNote = document.querySelector<HTMLParagraphElement>("#signin-note");

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

const adEnabled = Boolean(adConfig.auth.clientId && adConfig.auth.authority);
let msalClient: PublicClientApplication | null = null;
let activeAccount: AccountInfo | null = null;
let demoSignedIn = false;

const updateContinueState = (signedIn: boolean) => {
  if (!continueBtn) return;
  continueBtn.disabled = !signedIn;
};

const updateStatus = (signedIn: boolean, userLabel: string, statusLabel: string) => {
  if (adStatus) adStatus.textContent = statusLabel;
  if (adUser) adUser.textContent = userLabel;
  updateContinueState(signedIn);
};

const updateNote = (message: string) => {
  if (signInNote) signInNote.textContent = message;
};

const setSignedOutUi = () => {
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
  updateStatus(demoSignedIn, demoSignedIn ? "Demo user" : "No AD config", demoSignedIn ? "Demo signed in" : "Demo mode");
  updateNote("AD is not configured. Demo sign-in is enabled for this environment.");
  if (demoSignedIn) {
    setSignedInUi();
  } else {
    setSignedOutUi();
  }

  adLogin?.addEventListener("click", () => {
    demoSignedIn = !demoSignedIn;
    updateStatus(demoSignedIn, demoSignedIn ? "Demo user" : "No AD config", demoSignedIn ? "Demo signed in" : "Demo mode");
    updateNote(demoSignedIn ? "Demo session active. You can continue." : "Demo sign-in is available.");
    if (demoSignedIn) {
      setSignedInUi();
    } else {
      setSignedOutUi();
    }
  });

  adLogout?.addEventListener("click", () => {
    demoSignedIn = false;
    updateStatus(false, "No AD config", "Demo mode");
    updateNote("Demo sign-in is available.");
    setSignedOutUi();
  });
};

const initAd = async () => {
  if (!adStatus || !adUser || !adLogin || !adLogout) return;

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
    updateStatus(true, activeAccount.name || activeAccount.username || "Signed in", "Connected");
    updateNote("You can continue to the bidding desk.");
    setSignedInUi();
  } else {
    updateStatus(false, "No active session", "Ready");
    updateNote("Sign in with AD to continue.");
    setSignedOutUi();
  }

  adLogin.addEventListener("click", async () => {
    if (!msalClient) return;
    try {
      const result = await msalClient.loginPopup({ scopes: ["User.Read"] });
      activeAccount = result.account;
      updateStatus(true, activeAccount?.name || activeAccount?.username || "Signed in", "Connected");
      updateNote("You can continue to the bidding desk.");
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
    updateStatus(false, "No active session", "Ready");
    updateNote("Signed out. Sign in again to continue.");
    setSignedOutUi();
  });
};

continueBtn?.addEventListener("click", handleContinue);
void initAd();
