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
const notificationTransport = (process.env.NOTIFY_TRANSPORT || "file").toLowerCase();
const notificationPollMs = Math.max(Number(process.env.NOTIFY_POLL_MS || 5000), 1000);
const bidRateWindowMs = 60_000;
const bidRateLimit = 12;

const dataDir = path.join(__dirname, "data");
const outboxDir = path.join(dataDir, "notification-outbox");
const uploadsDir = path.join(__dirname, "uploads");
const imagesDir = path.join(uploadsDir, "images");
const docsDir = path.join(uploadsDir, "documents");
const legacyDbPath = path.join(dataDir, "auctions.json");
const sqlitePath = path.join(dataDir, "auctions.sqlite");

[dataDir, outboxDir, uploadsDir, imagesDir, docsDir].forEach((dir) => {
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
  archivedAt?: string | null;
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
  status: "pending" | "sent" | "failed";
  payload: Record<string, string | number | boolean>;
  createdAt: string;
  processedAt?: string;
  errorMessage?: string;
};

type LegacyDatabase = {
  items?: Array<StoredItem & { bids?: Array<{ bidder: string; amount: number; time: string; createdAt?: string }> }>;
  audits?: AuditEntry[];
  notificationQueue?: NotificationQueueItem[];
};

const defaultCategories = [
  "Cars",
  "Furniture",
  "Household Appliances",
  "Kitchen Appliances",
  "Phones",
  "Other"
];

type Role = "Guest" | "Bidder" | "Observer" | "Admin";

type AuthContext = {
  actor: string;
  actorType: AuditEntry["actorType"];
  role: Role;
  trusted: boolean;
  adminAuthorized: boolean;
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
    created_at TEXT NOT NULL,
    archived_at TEXT
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
    created_at TEXT NOT NULL,
    processed_at TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bids_item_created_at ON bids(item_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_item_files_item_kind ON item_files(item_id, kind);
  CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at DESC);
`);

const itemColumns = db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
if (!itemColumns.some((column) => column.name === "archived_at")) {
  db.exec("ALTER TABLE items ADD COLUMN archived_at TEXT");
}
const notificationColumns = db.prepare("PRAGMA table_info(notification_queue)").all() as Array<{ name: string }>;
if (!notificationColumns.some((column) => column.name === "processed_at")) {
  db.exec("ALTER TABLE notification_queue ADD COLUMN processed_at TEXT");
}
if (!notificationColumns.some((column) => column.name === "error_message")) {
  db.exec("ALTER TABLE notification_queue ADD COLUMN error_message TEXT");
}

const allowDevAuth =
  process.env.ALLOW_DEV_AUTH === "true" ||
  (typeof process.env.ALLOW_DEV_AUTH === "undefined" && process.env.NODE_ENV !== "production");

const normalizeRole = (value: string): Role => {
  if (value === "Admin" || value === "Bidder" || value === "Observer" || value === "Guest") {
    return value;
  }
  return "Guest";
};

const isLoopbackAddress = (value: string) =>
  value === "::1" ||
  value === "127.0.0.1" ||
  value === "::ffff:127.0.0.1" ||
  value === "::ffff:localhost" ||
  value.endsWith("/127.0.0.1");

const getAuthContext = (req: express.Request): AuthContext => {
  if (adminApiToken && req.header("x-admin-token") === adminApiToken) {
    return {
      actor: "Admin API token",
      actorType: "integration",
      role: "Admin",
      trusted: true,
      adminAuthorized: true
    };
  }

  const remoteAddress = req.ip || req.socket.remoteAddress || "";
  const authMode = String(req.header("x-auth-mode") || "").toLowerCase();
  const userLabel = String(req.header("x-user") || "").trim();
  const role = normalizeRole(String(req.header("x-role") || "Guest"));
  const trustedLocalDevSession = allowDevAuth && authMode === "local" && isLoopbackAddress(remoteAddress);

  if (trustedLocalDevSession && userLabel) {
    return {
      actor: userLabel,
      actorType: "user",
      role,
      trusted: true,
      adminAuthorized: role === "Admin"
    };
  }

  return {
    actor: "anonymous-client",
    actorType: "system",
    role: "Guest",
    trusted: false,
    adminAuthorized: false
  };
};

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
const categoryCountStmt = db.prepare("SELECT COUNT(*) as count FROM categories");
const getCategoriesStmt = db.prepare(`
  SELECT name
  FROM categories
  ORDER BY LOWER(name) ASC
`);
const insertCategoryStmt = db.prepare(`
  INSERT OR IGNORE INTO categories (name, created_at)
  VALUES (?, ?)
`);
const deleteCategoryStmt = db.prepare(`
  DELETE FROM categories
  WHERE name = ?
`);
const categoryInUseStmt = db.prepare(`
  SELECT COUNT(*) as count
  FROM items
  WHERE category = ?
`);
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
    created_at as createdAt,
    archived_at as archivedAt
  FROM items
  WHERE archived_at IS NULL
  ORDER BY datetime(created_at) DESC
`);
const getAllItemsStmt = db.prepare(`
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
    created_at as createdAt,
    archived_at as archivedAt
  FROM items
  ORDER BY archived_at IS NOT NULL ASC, datetime(created_at) DESC
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
    created_at as createdAt,
    archived_at as archivedAt
  FROM items
  WHERE id = ?
`);
const archiveItemStmt = db.prepare(`
  UPDATE items
  SET archived_at = ?
  WHERE id = ?
`);
const restoreItemStmt = db.prepare(`
  UPDATE items
  SET archived_at = NULL
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
const updateItemStmt = db.prepare(`
  UPDATE items
  SET
    title = ?,
    category = ?,
    lot = ?,
    sku = ?,
    condition = ?,
    location = ?,
    start_bid = ?,
    reserve = ?,
    increment_amount = ?,
    start_time = ?,
    end_time = ?,
    description = ?
  WHERE id = ?
`);
const insertAuditStmt = db.prepare(`
  INSERT INTO audits (
    id, event_type, entity_type, entity_id, actor,
    actor_type, request_id, details_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertNotificationStmt = db.prepare(`
  INSERT INTO notification_queue (
    id, channel, event_type, recipient, subject, status, payload_json, created_at, processed_at, error_message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateNotificationStatusStmt = db.prepare(`
  UPDATE notification_queue
  SET status = ?, processed_at = ?, error_message = ?
  WHERE id = ?
`);
const recentAuditsStmt = db.prepare(`
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
  LIMIT ?
`);
const notificationQueueStmt = db.prepare(`
  SELECT
    id,
    channel,
    event_type as eventType,
    recipient,
    subject,
    status,
    payload_json as payload,
    created_at as createdAt,
    processed_at as processedAt,
    error_message as errorMessage
  FROM notification_queue
  ORDER BY datetime(created_at) DESC
  LIMIT ?
`);
const pendingNotificationQueueStmt = db.prepare(`
  SELECT
    id,
    channel,
    event_type as eventType,
    recipient,
    subject,
    status,
    payload_json as payload,
    created_at as createdAt,
    processed_at as processedAt,
    error_message as errorMessage
  FROM notification_queue
  WHERE status = 'pending'
  ORDER BY datetime(created_at) ASC
  LIMIT 10
`);

const getActor = (req: express.Request) => getAuthContext(req).actor;
const getActorRole = (req: express.Request) => getAuthContext(req).role;
const getActorType = (req: express.Request) => getAuthContext(req).actorType;
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
    createdAt: String(row.createdAt),
    archivedAt: row.archivedAt ? String(row.archivedAt) : null
  };
};

const getItems = (includeArchived = false) =>
  ((includeArchived ? getAllItemsStmt : getItemsStmt).all() as Array<Record<string, unknown>>).map(mapItem);
const getItemById = (id: string, includeArchived = false) => {
  const row = getItemByIdStmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const item = mapItem(row);
  if (!includeArchived && item.archivedAt) return null;
  return item;
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
    new Date().toISOString(),
    null,
    null
  );
};

const getCategories = () => (getCategoriesStmt.all() as Array<{ name: string }>).map((row) => row.name);
const getRecentAudits = (limit = 20) =>
  (recentAuditsStmt.all(limit) as Array<Record<string, unknown>>).map((row) => ({
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
const getNotificationQueue = (limit = 20) =>
  (notificationQueueStmt.all(limit) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    channel: String(row.channel),
    eventType: String(row.eventType),
    recipient: String(row.recipient),
    subject: String(row.subject),
    status: String(row.status),
    payload: String(row.payload),
    createdAt: String(row.createdAt),
    processedAt: row.processedAt ? String(row.processedAt) : "",
    errorMessage: row.errorMessage ? String(row.errorMessage) : ""
  }));
const getPendingNotificationQueue = () =>
  (pendingNotificationQueueStmt.all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    channel: String(row.channel),
    eventType: String(row.eventType),
    recipient: String(row.recipient),
    subject: String(row.subject),
    status: String(row.status),
    payload: String(row.payload),
    createdAt: String(row.createdAt),
    processedAt: row.processedAt ? String(row.processedAt) : "",
    errorMessage: row.errorMessage ? String(row.errorMessage) : ""
  }));

const ensureCategory = (name: string) => {
  const value = name.trim();
  if (!value) return;
  insertCategoryStmt.run(value, new Date().toISOString());
};

const deliverNotification = (entry: ReturnType<typeof getPendingNotificationQueue>[number]) => {
  const processedAt = new Date().toISOString();

  if (notificationTransport === "noop") {
    updateNotificationStatusStmt.run("sent", processedAt, null, entry.id);
    return;
  }

  const filePath = path.join(outboxDir, `${processedAt.replace(/[:.]/g, "-")}-${entry.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    id: entry.id,
    channel: entry.channel,
    eventType: entry.eventType,
    recipient: entry.recipient,
    subject: entry.subject,
    payload: JSON.parse(entry.payload || "{}"),
    createdAt: entry.createdAt,
    processedAt
  }, null, 2));
  updateNotificationStatusStmt.run("sent", processedAt, null, entry.id);
};

const processNotificationQueue = () => {
  const entries = getPendingNotificationQueue();
  for (const entry of entries) {
    try {
      deliverNotification(entry);
    } catch (error) {
      updateNotificationStatusStmt.run(
        "failed",
        new Date().toISOString(),
        error instanceof Error ? error.message : "Notification processing failed.",
        entry.id
      );
    }
  }
  return entries.length;
};

const removeStoredFile = (url: string) => {
  if (!url.startsWith("/uploads/")) return;
  const relativePath = url.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(__dirname, relativePath));
  if (!filePath.startsWith(uploadsDir)) return;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
  const rawReserve = (body.reserve || "").trim();
  const reserve = rawReserve ? Number(rawReserve) : 0;
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
  if (!Number.isFinite(reserve) || reserve < 0) {
    return { ok: false as const, error: "Reserve price cannot be negative." };
  }
  if (reserve > 0 && reserve < startBid) {
    return { ok: false as const, error: "Reserve price must be at least the starting bid when provided." };
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

const validateCategoryName = (value: string) => {
  const name = value.trim();
  if (!name) {
    return { ok: false as const, error: "Category name is required." };
  }
  if (name.length > 60) {
    return { ok: false as const, error: "Category name must be 60 characters or fewer." };
  }
  return { ok: true as const, value: name };
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
  if (!canManageItems(req)) {
    res.status(403).json({
      error: adminApiToken
        ? "Admin token required."
        : "Admin access is only available in trusted local testing or with an admin token."
    });
    return;
  }
  next();
};

const canManageItems = (req: express.Request) => {
  return getAuthContext(req).adminAuthorized;
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
      ensureCategory(item.category);
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
      ensureCategory(item.category);
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

const seedCategoriesIfEmpty = () => {
  const categoryCountRow = categoryCountStmt.get() as { count: number };
  if (categoryCountRow.count > 0) return;

  const allCategories = new Set<string>(defaultCategories);
  const itemRows = db.prepare("SELECT DISTINCT category FROM items").all() as Array<{ category: string }>;
  itemRows.forEach((row) => {
    if (row.category) allCategories.add(String(row.category));
  });

  const createdAt = new Date().toISOString();
  for (const category of allCategories) {
    insertCategoryStmt.run(category, createdAt);
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
  const includeArchived = String(req.query.includeArchived || "") === "1";
  if (includeArchived && !canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  res.json(getItems(includeArchived));
});

app.get("/api/items/:id", (req, res) => {
  const includeArchived = String(req.query.includeArchived || "") === "1";
  if (includeArchived && !canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  const item = getItemById(req.params.id, includeArchived);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

app.get("/api/categories", (req, res) => {
  res.json(getCategories());
});

app.post("/api/categories", express.json({ limit: "128kb" }), (req, res) => {
  if (!canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }

  const validation = validateCategoryName(String(req.body?.name || ""));
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const categoriesBefore = new Set(getCategories());
  ensureCategory(validation.value);
  const created = !categoriesBefore.has(validation.value);

  appendAudit(req, {
    eventType: created ? "CATEGORY_CREATED" : "CATEGORY_REUSED",
    entityType: "system",
    entityId: validation.value,
    actor: getActor(req),
    actorType: getActorType(req),
    details: { name: validation.value }
  });

  res.status(created ? 201 : 200).json({ name: validation.value, created });
});

app.delete("/api/categories/:name", (req, res) => {
  if (!canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }

  const validation = validateCategoryName(decodeURIComponent(req.params.name || ""));
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const categories = new Set(getCategories());
  if (!categories.has(validation.value)) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const inUse = Number((categoryInUseStmt.get(validation.value) as { count: number }).count);
  if (inUse > 0) {
    res.status(409).json({ error: "Category is still assigned to auction items." });
    return;
  }

  deleteCategoryStmt.run(validation.value);
  appendAudit(req, {
    eventType: "CATEGORY_DELETED",
    entityType: "system",
    entityId: validation.value,
    actor: getActor(req),
    actorType: getActorType(req),
    details: { name: validation.value }
  });

  res.status(204).send();
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
    actorType: getActorType(req),
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
    actorType: getActorType(req),
    details: { rowCount: rows.length }
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"audit-export.csv\"");
  res.send(toCsv(rows));
});

app.get("/api/me/wins", (req, res) => {
  const actor = getActor(req);
  if (!actor || actor === "anonymous-client") {
    res.json([]);
    return;
  }

  const itemsById = new Map(getItems(true).map((item) => [item.id, item]));
  const closedItems = Array.from(itemsById.values()).filter((item) => new Date(item.endTime).getTime() < Date.now());
  const bidAudits = (db.prepare(`
    SELECT entity_id as itemId, actor, details_json as details, created_at as createdAt
    FROM audits
    WHERE event_type = 'BID_PLACED'
    ORDER BY datetime(created_at) ASC
  `).all() as Array<Record<string, unknown>>).map((row) => {
    let amount = 0;
    try {
      const parsed = JSON.parse(String(row.details || "{}")) as { amount?: number };
      amount = Number(parsed.amount || 0);
    } catch {
      amount = 0;
    }
    return {
      itemId: String(row.itemId),
      actor: String(row.actor),
      amount,
      createdAt: String(row.createdAt)
    };
  });

  const wins = closedItems.flatMap((item) => {
    const itemAudits = bidAudits
      .filter((entry) => entry.itemId === item.id)
      .sort((left, right) => {
        if (left.amount !== right.amount) return right.amount - left.amount;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    const winner = itemAudits[0];
    if (!winner || winner.actor !== actor || winner.amount !== item.currentBid) {
      return [];
    }
    return [{
      id: item.id,
      title: item.title,
      category: item.category,
      lot: item.lot,
      location: item.location,
      currentBid: item.currentBid,
      endTime: item.endTime,
      wonAt: winner.createdAt
    }];
  });

  res.json(wins);
});

app.get("/api/admin/operations", requireAdminToken, (req, res) => {
  const items = getItems(true);
  const nowTime = Date.now();
  const closedCount = items.filter((item) => new Date(item.endTime).getTime() < nowTime && !item.archivedAt).length;
  const liveCount = items.filter((item) => new Date(item.startTime).getTime() <= nowTime && new Date(item.endTime).getTime() >= nowTime && !item.archivedAt).length;
  const archivedCount = items.filter((item) => item.archivedAt).length;
  const pendingNotifications = Number((db.prepare("SELECT COUNT(*) as count FROM notification_queue WHERE status = 'pending'").get() as { count: number }).count);
  const auditCount = Number((db.prepare("SELECT COUNT(*) as count FROM audits").get() as { count: number }).count);

  res.json({
    summary: {
      totalItems: items.length,
      liveCount,
      closedCount,
      archivedCount,
      pendingNotifications,
      auditCount
    },
    recentAudits: getRecentAudits(25),
    notificationQueue: getNotificationQueue(25)
  });
});

app.get("/api/admin/audits", requireAdminToken, (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const itemId = String(req.query.itemId || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 250), 1), 1000);

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
  `).all() as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      eventType: String(row.eventType),
      entityType: String(row.entityType),
      entityId: String(row.entityId),
      actor: String(row.actor),
      actorType: String(row.actorType),
      requestId: String(row.requestId),
      details: String(row.details),
      createdAt: String(row.createdAt)
    }))
    .filter((row) => (!itemId || row.entityId === itemId))
    .filter((row) => (!from || new Date(row.createdAt).getTime() >= new Date(from).getTime()))
    .filter((row) => (!to || new Date(row.createdAt).getTime() <= new Date(to).getTime()))
    .slice(0, limit);

  res.json(rows);
});

app.get("/api/admin/notifications", requireAdminToken, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 250), 1), 1000);
  res.json(getNotificationQueue(limit));
});

app.post("/api/admin/notifications/process", requireAdminToken, (req, res) => {
  const processed = processNotificationQueue();
  res.json({ processed, transport: notificationTransport });
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
        actorType: getActorType(req),
        details: {
          category: validation.value.category,
          lot: validation.value.lot,
          reserve: validation.value.reserve,
          imageCount: images.length,
          documentCount: documents.length
        }
      });
      ensureCategory(validation.value.category);
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

app.patch(
  "/api/items/:id",
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "documents", maxCount: 6 }
  ]),
  (req, res) => {
    if (!canManageItems(req)) {
      res.status(403).json({ error: "Admin role required." });
      return;
    }

    const existing = getItemById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    const body = req.body as Record<string, string>;
    const validation = validateNewItem(body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

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
      updateItemStmt.run(
        validation.value.title,
        validation.value.category,
        validation.value.lot,
        validation.value.sku,
        validation.value.condition,
        validation.value.location,
        validation.value.startBid,
        validation.value.reserve,
        validation.value.increment,
        validation.value.startTime,
        validation.value.endTime,
        validation.value.description,
        existing.id
      );
      for (const image of images) {
        insertItemFileStmt.run(randomUUID(), existing.id, "image", image.name, image.url);
      }
      for (const document of documents) {
        insertItemFileStmt.run(randomUUID(), existing.id, "document", document.name, document.url);
      }
      appendAudit(req, {
        eventType: "ITEM_UPDATED",
        entityType: "item",
        entityId: existing.id,
        actor: getActor(req),
        actorType: getActorType(req),
        details: {
          category: validation.value.category,
          lot: validation.value.lot,
          reserve: validation.value.reserve,
          imageCountAdded: images.length,
          documentCountAdded: documents.length
        }
      });
      ensureCategory(validation.value.category);
      queueNotification("ITEM_UPDATED", `Auction item updated: ${validation.value.title}`, {
        itemId: existing.id,
        title: validation.value.title,
        category: validation.value.category
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const updated = getItemById(existing.id);
    res.json(updated);
  }
);

app.delete("/api/items/:id", (req, res) => {
  if (!canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }

  const existing = getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (existing.archivedAt) {
    res.status(409).json({ error: "Item is already archived." });
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const archivedAt = new Date().toISOString();
    archiveItemStmt.run(archivedAt, existing.id);
    appendAudit(req, {
      eventType: "ITEM_ARCHIVED",
      entityType: "item",
      entityId: existing.id,
      actor: getActor(req),
      actorType: getActorType(req),
      details: {
        title: existing.title,
        lot: existing.lot,
        imageCount: existing.images.length,
        documentCount: existing.documents.length
      }
    });
    queueNotification("ITEM_ARCHIVED", `Auction item archived: ${existing.title}`, {
      itemId: existing.id,
      title: existing.title,
      lot: existing.lot
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  res.status(204).send();
});

app.post("/api/items/:id/restore", (req, res) => {
  if (!canManageItems(req)) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }

  const existing = getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!existing.archivedAt) {
    res.status(409).json({ error: "Item is already active." });
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    restoreItemStmt.run(existing.id);
    appendAudit(req, {
      eventType: "ITEM_RESTORED",
      entityType: "item",
      entityId: existing.id,
      actor: getActor(req),
      actorType: getActorType(req),
      details: {
        title: existing.title,
        lot: existing.lot
      }
    });
    queueNotification("ITEM_RESTORED", `Auction item restored: ${existing.title}`, {
      itemId: existing.id,
      title: existing.title,
      lot: existing.lot
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const restored = getItemById(existing.id, true);
  res.json(restored);
});

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
      actorType: getActorType(req),
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
  seedCategoriesIfEmpty();
  processNotificationQueue();
  setInterval(processNotificationQueue, notificationPollMs);
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
    console.log(`Storage backend: sqlite (${sqlitePath})`);
    console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
  });
};

start();
