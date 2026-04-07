import { useState, useEffect } from "react";
import { formatDuration } from "@/lib/formatters";
import { getAuctionStatus, getTimeRemainingMs, getTimeUntilStartMs } from "@/lib/auction-utils";
import type { AuctionItem } from "@/types";

type Props = {
  item: AuctionItem;
  className?: string;
};

export function CountdownDisplay({ item, className }: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const status = getAuctionStatus(item);

  if (status === "Closed") {
    return <span className={className}>Ended</span>;
  }

  if (status === "Upcoming") {
    const ms = getTimeUntilStartMs(item.startTime);
    return (
      <span className={className}>
        Starts in {formatDuration(ms)}
      </span>
    );
  }

  const ms = getTimeRemainingMs(item.endTime);
  const isUrgent = ms < 5 * 60 * 1000; // under 5 minutes

  return (
    <span className={isUrgent ? `text-red-600 font-semibold ${className ?? ""}` : className}>
      {formatDuration(ms)}
    </span>
  );
}
