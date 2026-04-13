import { canAccessDocumentVisibility, type DocumentVisibility } from "./security-logic.js";
import type { AuthContext } from "./server-types.js";
import type { StoredItem } from "./item-read-model.js";
import { canViewItemOperationsWithRole, canViewReserveWithRole } from "../shared/permissions.js";

type ListUsersWithRolesResult = Array<{
  id: string;
  email: string;
  displayName: string;
  status: "pending_verification" | "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
  roles: string[];
}>;

export const formatProcessUptime = (uptimeSeconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(uptimeSeconds / 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const getReserveState = (item: { reserve?: number; endTime: string; currentBid: number }) => {
  if (item.reserve == null || item.reserve <= 0) return "no_reserve";
  if (new Date(item.endTime).getTime() > Date.now()) {
    return item.currentBid >= item.reserve ? "reserve_met" : "reserve_pending";
  }
  return item.currentBid >= item.reserve ? "reserve_met" : "reserve_not_met";
};

export const isUserWinningItem = (auth: AuthContext, item: StoredItem) => {
  if (!auth.userId) return false;
  if (new Date(item.endTime).getTime() > Date.now()) return false;
  if (item.currentBid <= 0) return false;
  const matchingBid = item.bids.find((bid) => bid.bidderUserId === auth.userId);
  return Boolean(matchingBid && matchingBid.amount === item.currentBid);
};

export const canAccessItemDocument = (auth: AuthContext, item: StoredItem, visibility: DocumentVisibility) =>
  canAccessDocumentVisibility({
    signedIn: auth.signedIn,
    adminAuthorized: auth.adminAuthorized,
    role: auth.role,
    itemArchived: Boolean(item.archivedAt),
    itemEnded: new Date(item.endTime).getTime() <= Date.now(),
    reserveState: getReserveState(item),
    isWinner: isUserWinningItem(auth, item),
  }, visibility);

export const sanitizeItemForAuth = (item: StoredItem, auth: AuthContext): StoredItem => ({
  ...item,
  reserve: canViewReserveWithRole(auth.role) ? item.reserve : undefined,
  bids: item.bids.map((bid) => ({
    ...bid,
    bidder: canViewItemOperationsWithRole(auth.role) || auth.adminAuthorized ? bid.bidder : "Anonymous bidder",
    bidderUserId: canViewItemOperationsWithRole(auth.role) || auth.adminAuthorized ? bid.bidderUserId : undefined,
  })),
  documents: item.documents.filter((document) => canAccessItemDocument(auth, item, document.visibility || "bidder_visible")),
});

export const getLandingStats = async ({
  getItems,
  listUsersWithRoles,
}: {
  getItems: (includeArchived?: boolean) => Promise<StoredItem[]>;
  listUsersWithRoles: () => Promise<ListUsersWithRolesResult>;
}) => {
  const items = await getItems();
  const users = await listUsersWithRoles();
  const now = Date.now();

  const activeLots = items.filter((item) => {
    if (item.archivedAt) return false;
    return new Date(item.endTime).getTime() > now;
  }).length;

  const verifiedBidders = users.filter(
    (user) => user.status === "active" && user.roles.includes("Bidder")
  ).length;

  return {
    activeLots,
    verifiedBidders,
    accountUptime: formatProcessUptime(process.uptime()),
  };
};
