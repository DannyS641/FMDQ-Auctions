import "./styles.css";
import { resendVerification, verifyEmailToken } from "./auth";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const getParams = () => new URLSearchParams(window.location.search);

const bindResendVerification = () => {
  const resendButton = document.querySelector<HTMLButtonElement>("#resend-verification");
  resendButton?.addEventListener("click", async () => {
    const email = getParams().get("email") || "";
    const message = document.querySelector<HTMLParagraphElement>("#verify-message");
    if (!email) return;
    resendButton.disabled = true;
    if (message) message.textContent = "Sending a fresh verification email...";
    try {
      const payload = await resendVerification(email);
      if (message) message.textContent = payload.message || "A fresh verification link has been sent.";
    } catch (error) {
      console.error("Unable to resend verification email from verification page.", error);
      if (message) {
        message.textContent =
          "Unable to resend the verification email right now. Please wait a moment and try again.";
      }
    } finally {
      resendButton.disabled = false;
    }
  });
};

const renderVerifyPage = (message: string, state: "pending" | "success" | "error") => {
  const email = getParams().get("email") || "";
  const tone =
    state === "success"
      ? "bg-emerald-50 text-emerald-700"
      : state === "error"
        ? "bg-rose-50 text-rose-700"
        : "bg-[#fff7e8] text-[#9a6408]";

  document.body.innerHTML = `
    <div class="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eef4f1_45%,#ffffff_100%)] p-4">
      <div class="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-3xl items-center justify-center">
        <div class="w-full rounded-[2rem] border border-white/70 bg-white/70 p-5 shadow-[0_24px_70px_rgba(148,163,184,0.22)] backdrop-blur-xl sm:p-8 md:p-12">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <img src="/slides/fmdq-logo.png" alt="FMDQ" class="h-10 w-auto" />
            <a href="/signin.html" class="rounded-[0.9rem] border border-ink/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate">Sign in</a>
          </div>
          <p class="mt-8 text-[11px] uppercase tracking-[0.34em] text-slate">Email verification</p>
          <h1 class="mt-4 font-display text-3xl font-bold leading-none text-ink sm:text-4xl md:text-[2.8rem]">${
            state === "success" ? "Account verified" : state === "error" ? "Verification issue" : "Check your inbox"
          }</h1>
          <p class="mt-4 text-base text-slate">${
            email
              ? `We sent a verification link to ${email}. Open that link to activate your account.`
              : "Open the verification link from your email to activate your account."
          }</p>
          <div class="mt-8 rounded-[1.5rem] px-5 py-4 ${tone}">
            <p id="verify-message" class="text-sm">${message}</p>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <a href="/signin.html" class="w-full rounded-[0.9rem] bg-[#1d326c] px-6 py-3 text-center text-sm font-semibold text-white sm:w-auto">Go to sign in</a>
            ${email && state !== "success" ? `<button id="resend-verification" class="w-full rounded-[0.9rem] border border-ink/10 px-6 py-3 text-sm font-semibold text-ink sm:w-auto">Resend verification</button>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
};

const init = async () => {
  const token = getParams().get("token");
  if (!token) {
    renderVerifyPage("Open the verification email we sent you and use the link inside it to activate your account.", "pending");
    bindResendVerification();
    revealApp();
    return;
  }

  renderVerifyPage("Verifying your account now...", "pending");
  revealApp();

  try {
    const payload = await verifyEmailToken(token);
    renderVerifyPage(payload.message || "Your account has been verified. Redirecting you to sign in...", "success");
    window.setTimeout(() => {
      window.location.href = "/signin.html";
    }, 2000);
  } catch (error) {
    console.error("Unable to verify email token.", error);
    renderVerifyPage(
      "Unable to verify your email with this link. Please request a fresh verification email and try again.",
      "error"
    );
  }

  bindResendVerification();
};

void init();
