import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { BidForm } from "@/components/auction/BidForm";
import { CountdownDisplay } from "@/components/auction/CountdownDisplay";
import { useAuctionItem } from "@/hooks/use-auction-items";
import { useAuth } from "@/context/auth-context";
import { exportItemsCsv } from "@/api/items";
import { formatMoney, formatDate } from "@/lib/formatters";
import { getAuctionStatus, getReserveOutcome } from "@/lib/auction-utils";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const BID_HISTORY_PAGE_SIZE = 5;

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { canViewReserve, isAdmin, isShopOwner } = useAuth();
  const { data: item, isLoading, isError } = useAuctionItem(id ?? null);
  const [bidHistoryPage, setBidHistoryPage] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const images = Array.isArray(item?.images) ? item.images : [];
  const documents = Array.isArray(item?.documents) ? item.documents : [];
  const bids = Array.isArray(item?.bids) ? item.bids : [];
  const mainImage = images[activeImageIndex];
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

  const handleExportAuctionDetails = async () => {
    try {
      const blob = await exportItemsCsv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `auction-details-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Auction details exported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export auction details.");
    }
  };

  useEffect(() => {
    setActiveImageIndex(0);
  }, [id]);

  useEffect(() => {
    if (activeImageIndex >= images.length) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, images.length]);

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
                <div className="relative flex aspect-[4/3] w-full max-w-[42rem] items-center justify-center overflow-hidden rounded-[2rem] border border-ink/10 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
                  <img
                    src={`${API_BASE}${mainImage.url}`}
                    alt={mainImage.name}
                    className="h-full w-full object-contain"
                  />
                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveImageIndex((current) => (current === 0 ? images.length - 1 : current - 1))}
                        className="absolute left-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-neon shadow-[0_10px_24px_rgba(15,23,42,0.14)] transition hover:bg-white"
                        aria-label="Previous image"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveImageIndex((current) => (current === images.length - 1 ? 0 : current + 1))}
                        className="absolute right-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-neon shadow-[0_10px_24px_rgba(15,23,42,0.14)] transition hover:bg-white"
                        aria-label="Next image"
                      >
                        <ChevronRight size={18} />
                      </button>
                      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/85 px-3 py-2 backdrop-blur-sm">
                        {images.map((img, index) => (
                          <button
                            key={`${img.url}-${index}`}
                            type="button"
                            onClick={() => setActiveImageIndex(index)}
                            className={`h-2.5 w-2.5 rounded-full transition ${
                              index === activeImageIndex ? "bg-neon" : "bg-ink/20 hover:bg-ink/35"
                            }`}
                            aria-label={`View image ${index + 1}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {images.length > 1 && (
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {images.map((img, index) => (
                      <button
                        key={`${img.url}-${index}`}
                        type="button"
                        onClick={() => setActiveImageIndex(index)}
                        className={`flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white p-2 transition ${
                          index === activeImageIndex
                            ? "border-neon shadow-[0_10px_24px_rgba(29,50,108,0.12)]"
                            : "border-ink/10 hover:border-neon/40"
                        }`}
                        aria-label={`Open image ${index + 1}`}
                      >
                        <img src={`${API_BASE}${img.url}`} alt={img.name} className="h-full w-full object-contain" />
                      </button>
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
            {isShopOwner && (
              <button
                type="button"
                onClick={() => void handleExportAuctionDetails()}
                className="mt-5 inline-flex rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200"
              >
                Export auction details
              </button>
            )}
          </div>

          {!isShopOwner && (
            <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Place bid</p>
              <div className="mt-4">
                <BidForm item={item} />
              </div>
            </div>
          )}

          {/* Bid history */}
          <div className="rounded-3xl border border-ink/10 bg-white p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">{isShopOwner ? "User bid history" : "Bid history"}</p>
            <div className="mt-4 space-y-3">
              {bids.length === 0 ? (
                <p className="text-sm text-slate">No bids recorded yet.</p>
              ) : (
                visibleBids.map((bid, i) => (
                    <div key={i} className="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/5 px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{isShopOwner || isAdmin ? bid.bidder : "Anonymous bidder"}</div>
                        <div className="text-xs text-slate">{formatDate(bid.time || bid.createdAt || "")}</div>
                      </div>
                      <span className="pl-4 font-semibold">{formatMoney(bid.amount)}</span>
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
