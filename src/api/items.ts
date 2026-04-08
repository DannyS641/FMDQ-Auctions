import { apiClient } from "@/lib/api-client";
import type { AuctionItem, DashboardPayload, UserBidRecord, WonItem, BulkImportReport, LandingStats } from "@/types";

export const getItems = async (includeArchived = false): Promise<AuctionItem[]> =>
  apiClient<AuctionItem[]>(`/api/items${includeArchived ? "?includeArchived=1" : ""}`);

export const getItem = async (id: string, includeArchived = false): Promise<AuctionItem> =>
  apiClient<AuctionItem>(`/api/items/${id}${includeArchived ? "?includeArchived=1" : ""}`);

export const getCategories = async (): Promise<string[]> =>
  apiClient<string[]>("/api/categories");

export const getLandingStats = async (): Promise<LandingStats> =>
  apiClient<LandingStats>("/api/landing-stats");

export const placeBid = async (
  itemId: string,
  amount: number,
  expectedCurrentBid: number
): Promise<AuctionItem> =>
  apiClient<AuctionItem>(`/api/items/${itemId}/bids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ amount, expectedCurrentBid }),
  });

export const getMyDashboard = async (): Promise<DashboardPayload> =>
  apiClient<DashboardPayload>("/api/me/dashboard");

export const getMyBids = async (): Promise<UserBidRecord[]> =>
  apiClient<UserBidRecord[]>("/api/me/bids");

export const getMyWins = async (): Promise<WonItem[]> =>
  apiClient<WonItem[]>("/api/me/wins");

// ─── Admin item mutations ──────────────────────────────────────────────────

export const createItem = async (formData: FormData): Promise<AuctionItem> =>
  apiClient<AuctionItem>("/api/items", { method: "POST", body: formData });

export const updateItem = async (id: string, formData: FormData): Promise<AuctionItem> =>
  apiClient<AuctionItem>(`/api/items/${id}`, { method: "PATCH", body: formData });

export const archiveItem = async (id: string): Promise<{ ok: boolean }> =>
  apiClient(`/api/items/${id}`, { method: "DELETE" });

export const restoreItem = async (id: string): Promise<AuctionItem> =>
  apiClient<AuctionItem>(`/api/items/${id}/restore`, { method: "POST" });

export const bulkImportItems = async (formData: FormData): Promise<BulkImportReport> =>
  apiClient<BulkImportReport>("/api/items/bulk-import", { method: "POST", body: formData });

export const createCategory = async (name: string): Promise<{ created: boolean }> =>
  apiClient("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

export const deleteCategory = async (name: string): Promise<{ ok: boolean }> =>
  apiClient(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
