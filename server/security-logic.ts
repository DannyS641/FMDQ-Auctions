import { createHmac } from "crypto";

export type DocumentVisibility = "bidder_visible" | "admin_only" | "winner_only";
export type NotificationMeta = {
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
};

export type DocumentAccessContext = {
  signedIn: boolean;
  adminAuthorized: boolean;
  role: "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin";
  itemArchived: boolean;
  itemEnded: boolean;
  reserveState: "no_reserve" | "reserve_pending" | "reserve_met" | "reserve_not_met";
  isWinner: boolean;
};

const documentVisibilityPrefix = "vis:";

export const buildCsrfTokenValue = (secret: string, sessionId: string) =>
  createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");

export const isProductionLike = (nodeEnv: string | undefined) =>
  (nodeEnv || "").toLowerCase() === "production";

export const validateMalwareScanConfiguration = (nodeEnv: string | undefined, mode: string, command: string) => {
  if (!isProductionLike(nodeEnv)) return { ok: true as const };
  if (mode !== "command" || !command.trim()) {
    return {
      ok: false as const,
      error: "MALWARE_SCAN_MODE=command and MALWARE_SCAN_COMMAND are required outside development."
    };
  }
  return { ok: true as const };
};

export const encodeDocumentNameWithVisibility = (name: string, visibility: DocumentVisibility) =>
  `${documentVisibilityPrefix}${visibility}::${name}`;

export const parseDocumentNameWithVisibility = (storedName: string) => {
  if (!storedName.startsWith(documentVisibilityPrefix)) {
    return {
      displayName: storedName,
      visibility: "bidder_visible" as DocumentVisibility
    };
  }
  const suffix = storedName.slice(documentVisibilityPrefix.length);
  const splitAt = suffix.indexOf("::");
  if (splitAt <= 0) {
    return {
      displayName: storedName,
      visibility: "bidder_visible" as DocumentVisibility
    };
  }
  const rawVisibility = suffix.slice(0, splitAt) as DocumentVisibility;
  const displayName = suffix.slice(splitAt + 2) || storedName;
  if (!["bidder_visible", "admin_only", "winner_only"].includes(rawVisibility)) {
    return {
      displayName: storedName,
      visibility: "bidder_visible" as DocumentVisibility
    };
  }
  return {
    displayName,
    visibility: rawVisibility
  };
};

export const canAccessDocumentVisibility = (context: DocumentAccessContext, visibility: DocumentVisibility) => {
  if (!context.signedIn) return false;
  if (context.adminAuthorized) return true;
  if (context.itemArchived) return false;
  if (visibility === "admin_only") return false;
  if (visibility === "bidder_visible") {
    return (context.role === "Bidder" && !context.itemEnded) || context.role === "ShopOwner";
  }
  if (visibility === "winner_only") {
    return context.role === "Bidder" && context.itemEnded && context.isWinner && context.reserveState !== "reserve_not_met";
  }
  return false;
};

export const ensureCanManageTargetRoles = (
  actorRole: "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin",
  targetRoles: string[]
) => {
  if (actorRole !== "Admin" && actorRole !== "SuperAdmin") {
    return { ok: false as const, error: "Only admin accounts can manage other users." };
  }
  if (targetRoles.includes("SuperAdmin") && actorRole !== "SuperAdmin") {
    return { ok: false as const, error: "Only a SuperAdmin can manage another SuperAdmin account." };
  }
  if (targetRoles.includes("Admin") && actorRole !== "SuperAdmin") {
    return { ok: false as const, error: "Only a SuperAdmin can manage another Admin account." };
  }
  return { ok: true as const };
};

export const validateBidAmount = (
  item: { startBid: number; currentBid: number; increment: number; startTime: string; endTime: string },
  amount: number,
  nowMs: number
) => {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, error: "Invalid bid amount." };
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (nowMs < start || nowMs > end) return { ok: false as const, error: "Bidding is closed or not yet open for this item." };
  const requiredBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;
  if (amount < requiredBid) return { ok: false as const, error: `Bid must be at least ${requiredBid}.` };
  if ((amount - requiredBid) % item.increment !== 0) return { ok: false as const, error: `Bid must increase by ${item.increment}.` };
  return { ok: true as const };
};

export const validateArchiveEntries = (entries: string[], maxEntries: number) => {
  if (!entries.length) {
    throw new Error("The ZIP bundle is empty.");
  }
  if (entries.length > maxEntries) {
    throw new Error(`The ZIP bundle contains too many files. Maximum allowed is ${maxEntries}.`);
  }
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.includes("../")) {
      throw new Error(`The ZIP bundle contains an unsafe path: ${entry}`);
    }
  }
};

export const buildNotificationMeta = (
  current: Partial<NotificationMeta> | null | undefined,
  errorMessage: string,
  now: Date,
  maxAttempts: number
) => {
  const attempts = Number(current?.attempts || 0) + 1;
  const retryDelayMs = Math.min(30 * 60_000, Math.max(60_000, attempts * 60_000));
  const exhausted = attempts >= maxAttempts;
  return {
    exhausted,
    nextStatus: exhausted ? "failed" as const : "pending" as const,
    meta: {
      attempts,
      lastError: errorMessage,
      nextAttemptAt: exhausted ? undefined : new Date(now.getTime() + retryDelayMs).toISOString()
    }
  };
};

export const shouldProcessNotificationNow = (current: Partial<NotificationMeta> | null | undefined, now: Date) => {
  if (!current?.nextAttemptAt) return true;
  const nextAttemptAtMs = Date.parse(current.nextAttemptAt);
  if (Number.isNaN(nextAttemptAtMs)) return true;
  return nextAttemptAtMs <= now.getTime();
};
