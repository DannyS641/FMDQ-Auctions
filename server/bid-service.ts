import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { validateBidAmount } from "./security-logic.js";
import type { AuditRow, UserRow } from "./server-types.js";
import type { StoredItem } from "./item-read-model.js";

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;

type CreateBidServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  parseAuditDetails: (value: Record<string, unknown> | string | null | undefined) => Record<string, unknown>;
  sessionTtlMs: number;
  appBaseUrl: string;
  getItems: (includeArchived?: boolean) => Promise<StoredItem[]>;
  getUserById: (id: string) => Promise<UserRow | null>;
  getUserByDisplayName: (displayName: string) => Promise<UserRow | null>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
};

export const createBidService = ({
  supabase,
  handleSupabase,
  parseAuditDetails,
  sessionTtlMs,
  appBaseUrl,
  getItems,
  getUserById,
  getUserByDisplayName,
  queueNotification,
}: CreateBidServiceOptions) => {
  const buildItemUrl = (itemId: string) => `${appBaseUrl}/items/${itemId}`;

  const resolveLegacyBidOwnerForNotification = async (
    itemId: string,
    previousBidAmount: number,
    currentBidderUserId?: string
  ) => {
    const matchingAudits = handleSupabase(
      await supabase
        .from("audits")
        .select("actor,details_json,created_at")
        .eq("event_type", "BID_PLACED")
        .eq("entity_id", itemId)
        .order("created_at", { ascending: false })
        .limit(50)
    ) as Array<Pick<AuditRow, "actor" | "details_json" | "created_at">>;

    for (const audit of matchingAudits) {
      const details = parseAuditDetails(audit.details_json);
      if (Number(details.amount || 0) !== previousBidAmount) continue;

      const attributedUserId = String(details.bidderUserId || "");
      if (attributedUserId && attributedUserId !== currentBidderUserId) {
        return attributedUserId;
      }

      const fallbackUser = await getUserByDisplayName(audit.actor).catch(() => null);
      if (fallbackUser?.id && fallbackUser.id !== currentBidderUserId) {
        await handleSupabase(
          await supabase
            .from("bids")
            .update({ bidder_user_id: fallbackUser.id })
            .eq("item_id", itemId)
            .eq("amount", previousBidAmount)
            .is("bidder_user_id", null)
        );
        return fallbackUser.id;
      }
    }

    return "";
  };

  const getUserBidRecords = async (userId: string) => {
    const bidRows = handleSupabase(
      await supabase
        .from("bids")
        .select("item_id,amount,created_at")
        .eq("bidder_user_id", userId)
        .order("created_at", { ascending: false })
    ) as Array<{ item_id: string; amount: number | string; created_at: string }>;
    const latestBidByItem = new Map<string, { amount: number; createdAt: string }>();
    for (const row of bidRows) {
      if (!latestBidByItem.has(row.item_id)) {
        latestBidByItem.set(row.item_id, {
          amount: Number(row.amount),
          createdAt: row.created_at,
        });
      }
    }
    const uniqueItemIds = Array.from(latestBidByItem.keys());
    const items = new Map((await getItems(true)).map((item) => [item.id, item]));
    return uniqueItemIds.flatMap((itemId) => {
      const item = items.get(itemId);
      if (!item) return [];
      const latestBid = latestBidByItem.get(itemId);
      if (!latestBid) return [];
      const latestAmount = latestBid.amount;
      const status = new Date(item.endTime).getTime() > Date.now()
        ? (item.currentBid === latestAmount ? "winning" : "outbid")
        : (item.currentBid === latestAmount ? "won" : "lost");
      return [{
        itemId: item.id,
        title: item.title,
        category: item.category,
        lot: item.lot,
        currentBid: item.currentBid,
        yourLatestBid: latestAmount,
        endTime: item.endTime,
        lastBidAt: latestBid.createdAt,
        status,
      }];
    });
  };

  const validateBid = (item: StoredItem, amount: number) => {
    return validateBidAmount(item, amount, Date.now());
  };

  const placeBidAtomically = async (
    item: StoredItem,
    amount: number,
    expectedCurrentBid: number,
    bidderAlias: string,
    bidderUserId: string,
    idempotencyKey: string
  ) => {
    const bidId = randomUUID();
    const createdAt = new Date().toISOString();
    const idempotencyExpiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    const result = await supabase.rpc("place_auction_bid", {
      p_item_id: item.id,
      p_bid_id: bidId,
      p_bidder_alias: bidderAlias,
      p_bidder_user_id: bidderUserId,
      p_amount: amount,
      p_expected_current_bid: expectedCurrentBid,
      p_idempotency_key: idempotencyKey || null,
      p_created_at: createdAt,
      p_idempotency_expires_at: idempotencyExpiresAt,
    });
    if (result.error) {
      const message = result.error.message || "Unable to place bid.";
      if (message.includes("ITEM_NOT_FOUND")) return { ok: false as const, status: 404, error: "Item not found." };
      if (message.includes("IDEMPOTENCY_KEY_CONFLICT")) return { ok: false as const, status: 409, error: "Duplicate bid submission detected." };
      if (message.includes("BID_STATE_CHANGED")) return { ok: false as const, status: 409, error: "Item bid state changed. Refresh and try again." };
      if (message.includes("BIDDING_CLOSED")) return { ok: false as const, status: 400, error: "Bidding is closed or not yet open for this item." };
      if (message.includes("BID_TOO_LOW:")) {
        const requiredBid = message.split("BID_TOO_LOW:")[1]?.trim() || "";
        return { ok: false as const, status: 400, error: `Bid must be at least ${requiredBid}.` };
      }
      if (message.includes("INVALID_INCREMENT:")) {
        const increment = message.split("INVALID_INCREMENT:")[1]?.trim() || "";
        return { ok: false as const, status: 400, error: `Bid must increase by ${increment}.` };
      }
      throw new Error(message);
    }

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return {
      ok: true as const,
      bidId: String(row?.bid_id || bidId),
      bidSequence: Number(row?.bid_sequence || 0),
      currentBid: Number(row?.current_bid || amount),
      previousBidderUserId: row?.previous_bidder_user_id ? String(row.previous_bidder_user_id) : null,
      duplicate: Boolean(row?.duplicate),
    };
  };

  const queueBidActivityNotifications = async (
    item: StoredItem,
    bidder: { userId?: string; email?: string; displayName: string },
    amount: number,
    previousLeader?: { bidderUserId?: string; amount: number }
  ) => {
    const imageUrl = item.images[0]?.url ? `${appBaseUrl}${item.images[0].url}` : "";

    if (bidder.email) {
      await queueNotification(
        "BID_PLACED",
        `Your bid was placed for ${item.title}`,
        {
          itemId: item.id,
          title: item.title,
          amount,
          currentBid: amount,
          displayName: bidder.displayName,
          imageUrl,
          itemUrl: buildItemUrl(item.id),
        },
        bidder.email
      );
    }

    if (!previousLeader || previousLeader.bidderUserId === bidder.userId) return;
    const previousLeaderUserId = previousLeader.bidderUserId
      || await resolveLegacyBidOwnerForNotification(item.id, previousLeader.amount, bidder.userId);
    if (!previousLeaderUserId || previousLeaderUserId === bidder.userId) return;

    const previousLeaderUser = await getUserById(previousLeaderUserId);
    if (!previousLeaderUser?.email) return;

    await queueNotification(
      "OUTBID_ALERT",
      `You were outbid on ${item.title}`,
      {
        itemId: item.id,
        title: item.title,
        previousBid: previousLeader.amount,
        currentBid: amount,
        displayName: previousLeaderUser.display_name,
        imageUrl,
        itemUrl: buildItemUrl(item.id),
      },
      previousLeaderUser.email
    );
  };

  const backfillLegacyBidAuditAttribution = async () => {
    const users = handleSupabase(
      await supabase.from("users").select("id,display_name").eq("status", "active")
    ) as Array<{ id: string; display_name: string }>;
    const uniqueDisplayNameMap = new Map<string, string>();
    const duplicateDisplayNames = new Set<string>();
    for (const user of users) {
      if (uniqueDisplayNameMap.has(user.display_name)) {
        duplicateDisplayNames.add(user.display_name);
        uniqueDisplayNameMap.delete(user.display_name);
        continue;
      }
      if (!duplicateDisplayNames.has(user.display_name)) {
        uniqueDisplayNameMap.set(user.display_name, user.id);
      }
    }
    const bidAudits = handleSupabase(
      await supabase
        .from("audits")
        .select("id,entity_id,actor,details_json,created_at")
        .eq("event_type", "BID_PLACED")
        .order("created_at", { ascending: false })
    ) as Array<Pick<AuditRow, "id" | "entity_id" | "actor" | "details_json" | "created_at">>;
    for (const audit of bidAudits) {
      const details = parseAuditDetails(audit.details_json);
      if (details.bidderUserId) continue;
      const matchedUserId = uniqueDisplayNameMap.get(audit.actor);
      if (!matchedUserId) continue;
      await handleSupabase(
        await supabase
          .from("audits")
          .update({ details_json: { ...details, bidderUserId: matchedUserId } })
          .eq("id", audit.id)
      );
      await handleSupabase(
        await supabase
          .from("bids")
          .update({ bidder_user_id: matchedUserId })
          .eq("item_id", String(audit.entity_id))
          .eq("created_at", String(audit.created_at))
          .is("bidder_user_id", null)
      );
    }
  };

  return {
    resolveLegacyBidOwnerForNotification,
    getUserBidRecords,
    validateBid,
    placeBidAtomically,
    queueBidActivityNotifications,
    backfillLegacyBidAuditAttribution,
  };
};
