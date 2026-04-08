import { Link } from "react-router-dom";
import { formatMoney } from "@/lib/formatters";
import { getAuctionStatus } from "@/lib/auction-utils";
import { CountdownDisplay } from "./CountdownDisplay";
import type { AuctionItem } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const statusDot: Record<string, string> = {
  Live: "bg-emerald-500",
  Upcoming: "bg-blue-500",
  Closed: "bg-slate",
};

type Props = {
  item: AuctionItem;
  onMouseEnter?: () => void;
};

export function AuctionCard({ item, onMouseEnter }: Props) {
  const status = getAuctionStatus(item);
  const thumb = item.images[0]?.url;

  return (
    <article
      onMouseEnter={onMouseEnter}
      className="rounded-3xl border border-ink/10 bg-white p-5 transition duration-200 hover:border-neon/20 hover:shadow-[0_8px_30px_rgba(29,50,108,0.1)]"
    >
      {/* Image */}
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border border-ink/10 bg-white p-2">
        {thumb ? (
          <img
            src={`${API_BASE}${thumb}`}
            alt={item.title}
            className="h-full w-full rounded-xl object-contain"
          />
        ) : (
          <div className="h-full w-full rounded-xl bg-ash" />
        )}
      </div>

      {/* Header */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-slate">{item.category}</p>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span className={`h-2 w-2 rounded-full ${statusDot[status] ?? "bg-slate"}`} />
          {status}
        </span>
      </div>

      <h2 className="mt-2 line-clamp-2 text-base font-semibold text-ink">{item.title}</h2>
      <p className="mt-1 text-xs text-slate">Lot {item.lot} · {item.condition}</p>

      {/* Stats */}
      <div className="mt-4 space-y-2 rounded-2xl border border-ink/10 bg-ink/5 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate">Current bid</span>
          <span className="font-semibold text-ink">
            {item.currentBid > 0 ? formatMoney(item.currentBid) : "No bids"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate">{status === "Upcoming" ? "Opens in" : status === "Live" ? "Closes in" : "Ended"}</span>
          <CountdownDisplay item={item} className="font-semibold text-ink text-xs" />
        </div>
      </div>

      <Link
        to={`/bidding/${item.id}`}
        className="mt-4 inline-flex w-full items-center justify-center rounded-[0.9rem] border border-ink/20 px-4 py-2 text-xs font-semibold text-ink transition duration-200 hover:bg-[#eef3ff] hover:text-neon"
      >
        View item
      </Link>
    </article>
  );
}
