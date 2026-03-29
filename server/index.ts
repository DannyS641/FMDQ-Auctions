import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 5174);
const adminApiToken = process.env.ADMIN_API_TOKEN || "";
const notificationRecipient = process.env.NOTIFY_TO || "operations@fmdq.example";
const bidRateWindowMs = 60_000;
const bidRateLimit = 12;

const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
const imagesDir = path.join(uploadsDir, "images");
const docsDir = path.join(uploadsDir, "documents");
const legacyDbPath = path.join(dataDir, "auctions.json");
const sqlitePath = path.join(dataDir, "auctions.sqlite");

[dataDir, uploadsDir, imagesDir, docsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as express.Request & { requestId?: string }).requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/uploads", express.static(uploadsDir));

type StoredFileRef = {
  name: string;
  url: string;
};

type StoredBid = {
  bidder: string;
  amount: number;
  time: string;
  createdAt: string;
};

type StoredItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  startBid: number;
  reserve: number;
  increment: number;
  currentBid: number;
  startTime: string;
  endTime: string;
  description: string;
  images: StoredFileRef[];
  documents: StoredFileRef[];
  bids: StoredBid[];
  createdAt: string;
};

type AuditEntry = {
  id: string;
  eventType: string;
  entityType: "item" | "bid" | "system" | "export";
  entityId: string;
  actor: string;
  actorType: "system" | "user" | "integration";
  requestId: string;
  details: Record<string, string | number | boolean>;
  createdAt: string;
};

type NotificationQueueItem = {
  id: string;
  channel: "email";
  eventType: string;
  recipient: string;
  subject: string;
  status: "pending";
  payload: Record<string, string | number | boolean>;
  createdAt: string;
};

type LegacyDatabase = {
  items?: Array<StoredItem & { bids?: Array<{ bidder: string; amount: number; time: string; createdAt?: string }> }>;
  audits?: AuditEntry[];
  notificationQueue?: NotificationQueueItem[];
};

const db = new DatabaseSync(sqlitePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    lot TEXT NOT NULL,
    sku TEXT NOT NULL,
    condition TEXT NOT NULL,
    location TEXT NOT NULL,
    start_bid REAL NOT NULL,
    reserve REAL NOT NULL,
    increment_amount REAL NOT NULL,
    current_bid REAL NOT NULL DEFAULT 0,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_files (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bids (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    bidder_alias TEXT NOT NULL,
    amount REAL NOT NULL,
    bid_time TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    request_id TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_queue (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bids_item_created_at ON bids(item_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_item_files_item_kind ON item_files(item_id, kind);
  CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at DESC);
`);

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedDocumentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isDoc = file.fieldname === "documents";
    cb(null, isDoc ? docsDir : imagesDir);
  },
  filename: (req, file, cb) => {
    const stamp = Date.now();
    cb(null, `${stamp}-${safeFileName(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: 16,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const isImage = file.fieldname === "images" && allowedImageTypes.has(file.mimetype);
    const isDocument = file.fieldname === "documents" && allowedDocumentTypes.has(file.mimetype);
    cb(null, isImage || isDocument);
  }
});

const itemCountStmt = db.prepare("SELECT COUNT(*) as count FROM items");
const getItemsStmt = db.prepare(`
  SELECT
    id,
    title,
    category,
    lot,
    sku,
    condition,
    location,
    start_bid as startBid,
    reserve,
    increment_amount as increment,
    current_bid as currentBid,
    start_time as startTime,
    end_time as endTime,
    description,
    created_at as createdAt
  FROM items
  ORDER BY datetime(created_at) DESC
`);
const getItemByIdStmt = db.prepare(`
  SELECT
    id,
    title,
    category,
    lot,
    sku,
    condition,
    location,
    start_bid as startBid,
    reserve,
    increment_amount as increment,
    current_bid as currentBid,
    start_time as startTime,
    end_time as endTime,
    description,
    created_at as createdAt
  FROM items
  WHERE id = ?
`);
const getItemFilesStmt = db.prepare(`
  SELECT kind, name, url
  FROM item_files
  WHERE item_id = ?
  ORDER BY rowid ASC
`);
const getItemBidsStmt = db.prepare(`
  SELECT bidder_alias as bidder, amount, bid_time as time, created_at as createdAt
  FROM bids
  WHERE item_id = ?
  ORDER BY datetime(created_at) DESC, rowid DESC
`);
const insertItemStmt = db.prepare(`
  INSERT INTO items (
    id, title, category, lot, sku, condition, location,
    start_bid, reserve, increment_amount, current_bid,
    start_time, end_time, description, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertItemFileStmt = db.prepare(`
  INSERT INTO item_files (id, item_id, kind, name, url)
  VALUES (?, ?, ?, ?, ?)
`);
const insertBidStmt = db.prepare(`
  INSERT INTO bids (id, item_id, bidder_alias, amount, bid_time, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateItemBidStmt = db.prepare(`
  UPDATE items SET current_bid = ? WHERE id = ?
`);
const insertAuditStmt = db.prepare(`
  INSERT INTO audits (
    id, event_type, entity_type, entity_id, actor,
    actor_type, request_id, details_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertNotificationStmt = db.prepare(`
  INSERT INTO notification_queue (
    id, channel, event_type, recipient, subject, status, payload_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getActor = (req: express.Request) => String(req.header("x-user") || "system");
const getActorRole = (req: express.Request) => String(req.header("x-role") || "Guest");
const recentBidAttempts = new Map<string, number[]>();
const processedBidKeys = new Map<string, string>();

const mapItem = (row: Record<string, unknown>): StoredItem => {
  const files = getItemFilesStmt.all(String(row.id)) as Array<{ kind: string; name: string; url: string }>;
  const bids = getItemBidsStmt.all(String(row.id)) as Array<StoredBid>;
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category),
    lot: String(row.lot),
    sku: String(row.sku),
    condition: String(row.condition),
    location: String(row.location),
    startBid: Number(row.startBid),
    reserve: Number(row.reserve),
    increment: Number(row.increment),
    currentBid: Number(row.currentBid),
    startTime: String(row.startTime),
    endTime: String(row.endTime),
    description: String(row.description || ""),
    images: files.filter((file) => file.kind === "image").map(({ name, url }) => ({ name, url })),
    documents: files.filter((file) => file.kind === "document").map(({ name, url }) => ({ name, url })),
    bids,
    createdAt: String(row.createdAt)
  };
};

const getItems = () => (getItemsStmt.all() as Array<Record<string, unknown>>).map(mapItem);
const getItemById = (id: string) => {
  const row = getItemByIdStmt.get(id) as Record<string, unknown> | undefined;
  return row ? mapItem(row) : null;
};

const appendAudit = (
  req: express.Request,
  entry: Omit<AuditEntry, "id" | "createdAt" | "requestId">
) => {
  insertAuditStmt.run(
    randomUUID(),
    entry.eventType,
    entry.entityType,
    entry.entityId,
    entry.actor,
    entry.actorType,
    String((req as express.Request & { requestId?: string }).requestId || ""),
    JSON.stringify(entry.details),
    new Date().toISOString()
  );
};

const queueNotification = (
  eventType: string,
  subject: string,
  payload: Record<string, string | number | boolean>
) => {
  insertNotificationStmt.run(
    randomUUID(),
    "email",
    eventType,
    notificationRecipient,
    subject,
    "pending",
    JSON.stringify(payload),
    new Date().toISOString()
  );
};

const toIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const validateNewItem = (body: Record<string, string>) => {
  const title = (body.title || "").trim();
  const category = (body.category || "").trim();
  const lot = (body.lot || "").trim();
  const sku = (body.sku || "").trim();
  const condition = (body.condition || "").trim();
  const location = (body.location || "").trim();
  const description = (body.description || "").trim();
  const startBid = Number(body.startBid);
  const reserve = Number(body.reserve);
  const increment = Number(body.increment || Math.max(500, Math.round(startBid * 0.02)));
  const startTime = toIso(body.startTime || "");
  const endTime = toIso(body.endTime || "");

  if (!title || !category || !lot || !sku || !condition || !location) {
    return { ok: false as const, error: "Missing required item fields." };
  }
  if (!startTime || !endTime) {
    return { ok: false as const, error: "Invalid start or end time." };
  }
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    return { ok: false as const, error: "Auction end time must be after start time." };
  }
  if (!Number.isFinite(startBid) || startBid <= 0) {
    return { ok: false as const, error: "Starting bid must be greater than zero." };
  }
  if (!Number.isFinite(reserve) || reserve < startBid) {
    return { ok: false as const, error: "Reserve price must be at least the starting bid." };
  }
  if (!Number.isFinite(increment) || increment <= 0) {
    return { ok: false as const, error: "Bid increment must be greater than zero." };
  }

  return {
    ok: true as const,
    value: {
      title,
      category,
      lot,
      sku,
      condition,
      location,
      description,
      startBid,
      reserve,
      increment,
      startTime,
      endTime
    }
  };
};

const formatBidTime = (createdAt: string) =>
  new Date(createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const validateBid = (item: StoredItem, amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, error: "Invalid bid amount." };
  }

  const now = Date.now();
  const start = new Date(item.startTime).getTime();
  const end = new Date(item.endTime).getTime();
  if (now < start || now > end) {
    return { ok: false as const, error: "Bidding is closed or not yet open for this item." };
  }

  const requiredBid = Math.max(item.currentBid || item.startBid, item.startBid) + item.increment;
  if (amount < requiredBid) {
    return { ok: false as const, error: `Bid must be at least ${requiredBid}.` };
  }
  if ((amount - requiredBid) % item.increment !== 0) {
    return { ok: false as const, error: `Bid must increase by ${item.increment}.` };
  }

  return { ok: true as const };
};

const csvEscape = (value: string | number | boolean) => `"${String(value).replace(/"/g, "\"\"")}"`;
const toCsv = (rows: Array<Record<string, string | number | boolean>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(","))
  ].join("\n");
};

const requireAdminToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!adminApiToken) {
    next();
    return;
  }
  if (req.header("x-admin-token") !== adminApiToken) {
    res.status(403).json({ error: "Admin token required." });
    return;
  }
  next();
};

const canManageItems = (req: express.Request) => {
  if (adminApiToken) {
    return req.header("x-admin-token") === adminApiToken;
  }
  return getActorRole(req) === "Admin";
};

const checkBidRateLimit = (actor: string, itemId: string) => {
  const now = Date.now();
  const key = `${actor}:${itemId}`;
  const existing = recentBidAttempts.get(key) || [];
  const current = existing.filter((value) => now - value < bidRateWindowMs);
  if (current.length >= bidRateLimit) {
    recentBidAttempts.set(key, current);
    return false;
  }
  current.push(now);
  recentBidAttempts.set(key, current);
  return true;
};

const migrateLegacyJson = () => {
  const itemCountRow = itemCountStmt.get() as { count: number };
  if (itemCountRow.count > 0 || !fs.existsSync(legacyDbPath)) return;

  const raw = fs.readFileSync(legacyDbPath, "utf8");
  const legacy = JSON.parse(raw) as LegacyDatabase;
  const items = legacy.items || [];
  const audits = legacy.audits || [];
  const notificationQueue = legacy.notificationQueue || [];

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      insertItemStmt.run(
        item.id,
        item.title,
        item.category,
        item.lot,
        item.sku,
        item.condition,
        item.location,
        item.startBid,
        item.reserve,
        item.increment,
        item.currentBid,
        item.startTime,
        item.endTime,
        item.description || "",
        item.createdAt
      );

      for (const image of item.images || []) {
        insertItemFileStmt.run(randomUUID(), item.id, "image", image.name, image.url);
      }
      for (const document of item.documents || []) {
        insertItemFileStmt.run(randomUUID(), item.id, "document", document.name, document.url);
      }
      for (const bid of item.bids || []) {
        const createdAt = bid.createdAt || new Date().toISOString();
        insertBidStmt.run(randomUUID(), item.id, bid.bidder, bid.amount, bid.time, createdAt);
      }
    }

    for (const audit of audits) {
      insertAuditStmt.run(
        audit.id || randomUUID(),
        audit.eventType,
        audit.entityType,
        audit.entityId,
        audit.actor,
        audit.actorType,
        audit.requestId,
        JSON.stringify(audit.details),
        audit.createdAt
      );
    }

    for (const notification of notificationQueue) {
      insertNotificationStmt.run(
        notification.id || randomUUID(),
        notification.channel,
        notification.eventType,
        notification.recipient,
        notification.subject,
        notification.status,
        JSON.stringify(notification.payload),
        notification.createdAt
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const seedIfEmpty = () => {
  const itemCountRow = itemCountStmt.get() as { count: number };
  if (itemCountRow.count > 0) return;

  const now = Date.now();
  const seedItems: StoredItem[] = [
    {
      id: "LOT-2041",
      title: "Toyota Corolla 2015",
      category: "Cars",
      lot: "CAR-015",
      sku: "FMDQ-CAR-015",
      condition: "Used",
      location: "Lagos Warehouse",
      startBid: 4500000,
      reserve: 6200000,
      increment: 50000,
      currentBid: 5750000,
      startTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now + 90 * 60 * 1000).toISOString(),
      description: "Well-maintained sedan, full service history available.",
      images: [],
      documents: [],
      bids: [
        { bidder: "Bidder-001", amount: 5400000, time: "09:10", createdAt: new Date().toISOString() },
        { bidder: "Bidder-002", amount: 5600000, time: "09:22", createdAt: new Date().toISOString() },
        { bidder: "Bidder-003", amount: 5750000, time: "09:33", createdAt: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: "LOT-2042",
      title: "Samsung 65 inch UHD Smart TV",
      category: "Household Appliances",
      lot: "HAP-210",
      sku: "FMDQ-HAP-210",
      condition: "Fair",
      location: "Abuja Hub",
      startBid: 180000,
      reserve: 260000,
      increment: 5000,
      currentBid: 205000,
      startTime: new Date(now - 30 * 60 * 1000).toISOString(),
      endTime: new Date(now + 40 * 60 * 1000).toISOString(),
      description: "Screen intact, minor scratches on frame.",
      images: [],
      documents: [],
      bids: [
        { bidder: "Bidder-001", amount: 190000, time: "09:40", createdAt: new Date().toISOString() },
        { bidder: "Bidder-002", amount: 205000, time: "09:52", createdAt: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    }
  ];

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of seedItems) {
      insertItemStmt.run(
        item.id,
        item.title,
        item.category,
        item.lot,
        item.sku,
        item.condition,
        item.location,
        item.startBid,
        item.reserve,
        item.increment,
        item.currentBid,
        item.startTime,
        item.endTime,
        item.description,
        item.createdAt
      );
      for (const bid of item.bids) {
        insertBidStmt.run(randomUUID(), item.id, bid.bidder, bid.amount, bid.time, bid.createdAt);
      }
    }
    insertAuditStmt.run(
      randomUUID(),
      "SYSTEM_SEED",
      "system",
      "seed",
      "system",
      "system",
      "seed",
      JSON.stringify({ itemCount: seedItems.length }),
      new Date().toISOString()
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

app.get("/api/health", (req, res) => {
  const itemsCount = Number((itemCountStmt.get() as { count: number }).count);
  const auditsCount = Number((db.prepare("SELECT COUNT(*) as count FROM audits").get() as { count: number }).count);
  const queueCount = Number((db.prepare("SELECT COUNT(*) as count FROM notification_queue").get() as { count: number }).count);
  res.json({
    status: "ok",
    storage: "sqlite",
    items: itemsCount,
    audits: auditsCount,
    notificationQueue: queueCount
  });
});

app.get("/api/items", (req, res) => {
  res.json(getItems());
});

app.get("/api/items/:id", (req, res) => {
  const item = getItemById(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

app.get("/api/exports/items.csv", requireAdminToken, (req, res) => {
  const rows = getItems().map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    lot: item.lot,
    sku: item.sku,
    condition: item.condition,
    location: item.location,
    startBid: item.startBid,
    reserve: item.reserve,
    increment: item.increment,
    currentBid: item.currentBid,
    startTime: item.startTime,
    endTime: item.endTime,
    bidCount: item.bids.length,
    createdAt: item.createdAt
  }));
  appendAudit(req, {
    eventType: "ITEM_EXPORT",
    entityType: "export",
    entityId: "items.csv",
    actor: getActor(req),
    actorType: "user",
    details: { rowCount: rows.length }
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"items-export.csv\"");
  res.send(toCsv(rows));
});

app.get("/api/exports/audits.csv", requireAdminToken, (req, res) => {
  const rows = (db.prepare(`
    SELECT
      id,
      event_type as eventType,
      entity_type as entityType,
      entity_id as entityId,
      actor,
      actor_type as actorType,
      request_id as requestId,
      details_json as details,
      created_at as createdAt
    FROM audits
    ORDER BY datetime(created_at) DESC
  `).all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    eventType: String(row.eventType),
    entityType: String(row.entityType),
    entityId: String(row.entityId),
    actor: String(row.actor),
    actorType: String(row.actorType),
    requestId: String(row.requestId),
    details: String(row.details),
    createdAt: String(row.createdAt)
  }));
  appendAudit(req, {
    eventType: "AUDIT_EXPORT",
    entityType: "export",
    entityId: "audits.csv",
    actor: getActor(req),
    actorType: "user",
    details: { rowCount: rows.length }
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"audit-export.csv\"");
  res.send(toCsv(rows));
});

app.post(
  "/api/items",
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "documents", maxCount: 6 }
  ]),
  (req, res) => {
    if (!canManageItems(req)) {
      res.status(403).json({ error: "Admin role required." });
      return;
    }

    const body = req.body as Record<string, string>;
    const validation = validateNewItem(body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const itemId = `LOT-${Math.floor(1000 + Math.random() * 9000)}`;
    const createdAt = new Date().toISOString();
    const images = ((req.files as Record<string, Express.Multer.File[]>)?.images || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/images/${file.filename}`
    }));
    const documents = ((req.files as Record<string, Express.Multer.File[]>)?.documents || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/documents/${file.filename}`
    }));

    db.exec("BEGIN IMMEDIATE");
    try {
      insertItemStmt.run(
        itemId,
        validation.value.title,
        validation.value.category,
        validation.value.lot,
        validation.value.sku,
        validation.value.condition,
        validation.value.location,
        validation.value.startBid,
        validation.value.reserve,
        validation.value.increment,
        0,
        validation.value.startTime,
        validation.value.endTime,
        validation.value.description,
        createdAt
      );
      for (const image of images) {
        insertItemFileStmt.run(randomUUID(), itemId, "image", image.name, image.url);
      }
      for (const document of documents) {
        insertItemFileStmt.run(randomUUID(), itemId, "document", document.name, document.url);
      }
      appendAudit(req, {
        eventType: "ITEM_CREATED",
        entityType: "item",
        entityId: itemId,
        actor: getActor(req),
        actorType: "user",
        details: {
          category: validation.value.category,
          lot: validation.value.lot,
          reserve: validation.value.reserve,
          imageCount: images.length,
          documentCount: documents.length
        }
      });
      queueNotification("ITEM_CREATED", `Auction item created: ${validation.value.title}`, {
        itemId,
        title: validation.value.title,
        category: validation.value.category
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const created = getItemById(itemId);
    res.status(201).json(created);
  }
);

app.post("/api/items/:id/bids", (req, res) => {
  const actor = getActor(req);
  const idempotencyKey = String(req.header("x-idempotency-key") || "");

  if (!checkBidRateLimit(actor, req.params.id)) {
    res.status(429).json({ error: "Too many bid attempts. Please wait and try again." });
    return;
  }

  if (idempotencyKey && processedBidKeys.get(idempotencyKey) === req.params.id) {
    res.status(409).json({ error: "Duplicate bid submission detected." });
    return;
  }

  const amount = Number(req.body.amount || 0);
  const expectedCurrentBid = Number(req.body.expectedCurrentBid || 0);

  db.exec("BEGIN IMMEDIATE");
  try {
    const item = getItemById(req.params.id);
    if (!item) {
      db.exec("ROLLBACK");
      res.status(404).json({ error: "Item not found" });
      return;
    }

    if (expectedCurrentBid !== item.currentBid) {
      db.exec("ROLLBACK");
      res.status(409).json({ error: "Auction state changed. Refresh and submit your bid again." });
      return;
    }

    const validation = validateBid(item, amount);
    if (!validation.ok) {
      db.exec("ROLLBACK");
      res.status(400).json({ error: validation.error });
      return;
    }

    const createdAt = new Date().toISOString();
    const bidSequence = item.bids.length + 1;
    const bidAlias = `Bidder-${String(bidSequence).padStart(3, "0")}`;
    insertBidStmt.run(randomUUID(), item.id, bidAlias, amount, formatBidTime(createdAt), createdAt);
    updateItemBidStmt.run(amount, item.id);
    if (idempotencyKey) {
      processedBidKeys.set(idempotencyKey, item.id);
    }
    appendAudit(req, {
      eventType: "BID_PLACED",
      entityType: "bid",
      entityId: item.id,
      actor,
      actorType: "user",
      details: {
        amount,
        bidSequence,
        auctionItemId: item.id
      }
    });
    queueNotification("BID_PLACED", `Bid accepted for ${item.title}`, {
      itemId: item.id,
      amount,
      bidSequence
    });
    db.exec("COMMIT");

    const updated = getItemById(item.id);
    res.json(updated);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

const start = () => {
  migrateLegacyJson();
  seedIfEmpty();
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
    console.log(`Storage backend: sqlite (${sqlitePath})`);
  });
};

start();
