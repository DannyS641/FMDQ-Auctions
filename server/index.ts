import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomUUID } from "crypto";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

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

type DatabaseSchema = {
  items: StoredItem[];
  audits: AuditEntry[];
  notificationQueue: NotificationQueueItem[];
};

const dbPath = path.join(dataDir, "auctions.json");
const adapter = new JSONFile<DatabaseSchema>(dbPath);
const db = new Low(adapter, { items: [], audits: [], notificationQueue: [] });

const ensureDb = async () => {
  await db.read();
  db.data ||= { items: [], audits: [], notificationQueue: [] };
  db.data.items ||= [];
  db.data.audits ||= [];
  db.data.notificationQueue ||= [];
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

const getItems = () => db.data?.items ?? [];
const getActor = (req: express.Request) => String(req.header("x-user") || "system");
const getActorRole = (req: express.Request) => String(req.header("x-role") || "Guest");
const recentBidAttempts = new Map<string, number[]>();
const processedBidKeys = new Map<string, string>();

const appendAudit = (
  req: express.Request,
  entry: Omit<AuditEntry, "id" | "createdAt" | "requestId">
) => {
  db.data?.audits.unshift({
    id: randomUUID(),
    requestId: String((req as express.Request & { requestId?: string }).requestId || ""),
    createdAt: new Date().toISOString(),
    ...entry
  });
};

const queueNotification = (
  eventType: string,
  subject: string,
  payload: Record<string, string | number | boolean>
) => {
  db.data?.notificationQueue.unshift({
    id: randomUUID(),
    channel: "email",
    eventType,
    recipient: notificationRecipient,
    subject,
    status: "pending",
    payload,
    createdAt: new Date().toISOString()
  });
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

const seedIfEmpty = async () => {
  await ensureDb();
  if (db.data.items.length) return;

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

  db.data.items = seedItems;
  db.data.audits.unshift({
    id: randomUUID(),
    eventType: "SYSTEM_SEED",
    entityType: "system",
    entityId: "seed",
    actor: "system",
    actorType: "system",
    requestId: "seed",
    details: { itemCount: seedItems.length },
    createdAt: new Date().toISOString()
  });
  await db.write();
};

app.get("/api/health", async (req, res) => {
  await ensureDb();
  res.json({
    status: "ok",
    items: db.data.items.length,
    audits: db.data.audits.length,
    notificationQueue: db.data.notificationQueue.length
  });
});

app.get("/api/items", async (req, res) => {
  await ensureDb();
  const items = getItems().slice().sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(items);
});

app.get("/api/items/:id", async (req, res) => {
  await ensureDb();
  const item = getItems().find((entry) => entry.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

app.get("/api/exports/items.csv", requireAdminToken, async (req, res) => {
  await ensureDb();
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
  await db.write();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"items-export.csv\"");
  res.send(toCsv(rows));
});

app.get("/api/exports/audits.csv", requireAdminToken, async (req, res) => {
  await ensureDb();
  const rows = db.data.audits.map((entry) => ({
    id: entry.id,
    eventType: entry.eventType,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actor: entry.actor,
    actorType: entry.actorType,
    requestId: entry.requestId,
    details: JSON.stringify(entry.details),
    createdAt: entry.createdAt
  }));
  appendAudit(req, {
    eventType: "AUDIT_EXPORT",
    entityType: "export",
    entityId: "audits.csv",
    actor: getActor(req),
    actorType: "user",
    details: { rowCount: rows.length }
  });
  await db.write();
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
  async (req, res) => {
    await ensureDb();
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

    const images = ((req.files as Record<string, Express.Multer.File[]>)?.images || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/images/${file.filename}`
    }));

    const documents = ((req.files as Record<string, Express.Multer.File[]>)?.documents || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/documents/${file.filename}`
    }));

    const item: StoredItem = {
      id: `LOT-${Math.floor(1000 + Math.random() * 9000)}`,
      ...validation.value,
      currentBid: 0,
      images,
      documents,
      bids: [],
      createdAt: new Date().toISOString()
    };

    db.data.items.unshift(item);
    appendAudit(req, {
      eventType: "ITEM_CREATED",
      entityType: "item",
      entityId: item.id,
      actor: getActor(req),
      actorType: "user",
      details: {
        category: item.category,
        lot: item.lot,
        reserve: item.reserve,
        imageCount: item.images.length,
        documentCount: item.documents.length
      }
    });
    queueNotification("ITEM_CREATED", `Auction item created: ${item.title}`, {
      itemId: item.id,
      title: item.title,
      category: item.category
    });
    await db.write();

    res.status(201).json(item);
  }
);

app.post("/api/items/:id/bids", async (req, res) => {
  await ensureDb();
  const items = getItems();
  const index = items.findIndex((entry) => entry.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const amount = Number(req.body.amount || 0);
  const expectedCurrentBid = Number(req.body.expectedCurrentBid || 0);
  const actor = getActor(req);
  const idempotencyKey = String(req.header("x-idempotency-key") || "");

  if (!checkBidRateLimit(actor, req.params.id)) {
    res.status(429).json({ error: "Too many bid attempts. Please wait and try again." });
    return;
  }

  if (idempotencyKey && processedBidKeys.get(idempotencyKey) === items[index].id) {
    res.status(409).json({ error: "Duplicate bid submission detected." });
    return;
  }

  if (expectedCurrentBid !== items[index].currentBid) {
    res.status(409).json({ error: "Auction state changed. Refresh and submit your bid again." });
    return;
  }

  const validation = validateBid(items[index], amount);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const createdAt = new Date().toISOString();
  const bidSequence = items[index].bids.length + 1;
  const bid: StoredBid = {
    bidder: `Bidder-${String(bidSequence).padStart(3, "0")}`,
    amount,
    time: formatBidTime(createdAt),
    createdAt
  };

  items[index].bids.unshift(bid);
  items[index].currentBid = amount;
  if (idempotencyKey) {
    processedBidKeys.set(idempotencyKey, items[index].id);
  }
  appendAudit(req, {
    eventType: "BID_PLACED",
    entityType: "bid",
    entityId: items[index].id,
    actor,
    actorType: "user",
    details: {
      amount,
      bidSequence,
      auctionItemId: items[index].id
    }
  });
  queueNotification("BID_PLACED", `Bid accepted for ${items[index].title}`, {
    itemId: items[index].id,
    amount,
    bidSequence
  });
  await db.write();

  res.json(items[index]);
});

const start = async () => {
  await ensureDb();
  await seedIfEmpty();
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
  });
};

start();
