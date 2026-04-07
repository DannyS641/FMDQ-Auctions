import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageSpinner } from "@/components/ui/Spinner";
import { BidForm } from "@/components/auction/BidForm";
import { CountdownDisplay } from "@/components/auction/CountdownDisplay";
import { useAuctionItem } from "@/hooks/use-auction-items";
import { useAuth } from "@/context/auth-context";
import { formatMoney, formatDate } from "@/lib/formatters";
import { getAuctionStatus, getReserveOutcome } from "@/lib/auction-utils";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { canViewReserve, isAdmin, role } = useAuth();
  const { data: item, isLoading, isError } = useAuctionItem(id ?? null);

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
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Item not available</h1>
          <p className="mt-3 text-sm text-slate">Unable to load item details. The item may no longer exist.</p>
          <Link to="/bidding" className="mt-5 inline-flex rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200">
            Back to auction desk
          </Link>
        </div>
      </PageShell>
    );
  }

  const status = getAuctionStatus(item);
  const mainImage = item.images[0];
  const extraImages = item.images.slice(1);

  return (
    <PageShell maxWidth="6xl">
      <div className="mb-6">
        <Link to="/bidding" className="inline-flex items-center gap-1 text-xs font-semibold text-slate hover:text-neon">
          <ChevronLeft size={14} />
          Back to auction desk
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left — item info, gallery, documents */}
        <section className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Lot {item.lot} · {item.category}</p>
            <h1 className="mt-2 break-words text-2xl font-semibold text-ink sm:text-3xl">{item.title}</h1>
            <p className="mt-3 text-sm text-slate">{item.description}</p>
          </div>

          {/* Gallery */}
          <div className="space-y-4">
            {mainImage ? (
              <>
                <div className="flex min-h-[28rem] items-center justify-center overflow-hidden rounded-[2rem] border border-ink/10 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.08)] lg:min-h-[36rem]">
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
              <div className="h-[28rem] rounded-[2rem] border border-ink/10 bg-ink/5 lg:h-[36rem]" />
            )}
          </div>

          {/* Documents */}
          {item.documents.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate">Documents</p>
              <div className="mt-4 space-y-3">
                {item.documents
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
              {item.bids.length === 0 ? (
                <p className="text-sm text-slate">No bids recorded yet.</p>
              ) : (
                [...item.bids]
                  .sort((a, b) => new Date(b.time ?? b.createdAt ?? 0).getTime() - new Date(a.time ?? a.createdAt ?? 0).getTime())
                  .map((bid, i) => (
                    <div key={i} className="flex items-center justify-between rounded-2xl border border-ink/10 bg-ink/5 px-4 py-2 text-sm">
                      <span>Anonymous bidder</span>
                      <span className="font-semibold">{formatMoney(bid.amount)}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
