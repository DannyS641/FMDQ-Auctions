import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { Pool, type PoolClient } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnvFile = () => {
  const envPath = path.join(path.dirname(__dirname), ".env");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 0) continue;
    const key = line.slice(0, equalsAt).trim();
    if (process.env[key]) continue;
    process.env[key] = line.slice(equalsAt + 1).trim().replace(/^['"]|['"]$/g, "");
  }
};

loadEnvFile();

const app = express();
const port = Number(process.env.PORT || 5174);
const sessionCookieName = "fmdq_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const emailVerificationTtlMs = 24 * 60 * 60 * 1000;
const adminApiToken = process.env.ADMIN_API_TOKEN || "";
const notificationRecipient = process.env.NOTIFY_TO || "operations@fmdq.example";
const notificationTransport = (process.env.NOTIFY_TRANSPORT || "file").toLowerCase();
const notificationPollMs = Math.max(Number(process.env.NOTIFY_POLL_MS || 5000), 1000);
const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
const supabaseDbUrl = process.env.SUPABASE_DB_URL || "";
const bidRateWindowMs = 60_000;
const bidRateLimit = 12;

if (!supabaseDbUrl) {
  throw new Error("SUPABASE_DB_URL is required for the backend.");
}

const dataDir = path.join(__dirname, "data");
const outboxDir = path.join(dataDir, "notification-outbox");
const uploadsDir = path.join(__dirname, "uploads");
const imagesDir = path.join(uploadsDir, "images");
const docsDir = path.join(uploadsDir, "documents");

[dataDir, outboxDir, uploadsDir, imagesDir, docsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const pool = new Pool({
  connectionString: supabaseDbUrl,
  ssl: { rejectUnauthorized: false }
});

app.disable("x-powered-by");
app.use(cors({ origin: true, credentials: true }));
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
  eventType: string;
  entityType: "item" | "bid" | "system" | "export";
  entityId: string;
  actor: string;
  actorType: "system" | "user" | "integration";
  details: Record<string, string | number | boolean>;
};

type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  status: "pending_verification" | "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
};

type Role = "Guest" | "Bidder" | "Observer" | "Admin";

type AuthContext = {
  userId?: string;
  actor: string;
  actorType: "system" | "user" | "integration";
  role: Role;
  trusted: boolean;
  adminAuthorized: boolean;
  signedIn: boolean;
};

type NotificationQueueItem = {
  id: string;
  channel: "email";
  eventType: string;
  recipient: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  processedAt?: string | null;
  errorMessage?: string | null;
};

const defaultCategories = [
  "Cars",
  "Furniture",
  "Household Appliances",
  "Kitchen Appliances",
  "Phones",
  "Other"
];

const seedItems: Array<Omit<StoredItem, "images" | "documents"> & { images: StoredFileRef[]; documents: StoredFileRef[] }> = (() => {
  const now = Date.now();
  return [
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
})();

const parseCookies = (req: express.Request) =>
  String(req.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [key, ...rest] = entry.split("=");
      if (!key) return acc;
      acc[key] = decodeURIComponent(rest.join("="));
      return acc;
    }, {});

const normalizeRole = (roles: string[]): Role => {
  if (roles.includes("Admin")) return "Admin";
  if (roles.includes("Observer")) return "Observer";
  if (roles.includes("Bidder")) return "Bidder";
  return "Guest";
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-");
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const sanitizeDisplayName = (value: string) => value.trim().replace(/\s+/g, " ");
const buildEmailVerificationUrl = (token: string) => `${appBaseUrl}/verify.html?token=${encodeURIComponent(token)}`;

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
    cb(null, file.fieldname === "documents" ? docsDir : imagesDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { files: 16, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = file.fieldname === "images" && allowedImageTypes.has(file.mimetype);
    const isDocument = file.fieldname === "documents" && allowedDocumentTypes.has(file.mimetype);
    cb(null, isImage || isDocument);
  }
});

const recentBidAttempts = new Map<string, number[]>();
const processedBidKeys = new Map<string, string>();

const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, storedHash: string) => {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
};

const setSessionCookie = (res: express.Response, sessionId: string, expiresAt: string) => {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`
  );
};

const clearSessionCookie = (res: express.Response) => {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}${secure ? "; Secure" : ""}`
  );
};

const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], client?: PoolClient) => {
  const executor = client || pool;
  const result = await executor.query(sql, params);
  return result.rows as T[];
};

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], client?: PoolClient) => {
  const rows = await query<T>(sql, params, client);
  return rows[0];
};

const removeStoredFile = (url: string) => {
  if (!url.startsWith("/uploads/")) return;
  const filePath = path.normalize(path.join(__dirname, url.replace(/^\/+/, "")));
  if (!filePath.startsWith(uploadsDir)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const formatBidTime = (createdAt: string) =>
  new Date(createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

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
    value: { title, category, lot, sku, condition, location, description, startBid, reserve, increment, startTime, endTime }
  };
};

const validateCategoryName = (value: string) => {
  const name = value.trim();
  if (!name) return { ok: false as const, error: "Category name is required." };
  if (name.length > 60) return { ok: false as const, error: "Category name must be 60 characters or fewer." };
  return { ok: true as const, value: name };
};

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
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(","))].join("\n");
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

const asyncHandler = (
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  void fn(req, res, next).catch(next);
};

const getAuthContext = async (req: express.Request): Promise<AuthContext> => {
  if (adminApiToken && req.header("x-admin-token") === adminApiToken) {
    return {
      userId: "admin-token",
      actor: "Admin API token",
      actorType: "integration",
      role: "Admin",
      trusted: true,
      adminAuthorized: true,
      signedIn: true
    };
  }

  const sessionId = parseCookies(req)[sessionCookieName];
  if (!sessionId) {
    return {
      actor: "anonymous-client",
      actorType: "system",
      role: "Guest",
      trusted: false,
      adminAuthorized: false,
      signedIn: false
    };
  }

  const sessionRow = await one<{ id: string; userid: string; expiresat: string }>(
    `select id, user_id as userId, expires_at as expiresAt from public.sessions where id = $1`,
    [sessionId]
  );
  if (!sessionRow || new Date(sessionRow.expiresat).getTime() <= Date.now()) {
    await query(`delete from public.sessions where id = $1`, [sessionId]).catch(() => undefined);
    return {
      actor: "anonymous-client",
      actorType: "system",
      role: "Guest",
      trusted: false,
      adminAuthorized: false,
      signedIn: false
    };
  }

  const user = await one<{ id: string; email: string; displayname: string; status: string }>(
    `select id, email, display_name as displayName, status from public.users where id = $1`,
    [sessionRow.userid]
  );
  if (!user || user.status !== "active") {
    await query(`delete from public.sessions where id = $1`, [sessionId]).catch(() => undefined);
    return {
      actor: "anonymous-client",
      actorType: "system",
      role: "Guest",
      trusted: false,
      adminAuthorized: false,
      signedIn: false
    };
  }

  const roles = await query<{ rolename: string }>(
    `select role_name as roleName from public.user_roles where user_id = $1`,
    [user.id]
  );
  const role = normalizeRole(roles.map((row) => row.rolename));
  return {
    userId: user.id,
    actor: String(user.displayname || user.email),
    actorType: "user",
    role,
    trusted: true,
    adminAuthorized: role === "Admin",
    signedIn: true
  };
};

const serializeSession = async (req: express.Request): Promise<(StoredUser & { role: Role }) | null> => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) return null;
  const row = await one<{
    id: string;
    email: string;
    displayname: string;
    status: StoredUser["status"];
    createdat: string;
    lastloginat: string | null;
  }>(
    `select id, email, display_name as displayName, status, created_at as createdAt, last_login_at as lastLoginAt
     from public.users where id = $1`,
    [auth.userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayname || (row as unknown as { displayName: string }).displayName,
    status: row.status,
    createdAt: row.createdat || (row as unknown as { createdAt: string }).createdAt,
    lastLoginAt: row.lastloginat || (row as unknown as { lastLoginAt: string | null }).lastLoginAt,
    role: auth.role
  };
};

const createUserSession = async (res: express.Response, userId: string) => {
  const sessionId = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  await query(
    `insert into public.sessions (id, user_id, created_at, expires_at) values ($1, $2, $3, $4)`,
    [sessionId, userId, createdAt, expiresAt]
  );
  setSessionCookie(res, sessionId, expiresAt);
};

const createEmailVerificationToken = async (userId: string) => {
  const token = randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + emailVerificationTtlMs).toISOString();
  await query(`delete from public.email_verification_tokens where user_id = $1`, [userId]);
  await query(
    `insert into public.email_verification_tokens (id, user_id, token, created_at, expires_at) values ($1, $2, $3, $4, $5)`,
    [randomUUID(), userId, token, createdAt, expiresAt]
  );
  return { token, createdAt, expiresAt, verifyUrl: buildEmailVerificationUrl(token) };
};

const appendAudit = async (req: express.Request, entry: AuditEntry, client?: PoolClient) => {
  await query(
    `insert into public.audits (
      id, event_type, entity_type, entity_id, actor, actor_type, request_id, details_json, created_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      randomUUID(),
      entry.eventType,
      entry.entityType,
      entry.entityId,
      entry.actor,
      entry.actorType,
      String((req as express.Request & { requestId?: string }).requestId || ""),
      JSON.stringify(entry.details),
      new Date().toISOString()
    ],
    client
  );
};

const queueNotification = async (
  eventType: string,
  subject: string,
  payload: Record<string, unknown>,
  client?: PoolClient
) => {
  await query(
    `insert into public.notification_queue (
      id, channel, event_type, recipient, subject, status, payload_json, created_at, processed_at, error_message
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
    [
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
    ],
    client
  );
};

const getCategories = async () => {
  const rows = await query<{ name: string }>(`select name from public.categories order by lower(name) asc`);
  return rows.map((row) => row.name);
};

const mapFiles = (rows: Array<{ kind: string; name: string; url: string }>) => ({
  images: rows.filter((row) => row.kind === "image").map(({ name, url }) => ({ name, url })),
  documents: rows.filter((row) => row.kind === "document").map(({ name, url }) => ({ name, url }))
});

const getItemFiles = async (itemId: string, client?: PoolClient) =>
  query<{ kind: string; name: string; url: string }>(
    `select kind, name, url from public.item_files where item_id = $1 order by name asc`,
    [itemId],
    client
  );

const getItemBids = async (itemId: string, client?: PoolClient) =>
  query<{ bidder: string; amount: string | number; time: string; createdat: string }>(
    `select bidder_alias as bidder, amount, bid_time as time, created_at as createdAt
     from public.bids
     where item_id = $1
     order by created_at desc, id desc`,
    [itemId],
    client
  );

const mapItemRow = async (row: Record<string, unknown>, client?: PoolClient): Promise<StoredItem> => {
  const itemId = String(row.id);
  const fileRows = await getItemFiles(itemId, client);
  const bidRows = await getItemBids(itemId, client);
  const files = mapFiles(fileRows);
  return {
    id: itemId,
    title: String(row.title),
    category: String(row.category),
    lot: String(row.lot),
    sku: String(row.sku),
    condition: String(row.condition),
    location: String(row.location),
    startBid: Number(row.startbid ?? row.startBid),
    reserve: Number(row.reserve),
    increment: Number(row.incrementamount ?? row.incrementAmount ?? row.increment),
    currentBid: Number(row.currentbid ?? row.currentBid),
    startTime: new Date(String(row.starttime ?? row.startTime)).toISOString(),
    endTime: new Date(String(row.endtime ?? row.endTime)).toISOString(),
    description: String(row.description || ""),
    images: files.images,
    documents: files.documents,
    bids: bidRows.map((bid) => ({
      bidder: bid.bidder,
      amount: Number(bid.amount),
      time: bid.time,
      createdAt: String(bid.createdat || (bid as unknown as { createdAt: string }).createdAt)
    })),
    createdAt: new Date(String(row.createdat ?? row.createdAt)).toISOString(),
    archivedAt: row.archivedat ?? row.archivedAt ? new Date(String(row.archivedat ?? row.archivedAt)).toISOString() : null
  };
};

const getItems = async (includeArchived = false, client?: PoolClient) => {
  const rows = await query<Record<string, unknown>>(
    `select
      id, title, category, lot, sku, condition, location,
      start_bid as startBid, reserve, increment_amount as incrementAmount,
      current_bid as currentBid, start_time as startTime, end_time as endTime,
      description, created_at as createdAt, archived_at as archivedAt
     from public.items
     ${includeArchived ? "" : "where archived_at is null"}
     order by archived_at nulls first, created_at desc`,
    [],
    client
  );
  return Promise.all(rows.map((row) => mapItemRow(row, client)));
};

const getItemById = async (id: string, includeArchived = false, client?: PoolClient) => {
  const row = await one<Record<string, unknown>>(
    `select
      id, title, category, lot, sku, condition, location,
      start_bid as startBid, reserve, increment_amount as incrementAmount,
      current_bid as currentBid, start_time as startTime, end_time as endTime,
      description, created_at as createdAt, archived_at as archivedAt
     from public.items
     where id = $1`,
    [id],
    client
  );
  if (!row) return null;
  if (!includeArchived && row.archivedAt) return null;
  return mapItemRow(row, client);
};

const getRecentAudits = async (limit = 20) =>
  query<{
    id: string; eventtype: string; entitytype: string; entityid: string; actor: string; actortype: string;
    requestid: string; detailsjson: Record<string, unknown>; createdat: string;
  }>(
    `select
      id,
      event_type as eventType,
      entity_type as entityType,
      entity_id as entityId,
      actor,
      actor_type as actorType,
      request_id as requestId,
      details_json as detailsJson,
      created_at as createdAt
     from public.audits
     order by created_at desc
     limit $1`,
    [limit]
  ).then((rows) =>
    rows.map((row) => ({
      id: row.id,
      eventType: (row as unknown as { eventType: string }).eventType || row.eventtype,
      entityType: (row as unknown as { entityType: string }).entityType || row.entitytype,
      entityId: (row as unknown as { entityId: string }).entityId || row.entityid,
      actor: row.actor,
      actorType: (row as unknown as { actorType: string }).actorType || row.actortype,
      requestId: (row as unknown as { requestId: string }).requestId || row.requestid,
      details: row.detailsjson || (row as unknown as { detailsJson: Record<string, unknown> }).detailsJson || {},
      createdAt: (row as unknown as { createdAt: string }).createdAt || row.createdat
    }))
  );

const getNotificationQueue = async (limit = 20) =>
  query<{
    id: string; channel: "email"; eventtype: string; recipient: string; subject: string; status: "pending" | "sent" | "failed";
    payloadjson: Record<string, unknown>; createdat: string; processedat: string | null; errormessage: string | null;
  }>(
    `select
      id,
      channel,
      event_type as eventType,
      recipient,
      subject,
      status,
      payload_json as payloadJson,
      created_at as createdAt,
      processed_at as processedAt,
      error_message as errorMessage
     from public.notification_queue
     order by created_at desc
     limit $1`,
    [limit]
  ).then((rows) =>
    rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      eventType: (row as unknown as { eventType: string }).eventType || row.eventtype,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      payload: row.payloadjson || (row as unknown as { payloadJson: Record<string, unknown> }).payloadJson || {},
      createdAt: (row as unknown as { createdAt: string }).createdAt || row.createdat,
      processedAt: (row as unknown as { processedAt: string | null }).processedAt || row.processedat,
      errorMessage: (row as unknown as { errorMessage: string | null }).errorMessage || row.errormessage
    }))
  );

const getPendingNotificationQueue = async () => {
  const rows = await query<{
    id: string; channel: "email"; eventtype: string; recipient: string; subject: string; status: "pending" | "sent" | "failed";
    payloadjson: Record<string, unknown>; createdat: string; processedat: string | null; errormessage: string | null;
  }>(
    `select
      id,
      channel,
      event_type as eventType,
      recipient,
      subject,
      status,
      payload_json as payloadJson,
      created_at as createdAt,
      processed_at as processedAt,
      error_message as errorMessage
     from public.notification_queue
     where status = 'pending'
     order by created_at asc
     limit 10`
  );
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    eventType: (row as unknown as { eventType: string }).eventType || row.eventtype,
    recipient: row.recipient,
    subject: row.subject,
    status: row.status,
    payload: row.payloadjson || (row as unknown as { payloadJson: Record<string, unknown> }).payloadJson || {},
    createdAt: (row as unknown as { createdAt: string }).createdAt || row.createdat,
    processedAt: (row as unknown as { processedAt: string | null }).processedAt || row.processedat,
    errorMessage: (row as unknown as { errorMessage: string | null }).errorMessage || row.errormessage
  }));
};

const deliverNotification = async (entry: NotificationQueueItem) => {
  const processedAt = new Date().toISOString();
  if (notificationTransport === "noop") {
    await query(
      `update public.notification_queue set status = 'sent', processed_at = $1, error_message = null where id = $2`,
      [processedAt, entry.id]
    );
    return;
  }
  const filePath = path.join(outboxDir, `${processedAt.replace(/[:.]/g, "-")}-${entry.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    id: entry.id,
    channel: entry.channel,
    eventType: entry.eventType,
    recipient: entry.recipient,
    subject: entry.subject,
    payload: entry.payload,
    createdAt: entry.createdAt,
    processedAt
  }, null, 2));
  await query(
    `update public.notification_queue set status = 'sent', processed_at = $1, error_message = null where id = $2`,
    [processedAt, entry.id]
  );
};

const processNotificationQueue = async () => {
  const entries = await getPendingNotificationQueue();
  for (const entry of entries) {
    try {
      await deliverNotification(entry);
    } catch (error) {
      await query(
        `update public.notification_queue set status = 'failed', processed_at = $1, error_message = $2 where id = $3`,
        [new Date().toISOString(), error instanceof Error ? error.message : "Notification processing failed.", entry.id]
      );
    }
  }
  return entries.length;
};

const seedRoles = async () => {
  for (const role of ["Admin", "Bidder", "Observer"]) {
    await query(`insert into public.roles (name) values ($1) on conflict (name) do nothing`, [role]);
  }
};

const seedCategoriesIfEmpty = async () => {
  const countRow = await one<{ count: string }>(`select count(*)::text as count from public.categories`);
  if (Number(countRow?.count || 0) > 0) return;
  for (const category of defaultCategories) {
    await query(`insert into public.categories (name) values ($1) on conflict (name) do nothing`, [category]);
  }
};

const seedItemsIfEmpty = async () => {
  const countRow = await one<{ count: string }>(`select count(*)::text as count from public.items`);
  if (Number(countRow?.count || 0) > 0) return;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const item of seedItems) {
      await client.query(
        `insert into public.items (
          id, title, category, lot, sku, condition, location,
          start_bid, reserve, increment_amount, current_bid,
          start_time, end_time, description, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
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
        ]
      );
      for (const bid of item.bids) {
        await client.query(
          `insert into public.bids (id, item_id, bidder_alias, amount, bid_time, created_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), item.id, bid.bidder, bid.amount, bid.time, bid.createdAt]
        );
      }
    }
    await client.query(
      `insert into public.audits (
        id, event_type, entity_type, entity_id, actor, actor_type, request_id, details_json, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [randomUUID(), "SYSTEM_SEED", "system", "seed", "system", "system", "seed", JSON.stringify({ itemCount: seedItems.length }), new Date().toISOString()]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

const canManageItems = async (req: express.Request) => (await getAuthContext(req)).adminAuthorized;

const requireAdminToken = asyncHandler(async (req, res, next) => {
  if (!(await canManageItems(req))) {
    res.status(403).json({
      error: adminApiToken ? "Admin token required." : "Admin access requires an authenticated account with the Admin role."
    });
    return;
  }
  next();
});

app.get("/api/health", asyncHandler(async (req, res) => {
  const itemsCount = await one<{ count: string }>(`select count(*)::text as count from public.items`);
  const auditsCount = await one<{ count: string }>(`select count(*)::text as count from public.audits`);
  const queueCount = await one<{ count: string }>(`select count(*)::text as count from public.notification_queue`);
  res.json({
    status: "ok",
    storage: "supabase-postgres",
    items: Number(itemsCount?.count || 0),
    audits: Number(auditsCount?.count || 0),
    notificationQueue: Number(queueCount?.count || 0)
  });
}));

app.get("/api/auth/me", asyncHandler(async (req, res) => {
  const session = await serializeSession(req);
  res.json(session ? { signedIn: true, user: session } : { signedIn: false, user: null });
}));

app.post("/api/auth/register", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  const displayName = sanitizeDisplayName(String(req.body?.displayName || ""));

  if (!email || !displayName || !password) {
    res.status(400).json({ error: "Display name, email, and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  const existing = await one<{ id: string }>(`select id from public.users where lower(email) = lower($1)`, [email]);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const userId = randomUUID();
  const createdAt = new Date().toISOString();
  await query(
    `insert into public.users (id, email, password_hash, display_name, status, created_at, last_login_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, email, hashPassword(password), displayName, "pending_verification", createdAt, null]
  );
  await query(`insert into public.user_roles (user_id, role_name, created_at) values ($1,$2,$3) on conflict do nothing`, [userId, "Bidder", createdAt]);
  const verification = await createEmailVerificationToken(userId);
  await queueNotification("ACCOUNT_VERIFICATION", "Confirm your FMDQ Auctions account", {
    email,
    displayName,
    verifyUrl: verification.verifyUrl
  });
  await appendAudit(req, {
    eventType: "ACCOUNT_REGISTERED",
    entityType: "system",
    entityId: userId,
    actor: displayName,
    actorType: "user",
    details: { email, status: "pending_verification" }
  });

  res.status(201).json({
    registered: true,
    verificationRequired: true,
    email,
    message: "Account created. Check your email to verify your account, then sign in."
  });
}));

app.post("/api/auth/login", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  const user = await one<{
    id: string; email: string; passwordhash: string; displayname: string; status: string; createdat: string; lastloginat: string | null;
  }>(
    `select
      id,
      email,
      password_hash as passwordHash,
      display_name as displayName,
      status,
      created_at as createdAt,
      last_login_at as lastLoginAt
     from public.users
     where lower(email) = lower($1)`,
    [email]
  );

  if (!user || !verifyPassword(password, String(user.passwordhash || (user as unknown as { passwordHash: string }).passwordHash || ""))) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  if (user.status === "pending_verification") {
    res.status(403).json({ error: "Please verify your email before signing in." });
    return;
  }
  if (user.status !== "active") {
    res.status(403).json({ error: "This account is not active." });
    return;
  }

  const lastLoginAt = new Date().toISOString();
  await query(`update public.users set last_login_at = $1 where id = $2`, [lastLoginAt, user.id]);
  await createUserSession(res, user.id);
  const roles = await query<{ rolename: string }>(`select role_name as roleName from public.user_roles where user_id = $1`, [user.id]);
  const role = normalizeRole(roles.map((row) => row.rolename));

  res.json({
    signedIn: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayname || (user as unknown as { displayName: string }).displayName,
      status: user.status,
      createdAt: user.createdat || (user as unknown as { createdAt: string }).createdAt,
      lastLoginAt,
      role
    }
  });
}));

app.post("/api/auth/verify-email", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Verification token is required." });
    return;
  }
  const row = await one<{ userid: string; expiresat: string }>(
    `select user_id as userId, expires_at as expiresAt from public.email_verification_tokens where token = $1`,
    [token]
  );
  if (!row) {
    res.status(404).json({ error: "Verification link is invalid or has already been used." });
    return;
  }
  if (new Date(row.expiresat || (row as unknown as { expiresAt: string }).expiresAt).getTime() <= Date.now()) {
    await query(`delete from public.email_verification_tokens where token = $1`, [token]);
    res.status(410).json({ error: "Verification link has expired. Please create your account again or request a new link." });
    return;
  }

  const user = await one<{ id: string; email: string; displayname: string }>(
    `select id, email, display_name as displayName from public.users where id = $1`,
    [row.userid || (row as unknown as { userId: string }).userId]
  );
  if (!user) {
    await query(`delete from public.email_verification_tokens where token = $1`, [token]);
    res.status(404).json({ error: "Account not found for this verification link." });
    return;
  }

  await query(`update public.users set status = 'active' where id = $1`, [user.id]);
  await query(`delete from public.email_verification_tokens where user_id = $1`, [user.id]);
  await queueNotification("ACCOUNT_VERIFIED", "FMDQ Auctions account verified", {
    email: user.email,
    displayName: user.displayname || (user as unknown as { displayName: string }).displayName
  });
  await appendAudit(req, {
    eventType: "ACCOUNT_VERIFIED",
    entityType: "system",
    entityId: user.id,
    actor: user.displayname || (user as unknown as { displayName: string }).displayName,
    actorType: "user",
    details: { email: user.email, status: "active" }
  });
  res.json({ verified: true, message: "Your account has been verified. You can now sign in." });
}));

app.post("/api/auth/logout", asyncHandler(async (req, res) => {
  const sessionId = parseCookies(req)[sessionCookieName];
  if (sessionId) {
    await query(`delete from public.sessions where id = $1`, [sessionId]);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/items", asyncHandler(async (req, res) => {
  const includeArchived = String(req.query.includeArchived || "") === "1";
  if (includeArchived && !(await canManageItems(req))) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  res.json(await getItems(includeArchived));
}));

app.get("/api/items/:id", asyncHandler(async (req, res) => {
  const includeArchived = String(req.query.includeArchived || "") === "1";
  if (includeArchived && !(await canManageItems(req))) {
    res.status(403).json({ error: "Admin role required." });
    return;
  }
  const item = await getItemById(req.params.id, includeArchived);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}));

app.get("/api/categories", asyncHandler(async (req, res) => {
  res.json(await getCategories());
}));

app.post("/api/categories", express.json({ limit: "128kb" }), requireAdminToken, asyncHandler(async (req, res) => {
  const validation = validateCategoryName(String(req.body?.name || ""));
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const before = new Set(await getCategories());
  await query(`insert into public.categories (name) values ($1) on conflict (name) do nothing`, [validation.value]);
  const created = !before.has(validation.value);
  await appendAudit(req, {
    eventType: created ? "CATEGORY_CREATED" : "CATEGORY_RECONFIRMED",
    entityType: "system",
    entityId: validation.value,
    actor: (await getAuthContext(req)).actor,
    actorType: (await getAuthContext(req)).actorType,
    details: { category: validation.value, created }
  });
  res.status(created ? 201 : 200).json({ created });
}));

app.delete("/api/categories/:name", requireAdminToken, asyncHandler(async (req, res) => {
  const validation = validateCategoryName(req.params.name);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const count = await one<{ count: string }>(`select count(*)::text as count from public.items where category = $1`, [validation.value]);
  if (Number(count?.count || 0) > 0) {
    res.status(409).json({ error: "Category is assigned to one or more items." });
    return;
  }
  const existing = new Set(await getCategories());
  if (!existing.has(validation.value)) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  await query(`delete from public.categories where name = $1`, [validation.value]);
  const auth = await getAuthContext(req);
  await appendAudit(req, {
    eventType: "CATEGORY_DELETED",
    entityType: "system",
    entityId: validation.value,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { category: validation.value }
  });
  res.json({ ok: true });
}));

app.get("/api/exports/items.csv", requireAdminToken, asyncHandler(async (req, res) => {
  const rows = (await getItems()).map((item) => ({
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
    bidCount: item.bids.length
  }));
  const auth = await getAuthContext(req);
  await appendAudit(req, {
    eventType: "EXPORT_ITEMS",
    entityType: "export",
    entityId: "items.csv",
    actor: auth.actor,
    actorType: auth.actorType,
    details: { rowCount: rows.length }
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="items.csv"');
  res.send(toCsv(rows));
}));

app.get("/api/exports/audits.csv", requireAdminToken, asyncHandler(async (req, res) => {
  const rows = await query<Record<string, unknown>>(
    `select
      id, event_type as "eventType", entity_type as "entityType", entity_id as "entityId",
      actor, actor_type as "actorType", request_id as "requestId",
      details_json as "detailsJson", created_at as "createdAt"
     from public.audits
     order by created_at desc`
  );
  const formatted = rows.map((row) => ({
    id: String(row.id),
    eventType: String(row.eventType),
    entityType: String(row.entityType),
    entityId: String(row.entityId),
    actor: String(row.actor),
    actorType: String(row.actorType),
    requestId: String(row.requestId),
    details: typeof row.detailsJson === "object" ? JSON.stringify(row.detailsJson) : String(row.detailsJson),
    createdAt: String(row.createdAt)
  }));
  const auth = await getAuthContext(req);
  await appendAudit(req, {
    eventType: "EXPORT_AUDITS",
    entityType: "export",
    entityId: "audits.csv",
    actor: auth.actor,
    actorType: auth.actorType,
    details: { rowCount: formatted.length }
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="audits.csv"');
  res.send(toCsv(formatted));
}));

app.get("/api/me/wins", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const itemsById = new Map((await getItems(true)).map((item) => [item.id, item]));
  const bidAudits = await query<{
    entityid: string;
    detailsjson: Record<string, unknown>;
  }>(
    `select entity_id as entityId, details_json as detailsJson
     from public.audits
     where event_type = 'BID_PLACED' and actor = $1
     order by created_at desc`,
    [auth.actor]
  );
  const wins = bidAudits.flatMap((row) => {
    const entityId = String((row as unknown as { entityId: string }).entityId || row.entityid);
    const details = (row as unknown as { detailsJson: Record<string, unknown> }).detailsJson || row.detailsjson || {};
    const item = itemsById.get(entityId);
    if (!item) return [];
    const closed = new Date(item.endTime).getTime() < Date.now();
    const won = closed && item.currentBid > 0 && Number(details.amount || 0) === item.currentBid;
    return won ? [{
      id: item.id,
      title: item.title,
      category: item.category,
      currentBid: item.currentBid,
      endTime: item.endTime
    }] : [];
  });
  const unique = Array.from(new Map(wins.map((win) => [win.id, win])).values());
  res.json(unique);
}));

app.get("/api/admin/operations", requireAdminToken, asyncHandler(async (req, res) => {
  const items = await getItems(true);
  const pendingNotifications = await one<{ count: string }>(
    `select count(*)::text as count from public.notification_queue where status = 'pending'`
  );
  const auditCount = await one<{ count: string }>(`select count(*)::text as count from public.audits`);
  const wins = await query(`select count(*)::text as count from public.audits where event_type = 'BID_PLACED'`);
  res.json({
    metrics: {
      totalItems: items.length,
      liveItems: items.filter((item) => new Date(item.startTime).getTime() <= Date.now() && new Date(item.endTime).getTime() >= Date.now() && !item.archivedAt).length,
      closedItems: items.filter((item) => new Date(item.endTime).getTime() < Date.now() && !item.archivedAt).length,
      archivedItems: items.filter((item) => Boolean(item.archivedAt)).length,
      pendingNotifications: Number(pendingNotifications?.count || 0),
      auditEvents: Number(auditCount?.count || 0),
      wins: Number((wins[0] as { count?: string })?.count || 0)
    },
    recentAudits: await getRecentAudits(20),
    notificationQueue: await getNotificationQueue(20)
  });
}));

app.get("/api/admin/audits", requireAdminToken, asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const values: unknown[] = [];
  const where: string[] = [];
  if (itemId) {
    values.push(itemId);
    where.push(`entity_id = $${values.length}`);
  }
  if (from) {
    values.push(from);
    where.push(`created_at >= $${values.length}::timestamptz`);
  }
  if (to) {
    values.push(to);
    where.push(`created_at <= $${values.length}::timestamptz`);
  }
  const rows = await query(
    `select
      id, event_type as "eventType", entity_type as "entityType", entity_id as "entityId",
      actor, actor_type as "actorType", request_id as "requestId",
      details_json as "detailsJson", created_at as "createdAt"
     from public.audits
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit 200`,
    values
  );
  res.json(rows);
}));

app.get("/api/admin/notifications", requireAdminToken, asyncHandler(async (req, res) => {
  res.json(await getNotificationQueue(200));
}));

app.post("/api/admin/notifications/process", requireAdminToken, asyncHandler(async (req, res) => {
  const processed = await processNotificationQueue();
  res.json({ processed, transport: notificationTransport });
}));

app.post("/api/items", requireAdminToken, upload.fields([{ name: "images", maxCount: 8 }, { name: "documents", maxCount: 8 }]), asyncHandler(async (req, res) => {
  const body = req.body as Record<string, string>;
  const validation = validateNewItem(body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const itemId = randomUUID();
  const createdAt = new Date().toISOString();
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const images = files?.images || [];
  const documents = files?.documents || [];
  const auth = await getAuthContext(req);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into public.categories (name) values ($1) on conflict (name) do nothing`, [validation.value.category]);
    await client.query(
      `insert into public.items (
        id, title, category, lot, sku, condition, location,
        start_bid, reserve, increment_amount, current_bid,
        start_time, end_time, description, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
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
      ]
    );
    for (const image of images) {
      await client.query(
        `insert into public.item_files (id, item_id, kind, name, url) values ($1,$2,$3,$4,$5)`,
        [randomUUID(), itemId, "image", image.originalname, `/uploads/images/${path.basename(image.path)}`]
      );
    }
    for (const document of documents) {
      await client.query(
        `insert into public.item_files (id, item_id, kind, name, url) values ($1,$2,$3,$4,$5)`,
        [randomUUID(), itemId, "document", document.originalname, `/uploads/documents/${path.basename(document.path)}`]
      );
    }
    await appendAudit(req, {
      eventType: "ITEM_CREATED",
      entityType: "item",
      entityId: itemId,
      actor: auth.actor,
      actorType: auth.actorType,
      details: {
        title: validation.value.title,
        category: validation.value.category,
        lot: validation.value.lot,
        sku: validation.value.sku
      }
    }, client);
    await queueNotification("ITEM_CREATED", `Auction item created: ${validation.value.title}`, { itemId, title: validation.value.title }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  res.status(201).json(await getItemById(itemId, true));
}));

app.patch("/api/items/:id", requireAdminToken, upload.fields([{ name: "images", maxCount: 8 }, { name: "documents", maxCount: 8 }]), asyncHandler(async (req, res) => {
  const existing = await getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  const validation = validateNewItem(req.body as Record<string, string>);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const images = files?.images || [];
  const documents = files?.documents || [];
  const auth = await getAuthContext(req);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into public.categories (name) values ($1) on conflict (name) do nothing`, [validation.value.category]);
    await client.query(
      `update public.items
       set title = $1, category = $2, lot = $3, sku = $4, condition = $5, location = $6,
           start_bid = $7, reserve = $8, increment_amount = $9, start_time = $10, end_time = $11, description = $12
       where id = $13`,
      [
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
      ]
    );
    for (const image of images) {
      await client.query(
        `insert into public.item_files (id, item_id, kind, name, url) values ($1,$2,$3,$4,$5)`,
        [randomUUID(), existing.id, "image", image.originalname, `/uploads/images/${path.basename(image.path)}`]
      );
    }
    for (const document of documents) {
      await client.query(
        `insert into public.item_files (id, item_id, kind, name, url) values ($1,$2,$3,$4,$5)`,
        [randomUUID(), existing.id, "document", document.originalname, `/uploads/documents/${path.basename(document.path)}`]
      );
    }
    await appendAudit(req, {
      eventType: "ITEM_UPDATED",
      entityType: "item",
      entityId: existing.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { title: validation.value.title, category: validation.value.category }
    }, client);
    await queueNotification("ITEM_UPDATED", `Auction item updated: ${validation.value.title}`, { itemId: existing.id, title: validation.value.title }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.json(await getItemById(existing.id, true));
}));

app.delete("/api/items/:id", requireAdminToken, asyncHandler(async (req, res) => {
  const existing = await getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  const auth = await getAuthContext(req);
  const archivedAt = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update public.items set archived_at = $1 where id = $2`, [archivedAt, existing.id]);
    await appendAudit(req, {
      eventType: "ITEM_ARCHIVED",
      entityType: "item",
      entityId: existing.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { title: existing.title }
    }, client);
    await queueNotification("ITEM_ARCHIVED", `Auction item archived: ${existing.title}`, { itemId: existing.id, title: existing.title }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

app.post("/api/items/:id/restore", requireAdminToken, asyncHandler(async (req, res) => {
  const existing = await getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  const auth = await getAuthContext(req);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update public.items set archived_at = null where id = $1`, [existing.id]);
    await appendAudit(req, {
      eventType: "ITEM_RESTORED",
      entityType: "item",
      entityId: existing.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { title: existing.title }
    }, client);
    await queueNotification("ITEM_RESTORED", `Auction item restored: ${existing.title}`, { itemId: existing.id, title: existing.title }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.json(await getItemById(existing.id, true));
}));

app.post("/api/items/:id/bids", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn) {
    res.status(401).json({ error: "Sign in to place a bid." });
    return;
  }
  if (!(auth.role === "Bidder" || auth.role === "Admin")) {
    res.status(403).json({ error: "Your account does not have bidding permission." });
    return;
  }
  const actor = auth.actor;
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
  const client = await pool.connect();
  let updated: StoredItem | null = null;
  try {
    await client.query("begin");
    const itemRow = await one<Record<string, unknown>>(
      `select
        id, title, category, lot, sku, condition, location,
        start_bid as startBid, reserve, increment_amount as incrementAmount,
        current_bid as currentBid, start_time as startTime, end_time as endTime,
        description, created_at as createdAt, archived_at as archivedAt
       from public.items
       where id = $1 and archived_at is null
       for update`,
      [req.params.id],
      client
    );
    if (!itemRow) {
      await client.query("rollback");
      res.status(404).json({ error: "Item not found." });
      return;
    }
    const item = await mapItemRow(itemRow, client);
    if (item.currentBid !== expectedCurrentBid) {
      await client.query("rollback");
      res.status(409).json({ error: "Item bid state changed. Refresh and try again." });
      return;
    }
    const validation = validateBid(item, amount);
    if (!validation.ok) {
      await client.query("rollback");
      res.status(400).json({ error: validation.error });
      return;
    }

    const countRow = await one<{ count: string }>(`select count(*)::text as count from public.bids where item_id = $1`, [item.id], client);
    const bidSequence = Number(countRow?.count || 0) + 1;
    const bidAlias = `Bidder-${String(bidSequence).padStart(3, "0")}`;
    const createdAt = new Date().toISOString();
    await client.query(
      `insert into public.bids (id, item_id, bidder_alias, amount, bid_time, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), item.id, bidAlias, amount, formatBidTime(createdAt), createdAt]
    );
    await client.query(`update public.items set current_bid = $1 where id = $2`, [amount, item.id]);
    if (idempotencyKey) processedBidKeys.set(idempotencyKey, item.id);
    await appendAudit(req, {
      eventType: "BID_PLACED",
      entityType: "bid",
      entityId: item.id,
      actor,
      actorType: auth.actorType,
      details: { amount, bidSequence, auctionItemId: item.id }
    }, client);
    await queueNotification("BID_PLACED", `Bid accepted for ${item.title}`, {
      itemId: item.id,
      amount,
      bidSequence
    }, client);
    await client.query("commit");
    updated = await getItemById(item.id);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  res.json(updated);
}));

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

const start = async () => {
  await pool.query("select 1");
  await seedRoles();
  await seedCategoriesIfEmpty();
  await seedItemsIfEmpty();
  await query(`delete from public.sessions where expires_at <= now()`);
  await query(`delete from public.email_verification_tokens where expires_at <= now()`);
  await processNotificationQueue();
  setInterval(() => {
    void processNotificationQueue().catch((error) => console.error("Notification processing failed.", error));
  }, notificationPollMs);
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
    console.log(`Storage backend: supabase-postgres`);
    console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
  });
};

void start().catch((error) => {
  console.error("Unable to start API server.");
  console.error(error);
  process.exit(1);
});
