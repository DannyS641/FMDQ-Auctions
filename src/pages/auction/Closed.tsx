import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuctionItems } from "@/hooks/use-auction-items";
import { getAuctionStatus, getReserveOutcome } from "@/lib/auction-utils";
import { formatMoney, formatDate } from "@/lib/formatters";
import { useAuth } from "@/context/auth-context";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function Closed() {
  useAuth();
  const { data: items, isLoading, isError } = useAuctionItems();

  const closed = useMemo(
    () => (items ?? [])
      .filter((item) => getAuctionStatus(item) === "Closed")
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()),
    [items]
  );

  if (isLoading) return <PageShell><PageSpinner /></PageShell>;

  return (
    <PageShell>
      <section>
        <p className="text-xs uppercase tracking-[0.3em] text-slate">Auction archive</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">Closed auctions</h1>
        <p className="mt-3 text-sm text-slate">
          {isError
            ? "Unable to load closed auctions right now."
            : `${closed.length} completed listing(s) available for review.`}
        </p>

        {isError && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            Unable to load closed auctions right now.
          </div>
        )}

        {!isError && closed.length === 0 && (
          <div className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 text-sm text-slate sm:p-8">
            No closed auctions are available yet.
          </div>
        )}

        {!isError && closed.length > 0 && (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {closed.map((item) => {
              const thumb = item.images[0]?.url;
              return (
                <article key={item.id} className="rounded-3xl border border-ink/10 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate">{item.category}</p>
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate" />
                      Closed
                    </span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-ink">{item.title}</h2>
                  <p className="mt-2 text-xs text-slate">Lot {item.lot} · {item.location}</p>

                  <div className="mt-4 flex h-64 items-center justify-center overflow-hidden rounded-3xl border border-ink/10 bg-white p-2">
                    {thumb ? (
                      <img src={`${API_BASE}${thumb}`} alt={item.title} className="h-full w-full object-contain" />
                    ) : (
                      <div className="h-full w-full rounded-3xl bg-ash" />
                    )}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate">Final bid</p>
                      <p className="mt-1 text-lg font-semibold text-ink">
                        {item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"}
                      </p>
                      <p className="mt-1 text-xs text-slate">{getReserveOutcome(item)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate">Ended</p>
                      <p className="mt-1 text-sm font-semibold text-ink">{formatDate(item.endTime)}</p>
                    </div>
                  </div>

                  <Link
                    to={`/bidding/${item.id}`}
                    className="mt-5 inline-flex rounded-[0.9rem] bg-neon px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] hover:bg-neon/90 transition duration-200"
                  >
                    Open details
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
