import { useEffect, useState } from "react";
import { formatDuration, getAuctionStatus } from "@/lib";
import type { AuctionItem } from "@/types";

type CountdownState = {
  label: string;
  ms: number;
  status: "upcoming" | "live" | "closed";
};

export function useCountdown(item: AuctionItem): CountdownState {
  const getState = (): CountdownState => {
    const now = Date.now();
    const start = new Date(item.startTime).getTime();
    const end = new Date(item.endTime).getTime();

    if (now < start) {
      return {
        label: `Starts in ${formatDuration(start - now)}`,
        ms: start - now,
        status: "upcoming",
      };
    }
    if (now < end) {
      return {
        label: formatDuration(end - now),
        ms: end - now,
        status: "live",
      };
    }
    return { label: "Ended", ms: 0, status: "closed" };
  };

  const [state, setState] = useState<CountdownState>(getState);

  useEffect(() => {
    const status = getAuctionStatus(item);
    if (status === "Closed") {
      setState({ label: "Ended", ms: 0, status: "closed" });
      return;
    }

    const interval = setInterval(() => {
      setState(getState());
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.startTime, item.endTime]);

  return state;
}
