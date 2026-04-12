export type BidStatus = "winning" | "outbid" | "won" | "lost" | "active" | "closed";

export type AuctionStatus = "Upcoming" | "Live" | "Closed";

export type DocumentVisibility = "bidder_visible" | "admin_only" | "winner_only";

export type FileRef = {
  name: string;
  url: string;
  visibility?: DocumentVisibility;
};

export type Bid = {
  bidder: string;
  bidderUserId?: string;
  amount: number;
  time: string;
  createdAt?: string;
};

export type AuctionItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  startBid: number;
  reserve?: number; // only present for admins — server strips this for bidders
  increment: number;
  currentBid: number;
  startTime: string;
  endTime: string;
  description: string;
  images: FileRef[];
  documents: FileRef[];
  bids: Bid[];
  archivedAt?: string | null;
};

export type UserBidRecord = {
  itemId: string;
  title: string;
  category: string;
  lot: string;
  currentBid: number;
  yourLatestBid: number;
  endTime: string;
  lastBidAt: string;
  status: BidStatus;
};

export type WonItem = {
  id: string;
  title: string;
  category: string;
  currentBid: number;
  endTime: string;
};

export type DashboardSummary = {
  openBidCount: number;
  wonAuctionCount: number;
  activeSessionCount: number;
  totalBidCount: number;
  reserveMetClosedCount: number;
  reserveNotMetClosedCount: number;
};

export type DashboardBidActivity = {
  itemId: string;
  title: string;
  category: string;
  currentBid: number;
  yourLatestBid: number;
  endTime: string;
  status: BidStatus;
};

export type DashboardPayload = {
  summary: DashboardSummary;
  recentBidActivity: DashboardBidActivity[];
};

export type BulkImportReportItem = {
  row: number;
  status: "created" | "skipped" | "failed";
  email?: string;
  title?: string;
  itemId?: string;
  message: string;
};

export type BulkImportReport = {
  created: number;
  skipped: number;
  failed: number;
  items: BulkImportReportItem[];
};

export type LandingStats = {
  activeLots: number;
  verifiedBidders: number;
  accountUptime: string;
};
