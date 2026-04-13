import type { AuctionItem, AuctionStatus, Role } from "@/types";
import { canBidWithRole } from "../../shared/permissions";

export const getAuctionStatus = (item: AuctionItem): AuctionStatus => {
  const now = Date.now();
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (now < start) return "Upcoming";
  if (now > end) return "Closed";
  return "Live";
};

export const getTimeRemainingMs = (endTime: string): number =>
  Math.max(0, new Date(endTime).getTime() - Date.now());

export const getTimeUntilStartMs = (startTime: string): number =>
  Math.max(0, new Date(startTime).getTime() - Date.now());

export const getReserveOutcome = (item: AuctionItem): string => {
  if (item.reserve == null) return "Reserve confidential";
  if (item.reserve <= 0) return "No reserve";
  const status = getAuctionStatus(item);
  if (status !== "Closed") {
    return item.currentBid >= item.reserve ? "Reserve met" : "Reserve pending";
  }
  return item.currentBid >= item.reserve ? "Reserve met" : "Reserve not met";
};

export const canBid = (
  item: AuctionItem,
  role: Role,
  signedIn: boolean
): { allowed: boolean; message: string } => {
  if (getAuctionStatus(item) !== "Live") {
    return { allowed: false, message: "Bidding is closed or not yet open for this item." };
  }
  if (!signedIn) {
    return { allowed: false, message: "Sign in to place a bid." };
  }
  if (!canBidWithRole(role)) {
    return { allowed: false, message: "Your account role does not allow bidding." };
  }
  return { allowed: true, message: "" };
};

export const getMinBid = (item: AuctionItem): number =>
  Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;

export const validateBidAmount = (
  item: AuctionItem,
  amount: number
): string | null => {
  const min = getMinBid(item);
  if (!Number.isFinite(amount) || amount <= 0) return "Invalid bid amount.";
  if (amount < min) return `Bid must be at least ${min}.`;
  if ((amount - min) % item.increment !== 0)
    return `Bid must increase by ${item.increment}.`;
  return null;
};
