import "./styles.css";
import {
  fetchCurrentSession,
  fetchMyProfile,
  fetchMySessions,
  logoutAccount,
  requestPasswordReset,
  revokeMySession,
  revokeOtherSessions,
  readAuthSession
} from "./auth";
import { renderAppHeader, wireAppHeader } from "./app-nav";

const revealApp = () => {
  window.requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
  });
};

const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const renderShell = (content: string) => {
  const root = document.querySelector<HTMLDivElement>("#profile-app");
  if (!root) return;
  root.innerHTML = `
    <div class="min-h-screen bg-ash">
      ${renderAppHeader(readAuthSession(), { active: "profile" })}
      <main class="mx-auto w-full max-w-7xl px-6 py-10">${content}</main>
    </div>
  `;
  wireAppHeader();
  revealApp();
};

const init = async () => {
  await fetchCurrentSession().catch(() => undefined);
  const session = readAuthSession();
  if (!session.signedIn) {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Sign in first to view your profile.</div>`);
    return;
  }

  try {
    const [profile, sessions] = await Promise.all([fetchMyProfile(), fetchMySessions()]);
    renderShell(`
      <section class="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div class="rounded-3xl border border-ink/10 bg-white p-6">
          <p class="text-xs uppercase tracking-[0.3em] text-slate">My profile</p>
          <h1 class="mt-2 text-3xl font-semibold text-ink">${profile.displayName}</h1>
          <div class="mt-6 space-y-3 text-sm text-ink">
            <div><span class="text-slate">Email:</span> <span class="font-semibold">${profile.email}</span></div>
            <div><span class="text-slate">Primary role:</span> <span class="font-semibold">${profile.role}</span></div>
            <div><span class="text-slate">All roles:</span> <span class="font-semibold">${profile.roles.join(", ")}</span></div>
            <div><span class="text-slate">Status:</span> <span class="font-semibold">${profile.status}</span></div>
            <div><span class="text-slate">Created:</span> <span class="font-semibold">${formatDate(profile.createdAt)}</span></div>
            <div><span class="text-slate">Last login:</span> <span class="font-semibold">${profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "Never"}</span></div>
          </div>
          <div class="mt-6 flex flex-wrap gap-3">
            <button id="profile-reset-password" class="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">Email me a reset link</button>
            <button id="profile-signout" class="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Sign out</button>
          </div>
          <p id="profile-feedback" class="mt-4 rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">Manage your sessions and account security from here.</p>
        </div>
        <div class="rounded-3xl border border-ink/10 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-slate">Session management</p>
              <h2 class="mt-2 text-2xl font-semibold text-ink">Devices and active sessions</h2>
            </div>
            <button id="revoke-other-sessions" class="rounded-full border border-ink/20 px-5 py-3 text-sm font-semibold text-ink">Revoke other sessions</button>
          </div>
          <div class="mt-6 space-y-3">
            ${sessions.length ? sessions.map((entry) => `
              <div class="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold text-ink">${entry.current ? "Current session" : "Active session"}</p>
                    <p class="mt-1 text-xs text-slate">Started ${formatDate(entry.createdAt)}</p>
                    <p class="mt-1 text-xs text-slate">Expires ${formatDate(entry.expiresAt)}</p>
                  </div>
                  ${entry.current ? `<span class="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink">This browser</span>` : `<button data-revoke-session="${entry.id}" class="rounded-full border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700">Revoke</button>`}
                </div>
              </div>
            `).join("") : `<p class="text-sm text-slate">No active sessions found.</p>`}
          </div>
        </div>
      </section>
    `);

    const feedback = document.querySelector<HTMLParagraphElement>("#profile-feedback");
    document.querySelector<HTMLButtonElement>("#profile-reset-password")?.addEventListener("click", async () => {
      try {
        const payload = await requestPasswordReset(profile.email);
        if (feedback) feedback.textContent = payload.message || "Password reset email sent.";
      } catch (error) {
        console.error("Unable to request profile password reset.", error);
        if (feedback) {
          feedback.textContent = "Unable to send a password reset email right now. Please try again in a moment.";
        }
      }
    });
    document.querySelector<HTMLButtonElement>("#profile-signout")?.addEventListener("click", async () => {
      await logoutAccount();
      window.location.href = "/signin.html";
    });
    document.querySelector<HTMLButtonElement>("#revoke-other-sessions")?.addEventListener("click", async () => {
      try {
        const payload = await revokeOtherSessions();
        if (feedback) feedback.textContent = payload.message || "Other sessions revoked.";
        window.location.reload();
      } catch (error) {
        console.error("Unable to revoke other sessions.", error);
        if (feedback) feedback.textContent = "Unable to revoke other sessions right now. Please try again.";
      }
    });
    document.querySelectorAll<HTMLButtonElement>("[data-revoke-session]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.dataset.revokeSession || "";
        if (!sessionId) return;
        try {
          const payload = await revokeMySession(sessionId);
          if (feedback) feedback.textContent = payload.message || "Session revoked.";
          window.location.reload();
        } catch (error) {
          console.error(`Unable to revoke session ${sessionId}.`, error);
          if (feedback) feedback.textContent = "Unable to revoke that session right now. Please try again.";
        }
      });
    });
  } catch {
    renderShell(`<div class="rounded-3xl border border-ink/10 bg-white p-8 text-sm text-slate">Unable to load your profile right now.</div>`);
  }
};

void init();
