import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { getMyBids } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/context/auth-context";
import { formatMoney, formatDate } from "@/lib/formatters";

export default function MyBids() {
  const { session } = useAuth();
  const { data: bids, isLoading, isError } = useQuery({
    queryKey: queryKeys.me.bids(),
    queryFn: getMyBids,
    staleTime: 30_000,
  });

  if (isLoading) return <PageShell><PageSpinner /></PageShell>;

  return (
    <PageShell>
      <section>
        <p className="text-xs uppercase tracking-[0.3em] text-slate">Bidder workspace</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">My bids</h1>
        <p className="mt-3 text-sm text-slate">
          {isError
            ? "Unable to load bid history right now."
            : `${bids?.length ?? 0} auction listing(s) currently have bids from ${session.displayName}.`}
        </p>

        {isError && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            Unable to load your bids right now.
          </div>
        )}

        {!isError && (!bids || bids.length === 0) && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            No bid history is available for your account yet.{" "}
            <Link to="/bidding" className="font-semibold text-neon hover:underline">Browse auctions</Link>
          </div>
        )}

        {!isError && bids && bids.length > 0 && (
          <div className="mt-8 grid gap-4">
            {bids.map((entry) => (
              <article key={entry.itemId} className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate">{entry.category}</p>
                    <h2 className="mt-2 break-words text-xl font-semibold text-ink sm:text-2xl">{entry.title}</h2>
                    <p className="mt-2 text-sm text-slate">Lot {entry.lot}</p>
                  </div>
                  <span className="rounded-full border border-ink/10 bg-ink/5 px-3 py-1 text-xs font-semibold text-ink capitalize">
                    {entry.status}
                  </span>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate">Your latest bid</p>
                    <p className="mt-2 text-lg font-semibold text-ink">{formatMoney(entry.yourLatestBid)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate">Current bid</p>
                    <p className="mt-2 text-lg font-semibold text-ink">{formatMoney(entry.currentBid)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate">Last bid placed</p>
                    <p className="mt-2 text-sm font-semibold text-ink">{formatDate(entry.lastBidAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate">Auction end</p>
                    <p className="mt-2 text-sm font-semibold text-ink">{formatDate(entry.endTime)}</p>
                  </div>
                </div>
                <Link
                  to={`/bidding/${entry.itemId}`}
                  className="mt-6 inline-flex rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200"
                >
                  Open listing
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
