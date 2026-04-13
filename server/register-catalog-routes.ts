import express from "express";
import path from "path";
import { parseDocumentNameWithVisibility } from "./security-logic.js";
import type { AuthContext, AuditEntry, UserRow } from "./server-types.js";
import type { StoredItem } from "./item-read-model.js";
import { canBidWithRole, canViewItemOperationsWithRole, canViewReserveWithRole } from "../shared/permissions.js";

type AsyncRouteHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

type ItemFileRow = { item_id: string; kind: string; name: string; url: string };
type StoredBidRecord = {
  itemId: string;
  title: string;
  category: string;
  currentBid: number;
  endTime: string;
  status: string;
};

type RegisterCatalogRoutesOptions = {
  app: express.Express;
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          limit: (value: number) => Promise<unknown>;
          maybeSingle: () => Promise<unknown>;
        };
      };
      storage?: never;
      upsert?: never;
      delete?: never;
    };
    storage: {
      from: (bucket: string) => {
        download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
      };
    };
  };
  asyncHandler: (fn: AsyncRouteHandler) => express.RequestHandler;
  handleSupabase: <T>(result: { data: T; error: { message: string } | null }) => T;
  handleSupabaseMaybe: <T>(result: { data: T | null; error: { message: string } | null }, allowNotFound?: boolean) => T | null;
  getAuthContext: (req: express.Request) => Promise<AuthContext>;
  requireAdminToken: express.RequestHandler;
  requireItemOperationsViewerToken: express.RequestHandler;
  appendAudit: (req: express.Request, entry: AuditEntry) => Promise<void>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
  getItems: (includeArchived?: boolean) => Promise<StoredItem[]>;
  getItemById: (id: string, includeArchived?: boolean) => Promise<StoredItem | null>;
  sanitizeItemForAuth: (item: StoredItem, auth: AuthContext) => StoredItem;
  getCategories: () => Promise<string[]>;
  getLandingStats: () => Promise<unknown>;
  validateCategoryName: (value: string) => { ok: true; value: string } | { ok: false; error: string };
  canAccessItemDocument: (auth: AuthContext, item: StoredItem, visibility: "admin_only" | "bidder_visible" | "winner_only") => boolean;
  fileExists: (filePath: string) => Promise<boolean>;
  safeFileName: (name: string) => string;
  decodeStoredFilePath: (value: string) => string | null;
  guessContentType: (name: string, fallback?: string) => string;
  imagesDir: string;
  docsDir: string;
  imageBucket: string;
  documentBucket: string;
  imageAccessPolicy: string;
  getReserveState: (item: StoredItem) => string;
  toCsv: (rows: Array<Record<string, unknown>>) => string;
  checkBidRateLimit: (req: express.Request, actor: string, itemId: string) => Promise<boolean>;
  validateBid: (item: StoredItem, amount: number) => { ok: true } | { ok: false; error: string };
  placeBidAtomically: (
    item: StoredItem,
    amount: number,
    expectedCurrentBid: number,
    bidderAlias: string,
    bidderUserId: string,
    idempotencyKey: string
  ) => Promise<{
    ok: boolean;
    status: number;
    error?: string;
    duplicate?: boolean;
    bidSequence?: number;
    currentBid: number;
    previousBidderUserId?: string | null;
  }>;
  queueBidActivityNotifications: (
    item: StoredItem,
    bidder: { userId?: string; email?: string; displayName: string },
    amount: number,
    previousBid?: { bidder: string; bidderUserId?: string; amount: number; time: string; createdAt: string }
  ) => Promise<void>;
  getUserById: (id: string) => Promise<UserRow | null>;
  getUserBidRecords: (userId: string) => Promise<StoredBidRecord[]>;
};

export const registerCatalogRoutes = ({
  app,
  supabase,
  asyncHandler,
  handleSupabase,
  handleSupabaseMaybe,
  getAuthContext,
  requireAdminToken,
  requireItemOperationsViewerToken,
  appendAudit,
  queueNotification,
  getItems,
  getItemById,
  sanitizeItemForAuth,
  getCategories,
  getLandingStats,
  validateCategoryName,
  canAccessItemDocument,
  fileExists,
  safeFileName,
  decodeStoredFilePath,
  guessContentType,
  imagesDir,
  docsDir,
  imageBucket,
  documentBucket,
  imageAccessPolicy,
  getReserveState,
  toCsv,
  checkBidRateLimit,
  validateBid,
  placeBidAtomically,
  queueBidActivityNotifications,
  getUserById,
  getUserBidRecords,
}: RegisterCatalogRoutesOptions) => {
  app.get("/uploads/images/:file", asyncHandler(async (req, res) => {
    const rawFile = String(req.params.file || "");
    if (imageAccessPolicy !== "public") {
      const auth = await getAuthContext(req);
      if (!auth.signedIn) {
        res.status(401).json({ error: "Sign in required to access item images." });
        return;
      }
      if (imageAccessPolicy === "bidder_visible") {
        const publicUrl = `/uploads/images/${rawFile}`;
        const row = handleSupabaseMaybe<ItemFileRow>(
          await supabase.from("item_files").select("item_id,kind,name,url").eq("kind", "image").eq("url", publicUrl).maybeSingle(),
          true
        );
        const item = row ? await getItemById(row.item_id, true) : null;
        const itemVisible = item && !item.archivedAt;
        if (!auth.adminAuthorized && (!itemVisible || !(auth.role === "Bidder" || canViewItemOperationsWithRole(auth.role)))) {
          res.status(403).json({ error: "You do not have access to this image." });
          return;
        }
      }
    }
    const localFileName = safeFileName(rawFile);
    const localPath = path.join(imagesDir, localFileName);
    if (localFileName && await fileExists(localPath)) {
      res.sendFile(localPath);
      return;
    }
    const storagePath = decodeStoredFilePath(rawFile);
    if (!storagePath) {
      res.status(404).json({ error: "Image not found." });
      return;
    }
    const result = await supabase.storage.from(imageBucket).download(storagePath);
    if (result.error || !result.data) {
      res.status(404).json({ error: "Image not found." });
      return;
    }
    const buffer = Buffer.from(await result.data.arrayBuffer());
    res.setHeader("Content-Type", guessContentType(storagePath, "image/jpeg"));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buffer);
  }));

  app.get("/uploads/documents/:file", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn) {
      res.status(401).json({ error: "Sign in required to access documents." });
      return;
    }
    const rawFile = String(req.params.file || "");
    if (!rawFile) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const publicUrl = `/uploads/documents/${rawFile}`;
    const row = handleSupabaseMaybe<ItemFileRow>(
      await supabase.from("item_files").select("item_id,kind,name,url").eq("kind", "document").eq("url", publicUrl).maybeSingle(),
      true
    );
    if (!row) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const item = await getItemById(row.item_id, true);
    const parsedDocument = parseDocumentNameWithVisibility(row.name);
    if (!item || !canAccessItemDocument(auth, item, parsedDocument.visibility)) {
      res.status(403).json({ error: "You do not have access to this document." });
      return;
    }
    const localFileName = safeFileName(rawFile);
    const localPath = path.join(docsDir, localFileName);
    if (localFileName && await fileExists(localPath)) {
      res.sendFile(localPath);
      return;
    }
    const storagePath = decodeStoredFilePath(rawFile);
    if (!storagePath) {
      res.status(404).json({ error: "Document file not found." });
      return;
    }
    const result = await supabase.storage.from(documentBucket).download(storagePath);
    if (result.error || !result.data) {
      res.status(404).json({ error: "Document file not found." });
      return;
    }
    const buffer = Buffer.from(await result.data.arrayBuffer());
    res.setHeader("Content-Type", guessContentType(parsedDocument.displayName, "application/octet-stream"));
    res.setHeader("Content-Disposition", `inline; filename="${safeFileName(parsedDocument.displayName)}"`);
    res.send(buffer);
  }));

  app.get("/api/items", asyncHandler(async (req, res) => {
    const includeArchived = String(req.query.includeArchived || "") === "1";
    const auth = await getAuthContext(req);
    if (includeArchived && !auth.adminAuthorized) {
      res.status(403).json({ error: "Admin role required." });
      return;
    }
    const items = await getItems(includeArchived);
    res.json(items.map((item) => sanitizeItemForAuth(item, auth)));
  }));

  app.get("/api/items/:id", asyncHandler(async (req, res) => {
    const includeArchived = String(req.query.includeArchived || "") === "1";
    const auth = await getAuthContext(req);
    if (includeArchived && !auth.adminAuthorized) {
      res.status(403).json({ error: "Admin role required." });
      return;
    }
    const item = await getItemById(req.params.id, includeArchived);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(sanitizeItemForAuth(item, auth));
  }));

  app.get("/api/categories", asyncHandler(async (_req, res) => {
    res.json(await getCategories());
  }));

  app.get("/api/landing-stats", asyncHandler(async (_req, res) => {
    res.json(await getLandingStats());
  }));

  app.post("/api/categories", express.json({ limit: "128kb" }), requireAdminToken, asyncHandler(async (req, res) => {
    const validation = validateCategoryName(String(req.body?.name || ""));
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const before = new Set(await getCategories());
    await handleSupabase(await supabase.from("categories").upsert({ name: validation.value }, { onConflict: "name" }));
    const created = !before.has(validation.value);
    const auth = await getAuthContext(req);
    await appendAudit(req, {
      eventType: created ? "CATEGORY_CREATED" : "CATEGORY_RECONFIRMED",
      entityType: "system",
      entityId: validation.value,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { category: validation.value, created },
    });
    res.status(created ? 201 : 200).json({ created });
  }));

  app.delete("/api/categories/:name", requireAdminToken, asyncHandler(async (req, res) => {
    const validation = validateCategoryName(req.params.name);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const rows = handleSupabase(await supabase.from("items").select("id").eq("category", validation.value).limit(1)) as Array<{ id: string }>;
    if (rows.length > 0) {
      res.status(409).json({ error: "Category is assigned to one or more items." });
      return;
    }
    const existing = new Set(await getCategories());
    if (!existing.has(validation.value)) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    await handleSupabase(await supabase.from("categories").delete().eq("name", validation.value));
    const auth = await getAuthContext(req);
    await appendAudit(req, {
      eventType: "CATEGORY_DELETED",
      entityType: "system",
      entityId: validation.value,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { category: validation.value },
    });
    res.json({ ok: true });
  }));

  app.get("/api/exports/items.csv", requireItemOperationsViewerToken, asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    const items = (await getItems(auth.adminAuthorized)).map((item) => sanitizeItemForAuth(item, auth));
    const rows = items.map((item) => ({
      winner: (() => {
        if (new Date(item.endTime).getTime() > Date.now() || item.currentBid <= 0) return "";
        const winningBid = [...item.bids]
          .sort((a, b) => new Date(b.time ?? b.createdAt ?? 0).getTime() - new Date(a.time ?? a.createdAt ?? 0).getTime())
          .find((bid) => bid.amount === item.currentBid);
        return winningBid?.bidder || "";
      })(),
      id: item.id,
      title: item.title,
      category: item.category,
      lot: item.lot,
      sku: item.sku,
      condition: item.condition,
      location: item.location,
      startBid: item.startBid,
      reserve: canViewReserveWithRole(auth.role) ? item.reserve : "",
      increment: item.increment,
      currentBid: item.currentBid,
      reserveOutcome: getReserveState(item),
      startTime: item.startTime,
      endTime: item.endTime,
      bidCount: item.bids.length,
    }));
    await appendAudit(req, {
      eventType: "EXPORT_ITEMS",
      entityType: "export",
      entityId: "items.csv",
      actor: auth.actor,
      actorType: auth.actorType,
      details: { rowCount: rows.length },
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="items.csv"');
    res.send(toCsv(rows));
  }));

  app.get("/api/me/wins", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn || !auth.userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const bidRecords = await getUserBidRecords(auth.userId);
    const wins = bidRecords
      .filter((row) => row.status === "won")
      .map((row) => ({
        id: row.itemId,
        title: row.title,
        category: row.category,
        currentBid: row.currentBid,
        endTime: row.endTime,
      }));
    res.json(wins);
  }));

  app.post("/api/items/:id/bids", asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (!auth.signedIn) {
      res.status(401).json({ error: "Sign in to place a bid." });
      return;
    }
    if (!canBidWithRole(auth.role)) {
      res.status(403).json({ error: "Your account does not have bidding permission." });
      return;
    }
    const actor = auth.actor;
    const idempotencyKey = String(req.header("x-idempotency-key") || "");
    if (!(await checkBidRateLimit(req, actor, req.params.id))) {
      res.status(429).json({ error: "Too many bid attempts. Please wait and try again." });
      return;
    }
    const item = await getItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Item not found." });
      return;
    }
    const amount = Number(req.body.amount || 0);
    const expectedCurrentBid = Number(req.body.expectedCurrentBid || 0);
    if (item.currentBid !== expectedCurrentBid) {
      res.status(409).json({ error: "Item bid state changed. Refresh and try again." });
      return;
    }
    const validation = validateBid(item, amount);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const persistedBidderUserId = auth.userId && auth.userId !== "admin-token" ? auth.userId : "";
    const biddingUser = auth.userId ? await getUserById(auth.userId) : null;
    const bidResult = await placeBidAtomically(
      item,
      amount,
      expectedCurrentBid,
      "Bidder",
      persistedBidderUserId,
      idempotencyKey
    );
    if (!bidResult.ok) {
      res.status(bidResult.status).json({ error: bidResult.error });
      return;
    }
    if (bidResult.duplicate) {
      res.status(409).json({ error: "Duplicate bid submission detected." });
      return;
    }
    await appendAudit(req, {
      eventType: "BID_PLACED",
      entityType: "bid",
      entityId: item.id,
      actor,
      actorType: auth.actorType,
      details: {
        amount,
        bidSequence: bidResult.bidSequence || 0,
      },
    });
    await queueBidActivityNotifications(
      { ...item, currentBid: bidResult.currentBid },
      {
        userId: auth.userId,
        email: biddingUser?.email,
        displayName: biddingUser?.display_name || actor,
      },
      amount,
      item.currentBid > 0
        ? {
            bidder: "",
            bidderUserId: bidResult.previousBidderUserId || undefined,
            amount: item.currentBid,
            time: "",
            createdAt: "",
          }
        : undefined
    );
    res.json(await getItemById(item.id));
  }));
};
