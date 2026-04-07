import { formatMoney, formatTimeAgo } from "@/lib/formatters";
import type { Bid } from "@/types";

type Props = {
  bids: Bid[];
};

export function BidHistory({ bids }: Props) {
  if (bids.length === 0) {
    return <p className="text-sm text-slate">No bids placed yet.</p>;
  }

  const sorted = [...bids].sort(
    (a, b) => new Date(b.time ?? b.createdAt ?? 0).getTime() - new Date(a.time ?? a.createdAt ?? 0).getTime()
  );

  return (
    <div className="flex flex-col divide-y divide-ink/5">
      {sorted.map((bid, i) => (
        <div key={i} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{bid.bidder}</p>
            <p className="text-xs text-slate">
              {formatTimeAgo(bid.time ?? bid.createdAt ?? "")}
            </p>
          </div>
          <p className="text-sm font-bold text-ink">{formatMoney(bid.amount)}</p>
        </div>
      ))}
    </div>
  );
}
