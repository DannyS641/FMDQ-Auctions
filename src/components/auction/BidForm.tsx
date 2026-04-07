import { useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "@/lib/formatters";
import { getMinBid, canBid as canBidCheck } from "@/lib/auction-utils";
import { usePlaceBid } from "@/hooks/use-place-bid";
import { useAuth } from "@/context/auth-context";
import type { AuctionItem } from "@/types";

type Props = {
  item: AuctionItem;
};

export function BidForm({ item }: Props) {
  const { isSignedIn, role } = useAuth();
  const { mutate, isPending } = usePlaceBid();
  const [bidAmount, setBidAmount] = useState<number>(() => getMinBid(item));
  const [hint, setHint] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const minBid = getMinBid(item);
  const { allowed, message } = canBidCheck(item, role, isSignedIn);

  const handleStep = () => {
    setBidAmount((prev) => (prev >= minBid ? prev + item.increment : minBid));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowed) { setHint(message); return; }
    if (!bidAmount || bidAmount < minBid) {
      setHint(`Bid must be at least ${formatMoney(minBid)}.`);
      return;
    }
    if ((bidAmount - minBid) % item.increment !== 0) {
      setHint(`Bids must increase by ${formatMoney(item.increment)}.`);
      return;
    }
    if (!confirmed) {
      setConfirmed(true);
      setHint(`Confirm bid of ${formatMoney(bidAmount)}? Click Place bid to confirm.`);
      return;
    }
    setHint("Submitting bid…");
    mutate(
      { itemId: item.id, amount: bidAmount, expectedCurrentBid: item.currentBid },
      {
        onSuccess: () => {
          setBidAmount(getMinBid(item));
          setConfirmed(false);
          setHint("");
        },
        onError: (err) => {
          setConfirmed(false);
          setHint(err instanceof Error ? err.message : "Bid failed. Please try again.");
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="number"
          value={bidAmount || ""}
          min={minBid}
          step={item.increment}
          onChange={(e) => { setBidAmount(Number(e.target.value)); setConfirmed(false); setHint(""); }}
          placeholder={formatMoney(item.currentBid || item.startBid)}
          className="no-spin w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon disabled:opacity-50"
          disabled={!allowed}
        />
        <button
          type="button"
          onClick={handleStep}
          disabled={!allowed}
          className="rounded-[0.9rem] border border-ink/20 px-4 py-3 text-sm font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200 disabled:opacity-50"
          aria-label="Increase bid"
        >
          ▲
        </button>
      </div>
      <button
        type="submit"
        disabled={!allowed || isPending}
        className="w-full rounded-[0.9rem] bg-neon px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] transition duration-200 hover:bg-neon/90 disabled:opacity-60"
      >
        {isPending ? "Submitting…" : confirmed ? "Place bid" : "Review bid"}
      </button>
      {!isSignedIn && (
        <Link
          to="/signin"
          className="block w-full rounded-[0.9rem] border border-ink/20 px-5 py-3 text-center text-sm font-semibold text-ink hover:bg-[#eef3ff] hover:text-neon transition duration-200"
        >
          Sign in to bid
        </Link>
      )}
      {hint && <p className="text-xs text-slate">{hint}</p>}
      {!hint && (
        <p className="text-xs text-slate">
          Minimum: <span className="font-semibold text-ink">{formatMoney(minBid)}</span>
          {" · "}Increment: <span className="font-semibold text-ink">{formatMoney(item.increment)}</span>
        </p>
      )}
    </form>
  );
}
