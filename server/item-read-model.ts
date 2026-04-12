import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDocumentNameWithVisibility, type DocumentVisibility } from "./security-logic.js";

type StoredFileRef = { name: string; url: string; visibility?: DocumentVisibility };
type StoredBid = { bidder: string; amount: number; time: string; createdAt: string; bidderUserId?: string };
export type StoredItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  startBid: number;
  reserve?: number;
  increment: number;
  currentBid: number;
  startTime: string;
  endTime: string;
  description: string;
  images: StoredFileRef[];
  documents: StoredFileRef[];
  bids: StoredBid[];
  createdAt: string;
  archivedAt?: string | null;
};

type ItemRow = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  start_bid: number | string;
  reserve: number | string;
  increment_amount: number | string;
  current_bid: number | string;
  start_time: string;
  end_time: string;
  description: string;
  created_at: string;
  archived_at: string | null;
};

type ItemFileRow = { item_id: string; kind: string; name: string; url: string };
type BidRow = { item_id: string; bidder_alias: string; bidder_user_id?: string | null; amount: number | string; bid_time: string; created_at: string };
type BidAuditRow = {
  entity_id: string;
  details_json: Record<string, unknown> | string;
  created_at: string;
};

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;
type HandleSupabaseMaybe = <T>(result: { data: T | null; error: { message: string } | null }, allowNotFound?: boolean) => T | null;

type CreateItemReadModelOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  handleSupabaseMaybe: HandleSupabaseMaybe;
  parseAuditDetails: (value: Record<string, unknown> | string | null | undefined) => Record<string, unknown>;
};

export const createItemReadModel = ({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  parseAuditDetails,
}: CreateItemReadModelOptions) => {
  const mapItem = (
    row: ItemRow,
    files: ItemFileRow[],
    bids: BidRow[],
    bidAuditLookup: Map<string, Map<string, string>>,
    bidUserLookup: Map<string, string>
  ): StoredItem => ({
    id: row.id,
    title: row.title,
    category: row.category,
    lot: row.lot,
    sku: row.sku,
    condition: row.condition,
    location: row.location,
    startBid: Number(row.start_bid),
    reserve: Number(row.reserve),
    increment: Number(row.increment_amount),
    currentBid: Number(row.current_bid),
    startTime: new Date(row.start_time).toISOString(),
    endTime: new Date(row.end_time).toISOString(),
    description: row.description || "",
    images: files.filter((file) => file.item_id === row.id && file.kind === "image").map((file) => ({ name: file.name, url: file.url })),
    documents: files
      .filter((file) => file.item_id === row.id && file.kind === "document")
      .map((file) => {
        const parsed = parseDocumentNameWithVisibility(file.name);
        return { name: parsed.displayName, url: file.url, visibility: parsed.visibility };
      }),
    bids: bids.filter((bid) => bid.item_id === row.id).map((bid) => ({
      bidder: bidUserLookup.get(bid.bidder_user_id || bidAuditLookup.get(row.id)?.get(bid.created_at) || "") || bid.bidder_alias,
      amount: Number(bid.amount),
      time: bid.bid_time,
      createdAt: bid.created_at,
      bidderUserId: bid.bidder_user_id || bidAuditLookup.get(row.id)?.get(bid.created_at) || undefined,
    })),
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  });

  const hydrateItems = async (rows: ItemRow[]) => {
    if (!rows.length) return [] as StoredItem[];
    const ids = rows.map((row) => row.id);
    const files = handleSupabase(
      await supabase.from("item_files").select("item_id,kind,name,url").in("item_id", ids)
    ) as ItemFileRow[];
    const bids = handleSupabase(
      await supabase
        .from("bids")
        .select("item_id,bidder_alias,bidder_user_id,amount,bid_time,created_at")
        .in("item_id", ids)
        .order("created_at", { ascending: false })
    ) as BidRow[];
    const bidAudits = handleSupabase(
      await supabase
        .from("audits")
        .select("entity_id,details_json,created_at")
        .eq("event_type", "BID_PLACED")
        .in("entity_id", ids)
    ) as BidAuditRow[];
    const bidAuditLookup = new Map<string, Map<string, string>>();
    for (const audit of bidAudits) {
      const bidderUserId = String(parseAuditDetails(audit.details_json).bidderUserId || "");
      if (!bidderUserId) continue;
      if (!bidAuditLookup.has(audit.entity_id)) {
        bidAuditLookup.set(audit.entity_id, new Map());
      }
      bidAuditLookup.get(audit.entity_id)!.set(audit.created_at, bidderUserId);
    }
    const bidderUserIds = Array.from(new Set(
      bids
        .map((bid) => bid.bidder_user_id || bidAuditLookup.get(bid.item_id)?.get(bid.created_at) || "")
        .filter(Boolean)
    ));
    const bidUsers = bidderUserIds.length
      ? handleSupabase(
          await supabase.from("users").select("id,display_name").in("id", bidderUserIds)
        ) as Array<{ id: string; display_name: string }>
      : [];
    const bidUserLookup = new Map(bidUsers.map((user) => [user.id, user.display_name]));
    return rows.map((row) => mapItem(row, files, bids, bidAuditLookup, bidUserLookup));
  };

  const getItems = async (includeArchived = false) => {
    let request = supabase
      .from("items")
      .select("id,title,category,lot,sku,condition,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description,created_at,archived_at")
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false });
    if (!includeArchived) request = request.is("archived_at", null);
    const rows = handleSupabase(await request) as ItemRow[];
    return hydrateItems(rows);
  };

  const getItemById = async (id: string, includeArchived = false) => {
    const row = handleSupabaseMaybe(
      await supabase
        .from("items")
        .select("id,title,category,lot,sku,condition,location,start_bid,reserve,increment_amount,current_bid,start_time,end_time,description,created_at,archived_at")
        .eq("id", id)
        .maybeSingle(),
      true
    ) as ItemRow | null;
    if (!row) return null;
    if (!includeArchived && row.archived_at) return null;
    return (await hydrateItems([row]))[0] || null;
  };

  return {
    getItems,
    getItemById,
  };
};
