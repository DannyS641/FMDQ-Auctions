import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { BidForm } from "@/components/auction/BidForm";
import { CountdownDisplay } from "@/components/auction/CountdownDisplay";
import { useAuctionItem } from "@/hooks/use-auction-items";
import { useAuth } from "@/context/auth-context";
import { formatMoney, formatDate } from "@/lib/formatters";
import { getAuctionStatus, getReserveOutcome } from "@/lib/auction-utils";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const BID_HISTORY_PAGE_SIZE = 5;

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { canViewReserve, isAdmin } = useAuth();
  const { data: item, isLoading, isError } = useAuctionItem(id ?? null);
  const [bidHistoryPage, setBidHistoryPage] = useState(1);
  const images = Array.isArray(item?.images) ? item.images : [];
  const documents = Array.isArray(item?.documents) ? item.documents : [];
  const bids = Array.isArray(item?.bids) ? item.bids : [];
  const mainImage = images[0];
  const extraImages = images.slice(1);
  const sortedBids = useMemo(
    () =>
      [...bids].sort(
        (a, b) => new Date(b.time ?? b.createdAt ?? 0).getTime() - new Date(a.time ?? a.createdAt ?? 0).getTime()
      ),
    [bids]
  );
  const totalBidPages = Math.max(1, Math.ceil(sortedBids.length / BID_HISTORY_PAGE_SIZE));
  const visibleBids = useMemo(() => {
    const start = (bidHistoryPage - 1) * BID_HISTORY_PAGE_SIZE;
    return sortedBids.slice(start, start + BID_HISTORY_PAGE_SIZE);
  }, [bidHistoryPage, sortedBids]);

  if (isLoading) {
    return (
      <PageShell maxWidth="6xl">
        <PageSpinner />
      </PageShell>
    );
  }

  if (isError || !item) {
    return (
      <PageShell maxWidth="6xl">
        <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-8">
          <h1 className="text-[17px] font-semibold text-neon sm:text-[21px]">Item not available</h1>
          <p className="mt-3 text-sm text-slate">Unable to load item details. The item may no longer exist.</p>
          <Link to="/bidding" className="mt-5 inline-flex rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200">
            Back to auction desk
          </Link>
        </div>
      </PageShell>
    );
  }

  const status = getAuctionStatus(item);

  return (
    <PageShell maxWidth="6xl">
      <div className="mb-6">
        <Link to="/bidding" className="inline-flex items-center gap-1 text-xs font-semibold text-slate hover:text-neon">
          <ChevronLeft size={14} />
          Back to auction desk
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        {/* Left — item info, gallery, documents */}
        <section className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Lot {item.lot || "—"} · {item.category || "Uncategorized"}</p>
            <h1 className="mt-2 break-words text-[21px] font-semibold text-neon sm:text-[27px]">{item.title || "Untitled item"}</h1>
            <p className="mt-3 text-sm text-slate">{item.description || "No description available for this item."}</p>
          </div>

          {/* Gallery */}
          <div className="space-y-4">
            {mainImage ? (
              <>
                <div className="flex aspect-[4/3] w-full max-w-[42rem] items-center justify-center overflow-hidden rounded-[2rem] border border-ink/10 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
                  <img
                    src={`${API_BASE}${mainImage.url}`}
                    alt={mainImage.name}
                    className="h-full w-full object-contain"
                  />
                </div>
                {extraImages.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {extraImages.map((img, i) => (
                      <div key={i} className="flex h-44 items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-white p-2">
                        <img src={`${API_BASE}${img.url}`} alt={img.name} className="h-full w-full object-contain" />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="aspect-[4/3] w-full max-w-[42rem] rounded-[2rem] border border-ink/10 bg-ink/5" />
            )}
          </div>

          {/* Documents */}
          {documents.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Documents</p>
              <div className="mt-4 space-y-3">
                {documents
                  .filter((d) => !d.visibility || d.visibility === "bidder_visible")
                  .map((doc, i) => (
                    <a
                      key={i}
                      href={`${API_BASE}${doc.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink hover:border-neon/30 hover:bg-[#eef3ff] hover:text-neon transition duration-200"
                    >
                      <span>{doc.name}</span>
                      <span className="text-xs text-slate">Download</span>
                    </a>
                  ))}
              </div>
            </div>
          )}
        </section>

        {/* Right — details, bid, history */}
        <aside className="space-y-6">
          {/* Auction details */}
          <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Auction details</p>
            <div className="mt-4 space-y-3 text-sm text-ink">
              {[
                { label: "Status", value: status },
                { label: "Current bid", value: item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids" },
                { label: "Start bid", value: formatMoney(item.startBid) },
                {
                  label: "Reserve",
                  value: item.reserve != null && item.reserve > 0
                    ? (canViewReserve ? formatMoney(item.reserve) : "Confidential")
                    : "No reserve",
                },
                {
                  label: "Reserve status",
                  value: getReserveOutcome(item),
                },
                { label: "Bid increment", value: formatMoney(item.increment) },
                { label: "Condition", value: item.condition },
                { label: "Location", value: item.location },
                { label: "Start", value: formatDate(item.startTime) },
                { label: "End", value: formatDate(item.endTime) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-slate">{label}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>

            {/* Countdown */}
            {status !== "Closed" && (
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink/5 px-4 py-3 text-sm">
                <span className="text-slate">{status === "Upcoming" ? "Opens in" : "Time remaining"}</span>
                <CountdownDisplay item={item} className="font-semibold text-ink" />
              </div>
            )}

            {isAdmin && (
              <Link
                to={`/admin/items/${item.id}`}
                className="mt-5 inline-flex rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200"
              >
                Edit item
              </Link>
            )}
          </div>

          {/* Bid form */}
          <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Place bid</p>
            <div className="mt-4">
              <BidForm item={item} />
            </div>
          </div>

          {/* Bid history */}
          <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Bid history</p>
            <div className="mt-4 space-y-3">
              {bids.length === 0 ? (
                <p className="text-sm text-slate">No bids recorded yet.</p>
              ) : (
                visibleBids.map((bid, i) => (
                    <div key={i} className="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/5 px-4 py-2 text-sm">
                      <span>Anonymous bidder</span>
                      <span className="font-semibold">{formatMoney(bid.amount)}</span>
                    </div>
                  ))
              )}
            </div>
            {sortedBids.length > BID_HISTORY_PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-slate">
                  Page {bidHistoryPage} of {totalBidPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bidHistoryPage === 1}
                    onClick={() => setBidHistoryPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bidHistoryPage === totalBidPages}
                    onClick={() => setBidHistoryPage((current) => Math.min(totalBidPages, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
