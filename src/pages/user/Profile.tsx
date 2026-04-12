import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { getMyProfile, getMySessions, revokeSession, revokeOtherSessions, requestPasswordReset } from "@/api/auth";
import { queryKeys } from "@/lib/query-keys";
import { formatDate } from "@/lib/formatters";
import { useAuth } from "@/context/auth-context";

export default function Profile() {
  const queryClient = useQueryClient();
  const { signOut } = useAuth();

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: getMyProfile,
    staleTime: 5 * 60_000,
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: queryKeys.me.sessions(),
    queryFn: getMySessions,
    staleTime: 60_000,
  });

  const { mutate: revoke } = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      toast.success("Session revoked.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.sessions() });
    },
    onError: () => toast.error("Unable to revoke that session right now."),
  });

  const { mutate: revokeOthers } = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => {
      toast.success("Other sessions revoked.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.sessions() });
    },
    onError: () => toast.error("Unable to revoke other sessions right now."),
  });

  const { mutate: resetPw, isPending: resetPending } = useMutation({
    mutationFn: () => requestPasswordReset(profile!.email),
    onSuccess: () => toast.success("Password reset email sent."),
    onError: () => toast.error("Unable to send reset email right now."),
  });

  if (profileLoading) return <PageShell><PageSpinner /></PageShell>;

  if (profileError || !profile) {
    return (
      <PageShell>
        <div className="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
          Unable to load your profile right now.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        {/* Profile card */}
        <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate">My profile</p>
          <h1 className="mt-2 break-words text-[21px] font-semibold text-neon sm:text-[27px]">{profile.displayName}</h1>
          <div className="mt-6 space-y-3 text-sm text-ink">
            <div><span className="text-slate">Email: </span><span className="font-semibold">{profile.email}</span></div>
            <div><span className="text-slate">Primary role: </span><span className="font-semibold">{profile.role}</span></div>
            {profile.roles?.length > 0 && (
              <div><span className="text-slate">All roles: </span><span className="font-semibold">{profile.roles.join(", ")}</span></div>
            )}
            <div><span className="text-slate">Status: </span><span className="font-semibold">{profile.status.replace("_", " ")}</span></div>
            <div><span className="text-slate">Created: </span><span className="font-semibold">{formatDate(profile.createdAt)}</span></div>
            <div>
              <span className="text-slate">Last login: </span>
              <span className="font-semibold">{profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "Never"}</span>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => resetPw()}
              disabled={resetPending}
              className="w-full rounded-[0.9rem] bg-neon px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] disabled:opacity-60 sm:w-auto"
            >
              Email me a reset link
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200 sm:w-auto"
            >
              Sign out
            </button>
          </div>
          <p className="mt-4 rounded-2xl bg-[#fff7e8] px-4 py-3 text-sm text-[#9a6408]">
            Manage your sessions and account security from here.
          </p>
        </div>

        {/* Sessions card */}
        <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Session management</p>
              <h2 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">Devices and active sessions</h2>
            </div>
            <button
              type="button"
              onClick={() => revokeOthers()}
              className="w-full rounded-[0.9rem] border border-ink/20 px-5 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200 sm:w-auto"
            >
              Revoke other sessions
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {sessionsLoading && <p className="text-sm text-slate">Loading sessions…</p>}
            {!sessionsLoading && (!sessions || sessions.length === 0) && (
              <p className="text-sm text-slate">No active sessions found.</p>
            )}
            {!sessionsLoading && sessions && sessions.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {entry.current ? "Current session" : "Active session"}
                    </p>
                    <p className="mt-1 text-xs text-slate">Started {formatDate(entry.createdAt)}</p>
                    <p className="mt-1 text-xs text-slate">Expires {formatDate(entry.expiresAt)}</p>
                  </div>
                  {entry.current ? (
                    <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink">
                      This browser
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revoke(entry.id)}
                      className="rounded-[0.9rem] border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition duration-200"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  );
}
