import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { getMyWins } from "@/api/items";
import { queryKeys } from "@/lib/query-keys";
import { useAuth } from "@/context/auth-context";
import { formatMoney, formatDate } from "@/lib/formatters";

export default function Won() {
  const { session } = useAuth();
  const { data: wins, isLoading, isError } = useQuery({
    queryKey: queryKeys.me.wins(),
    queryFn: getMyWins,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <PageShell><PageSpinner /></PageShell>;

  return (
    <PageShell>
      <section>
        <p className="text-xs uppercase tracking-[0.3em] text-slate">Bid outcomes</p>
        <h1 className="mt-2 text-[21px] font-semibold text-neon sm:text-[27px]">Won auctions</h1>
        <p className="mt-3 text-sm text-slate">
          {isError
            ? "Unable to load won auctions right now."
            : `${wins?.length ?? 0} closed listing(s) are currently attributed to ${session.displayName}.`}
        </p>

        {isError && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            Unable to load won auctions right now.
          </div>
        )}

        {!isError && (!wins || wins.length === 0) && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            No won auctions are assigned to this user yet.
          </div>
        )}

        {!isError && wins && wins.length > 0 && (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {wins.map((item) => (
              <article key={item.id} className="rounded-3xl border border-ink/10 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">{item.category}</p>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
                    <span className="h-2.5 w-2.5 rounded-full bg-gold" />
                    Won
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-ink">{item.title}</h2>
                <div className="mt-5 space-y-3 rounded-3xl border border-ink/10 bg-ink/5 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate">Winning bid</span>
                    <span className="font-semibold text-ink">{formatMoney(item.currentBid)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate">Auction ended</span>
                    <span className="font-semibold text-ink">{formatDate(item.endTime)}</span>
                  </div>
                </div>
                <Link
                  to={`/bidding/${item.id}`}
                  className="mt-5 inline-flex rounded-[0.9rem] bg-neon px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] hover:bg-neon/90 transition duration-200"
                >
                  Open details
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
