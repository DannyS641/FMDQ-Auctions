import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Gavel, Trophy, Activity, ListChecks, CheckCircle2, XCircle } from "lucide-react";
import { buttonHover } from "@/lib/motion";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { PageHeaderCard } from "@/components/ui/PageHeaderCard";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { getMyDashboard } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/context/auth-context";
import { formatMoney, formatDate } from "@/lib/formatters";

export default function Dashboard() {
  const { session } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.me.dashboard(),
    queryFn: getMyDashboard,
    staleTime: 60_000,
  });

  if (isLoading) return <PageShell><PageSpinner /></PageShell>;

  if (isError || !data) {
    return (
      <PageShell>
        <div className="rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
          <p className="font-semibold text-ink">Unable to load your dashboard right now.</p>
          <p className="mt-3">Please refresh the page or try again in a moment.</p>
          <motion.button
            type="button"
            onClick={() => void refetch()}
            {...buttonHover}
            className="mt-6 rounded-none bg-neon px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)]"
          >
            Try again
          </motion.button>
        </div>
      </PageShell>
    );
  }

  const { summary, recentBidActivity } = data;

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <PageHeaderCard
          title={`Welcome, ${session.displayName}`}
          subtitle="Track active bids, wins, reserve outcomes, and recent activity from one view."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatTile icon={<Gavel size={18} />} accent="neon" label="Open bid positions" value={summary.openBidCount} />
            <StatTile icon={<Trophy size={18} />} accent="gold" label="Won auctions" value={summary.wonAuctionCount} />
            <StatTile icon={<Activity size={18} />} accent="violet" label="Active sessions" value={summary.activeSessionCount} />
            <StatTile icon={<ListChecks size={18} />} accent="tide" label="My bid records" value={summary.totalBidCount} />
            <StatTile icon={<CheckCircle2 size={18} />} accent="emerald" label="Closed reserve met" value={summary.reserveMetClosedCount} />
            <StatTile icon={<XCircle size={18} />} accent="rose" label="Closed reserve not met" value={summary.reserveNotMetClosedCount} />
          </div>
        </PageHeaderCard>

        {/* Recent activity */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Recent activity</p>
              <h2 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">My latest bid positions</h2>
            </div>
            <Link to="/my-bids" className="text-xs font-semibold text-neon hover:underline">View all</Link>
          </div>
          <div className="mt-6 grid gap-4">
            {recentBidActivity.length === 0 ? (
              <p className="text-sm text-slate">No bid activity yet.</p>
            ) : (
              recentBidActivity.map((entry) => (
                <article key={entry.itemId} className="rounded-2xl border border-ink/10 bg-ink/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-ink">{entry.title}</p>
                      <p className="mt-1 text-xs text-slate">{entry.category}</p>
                    </div>
                    <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink capitalize">
                      {entry.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                    <p className="text-slate">Your bid <span className="font-semibold text-ink">{formatMoney(entry.yourLatestBid)}</span></p>
                    <p className="text-slate">Current bid <span className="font-semibold text-ink">{formatMoney(entry.currentBid)}</span></p>
                    <p className="text-slate">Ends <span className="font-semibold text-ink">{formatDate(entry.endTime)}</span></p>
                  </div>
                </article>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
