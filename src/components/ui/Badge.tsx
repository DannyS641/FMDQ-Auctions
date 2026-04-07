import { cn } from "@/lib/cn";
import type { BidStatus, AuctionStatus } from "@/types";

type BadgeVariant = AuctionStatus | BidStatus | "pending" | "sent" | "failed" | "active" | "disabled" | "pending_verification";

const variantStyles: Record<string, string> = {
  // Auction status
  Live: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Upcoming: "bg-blue-100 text-blue-700 border-blue-200",
  Closed: "bg-slate/10 text-slate border-slate/20",
  // Bid status
  winning: "bg-emerald-100 text-emerald-700 border-emerald-200",
  won: "bg-gold/10 text-gold border-gold/20",
  outbid: "bg-red-100 text-red-600 border-red-200",
  lost: "bg-slate/10 text-slate border-slate/20",
  active: "bg-blue-100 text-blue-700 border-blue-200",
  closed: "bg-slate/10 text-slate border-slate/20",
  // Notification status
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  sent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-red-100 text-red-600 border-red-200",
  // User status
  disabled: "bg-red-100 text-red-600 border-red-200",
  pending_verification: "bg-amber-100 text-amber-700 border-amber-200",
};

type BadgeProps = {
  status: BadgeVariant;
  label?: string;
  className?: string;
};

export function Badge({ status, label, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
        variantStyles[status] ?? "bg-slate/10 text-slate border-slate/20",
        className
      )}
    >
      {label ?? status}
    </span>
  );
}
