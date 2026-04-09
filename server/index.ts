import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import AdmZip from "adm-zip";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  buildCsrfTokenValue,
  buildNotificationMeta,
  canAccessDocumentVisibility,
  encodeDocumentNameWithVisibility,
  ensureCanManageTargetRoles,
  parseDocumentNameWithVisibility,
  type DocumentVisibility,
  validateArchiveEntries,
  validateBidAmount,
  validateMalwareScanConfiguration
} from "./security-logic.js";

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
const runtimeEnvironment = process.env.NODE_ENV || "development";
const port = Number(process.env.PORT || 5174);
const sessionCookieName = "fmdq_session";
const sessionTtlHours = Math.max(Number(process.env.SESSION_TTL_HOURS || 8), 1);
const sessionTtlMs = sessionTtlHours * 60 * 60 * 1000;
const emailVerificationTtlMs = 24 * 60 * 60 * 1000;
const passwordResetTtlMs = 60 * 60 * 1000;
const configuredAdminApiToken = process.env.ADMIN_API_TOKEN || "";
const adminApiTokenEnabled =
  runtimeEnvironment === "development" && String(process.env.ENABLE_ADMIN_API_TOKEN || "").toLowerCase() === "true";
const adminApiToken = adminApiTokenEnabled ? configuredAdminApiToken : "";
const notificationRecipient = process.env.NOTIFY_TO || "operations@fmdq.example";
const notificationTransport = (process.env.NOTIFY_TRANSPORT || "file").toLowerCase();
const notificationPollMs = Math.max(Number(process.env.NOTIFY_POLL_MS || 5000), 1000);
const notificationWorkerMode = (process.env.NOTIFICATION_WORKER_MODE || "both").toLowerCase();
const notificationMaxAttempts = Math.max(Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 5), 1);
const maintenancePollMs = Math.max(Number(process.env.MAINTENANCE_POLL_MS || 60 * 60 * 1000), 60 * 1000);
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom = process.env.SMTP_FROM || smtpUser || "no-reply@fmdq.example";
const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || smtpPort === 465;
const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const tokenSigningSecret = process.env.APP_SECRET || "";
const bidRateWindowMs = 60_000;
const bidRateLimit = 12;
const authRateWindowMs = 15 * 60_000;
const authRateLimit = 10;
const maxImportArchiveEntries = 150;
const maxImportExtractedBytes = 100 * 1024 * 1024;
const notificationClaimTtlMs = Math.max(Number(process.env.NOTIFICATION_CLAIM_TTL_MS || 10 * 60_000), 30_000);
const notificationLeaseRenewMs = Math.max(
  Math.min(
    Number(process.env.NOTIFICATION_LEASE_RENEW_MS || Math.floor(notificationClaimTtlMs / 2)),
    notificationClaimTtlMs - 1000
  ),
  1000
);
const securityEventsRetentionMs = Math.max(Number(process.env.SECURITY_EVENTS_RETENTION_DAYS || 30), 1) * 24 * 60 * 60 * 1000;
const imageBucket = process.env.SUPABASE_IMAGE_BUCKET || "auction-images";
const documentBucket = process.env.SUPABASE_DOCUMENT_BUCKET || "auction-documents";
const imageAccessPolicy = (process.env.IMAGE_ACCESS_POLICY || "bidder_visible").toLowerCase();
const malwareScanMode = (process.env.MALWARE_SCAN_MODE || "off").toLowerCase();
const malwareScanCommand = process.env.MALWARE_SCAN_COMMAND || "";
const malwareScanTimeoutMs = Math.max(Number(process.env.MALWARE_SCAN_TIMEOUT_MS || 30000), 5000);
const opsAlertWebhookUrl = process.env.OPS_ALERT_WEBHOOK_URL || "";
const tempUploadRetentionHours = Math.max(Number(process.env.TEMP_UPLOAD_RETENTION_HOURS || 24), 1);
const outboxRetentionDays = Math.max(Number(process.env.OUTBOX_RETENTION_DAYS || 30), 1);
const deadLetterRetentionDays = Math.max(Number(process.env.DEAD_LETTER_RETENTION_DAYS || 30), 1);
const quarantineRetentionDays = Math.max(Number(process.env.QUARANTINE_RETENTION_DAYS || 14), 1);
const normalizedImageWidth = Math.max(Number(process.env.NORMALIZED_IMAGE_WIDTH || 1600), 400);
const normalizedImageHeight = Math.max(Number(process.env.NORMALIZED_IMAGE_HEIGHT || 1200), 300);
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || [appBaseUrl, "http://localhost:5173", "http://127.0.0.1:5173"].join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const allowNoOriginMutations =
  runtimeEnvironment !== "production"
  && String(process.env.ALLOW_NO_ORIGIN_MUTATIONS || "").toLowerCase() === "true";
const errorWebhookUrl = process.env.ERROR_WEBHOOK_URL || "";
const securityTelemetryEvents = new Set(["AUTH_ATTEMPT", "BID_ATTEMPT"]);
let securityEventsTableAvailable = true;
const requiredSchemaMigrations = [
  "0001_bid_queue_hardening",
  "0002_metadata_rls_hardening",
  "0003_notification_queue_claim_columns"
];

if (!supabaseUrl || !supabaseServiceRoleKey || !tokenSigningSecret) {
  throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and APP_SECRET are required for the backend.");
}
if (configuredAdminApiToken && !adminApiTokenEnabled) {
  throw new Error(
    "ADMIN_API_TOKEN is only allowed when NODE_ENV=development and ENABLE_ADMIN_API_TOKEN=true. Remove it from shared/staging/production environments."
  );
}
const malwareConfigCheck = validateMalwareScanConfiguration(process.env.NODE_ENV, malwareScanMode, malwareScanCommand);
if (!malwareConfigCheck.ok) {
  throw new Error(malwareConfigCheck.error);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

const dataDir = path.join(__dirname, "data");
const outboxDir = path.join(dataDir, "notification-outbox");
const deadLetterDir = path.join(dataDir, "notification-dead-letter");
const importsDir = path.join(dataDir, "imports");
const uploadsDir = path.join(__dirname, "uploads");
const tempUploadsDir = path.join(uploadsDir, "temp");
const quarantineDir = path.join(uploadsDir, "quarantine");
const imagesDir = path.join(uploadsDir, "images");
const docsDir = path.join(uploadsDir, "documents");
const execFileAsync = promisify(execFile);

[dataDir, outboxDir, deadLetterDir, importsDir, uploadsDir, tempUploadsDir, quarantineDir, imagesDir, docsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.disable("x-powered-by");
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true
}));
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
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com; style-src-elem 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self' ${Array.from(allowedOrigins).join(" ")};`
  );
  if (runtimeEnvironment === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use((req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  if (!origin && !referer) {
    if (allowNoOriginMutations) {
      next();
      return;
    }
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  const source = origin || referer;
  if (!isAllowedRequestSource(source)) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
});
app.use((req, res, next) => {
  void (async () => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    if (adminApiToken && req.header("x-admin-token") === adminApiToken) {
      next();
      return;
    }
    // Public auth endpoints authenticate via credentials/tokens — CSRF doesn't apply
    const csrfExemptPaths = new Set([
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/verify-email",
      "/api/auth/request-password-reset",
      "/api/auth/reset-password",
      "/api/auth/resend-verification",
    ]);
    if (csrfExemptPaths.has(req.path)) {
      next();
      return;
    }
    const sessionId = parseCookies(req)[sessionCookieName];
    if (!sessionId) {
      next();
      return;
    }
    const expectedToken = buildCsrfToken(sessionId);
    const providedToken = String(req.header("x-csrf-token") || "");
    if (!providedToken || providedToken !== expectedToken) {
      res.status(403).json({ error: "Invalid or missing CSRF token." });
      return;
    }
    next();
  })().catch(next);
});
type StoredFileRef = { name: string; url: string; visibility?: DocumentVisibility };
type StoredBid = { bidder: string; amount: number; time: string; createdAt: string; bidderUserId?: string };
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
  entityType: "item" | "bid" | "user" | "system" | "export";
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
type Role = "Guest" | "Bidder" | "ShopOwner" | "Admin" | "SuperAdmin";
type AuthContext = {
  userId?: string;
  sessionId?: string;
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
  nextAttemptAt?: string | null;
  attemptCount?: number;
  claimToken?: string | null;
  claimExpiresAt?: string | null;
  errorMessage?: string | null;
};
type BidAuditRow = {
  entity_id: string;
  details_json: Record<string, unknown> | string;
  created_at: string;
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
type AuditRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  actor_type: string;
  request_id: string;
  details_json: Record<string, unknown> | string;
  created_at: string;
  actor_role?: string | null;
};
type SessionRow = { id: string; user_id: string; created_at: string; expires_at: string };
type UserRow = {
  id: string;
  email: string;
  password_hash?: string;
  display_name: string;
  status: StoredUser["status"];
  created_at: string;
  last_login_at: string | null;
};
type RoleRow = { role_name: string };
type EmailVerificationRow = { id: string; user_id: string; token: string; created_at: string; expires_at: string };
type NotificationRow = {
  id: string;
  channel: "email";
  event_type: string;
  recipient: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  payload_json: Record<string, unknown> | string;
  created_at: string;
  processed_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  error_message: string | null;
};

const defaultCategories = ["Cars", "Furniture", "Household Appliances", "Kitchen Appliances", "Phones", "Other"];
const smtpTransporter = notificationTransport === "smtp" && smtpHost && smtpUser && smtpPass
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })
  : null;
let notificationProcessingInFlight = false;
let maintenanceInFlight = false;

class NotificationClaimLostError extends Error {
  constructor(entryId: string) {
    super(`Notification claim for ${entryId} expired before it could be finalized.`);
    this.name = "NotificationClaimLostError";
  }
}

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
  if (roles.includes("SuperAdmin")) return "SuperAdmin";
  if (roles.includes("Admin")) return "Admin";
  if (roles.includes("ShopOwner") || roles.includes("Observer")) return "ShopOwner";
  if (roles.includes("Bidder")) return "Bidder";
  return "Guest";
};

const normalizeDisplayRoleName = (role: string) => role === "Observer" ? "ShopOwner" : role;

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-");
const replaceFileExtension = (name: string, extension: string) => {
  const baseName = path.basename(name, path.extname(name)) || "image";
  return `${safeFileName(baseName)}${extension}`;
};
const guessContentType = (name: string, fallback = "application/octet-stream") => {
  const extension = path.extname(name).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".doc") return "application/msword";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return fallback;
};
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const sanitizeDisplayName = (value: string) => value.trim().replace(/\s+/g, " ");
const buildEmailVerificationUrl = (token: string) => `${appBaseUrl}/verify?token=${encodeURIComponent(token)}`;
const buildPasswordResetUrl = (token: string) => `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
const buildSignInUrl = () => `${appBaseUrl}/signin`;
const buildItemUrl = (itemId: string) => `${appBaseUrl}/bidding/${encodeURIComponent(itemId)}`;
const isStrongPassword = (value: string) =>
  value.length >= 8 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);
const passwordRuleMessage = "Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.";
const base64UrlEncode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf8");
const signTokenValue = (value: string) => createHmac("sha256", tokenSigningSecret).update(value).digest("base64url");
const buildCsrfToken = (sessionId: string) => buildCsrfTokenValue(tokenSigningSecret, sessionId);
const passwordHashFingerprint = (passwordHash: string) => createHmac("sha256", tokenSigningSecret).update(passwordHash).digest("hex").slice(0, 24);
const buildSignedToken = (payload: Record<string, unknown>) => {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signTokenValue(body);
  return `${body}.${signature}`;
};
const parseSignedToken = <T>(token: string): T | null => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = signTokenValue(body);
  if (signature !== expected) return null;
  try {
    return JSON.parse(base64UrlDecode(body)) as T;
  } catch {
    return null;
  }
};

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedDocumentTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${safeFileName(file.originalname)}`)
});

const detectFileSignatureMimeType = (filePath: string) => {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    fs.readSync(descriptor, header, 0, header.length, 0);
    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (header.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
    if (header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      return "application/msword";
    }
    if (header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      return "application/zip";
    }
    return null;
  } finally {
    fs.closeSync(descriptor);
  }
};

const validateManagedFileContent = (filePath: string, originalName: string, kind: "image" | "document") => {
  const detectedMimeType = detectFileSignatureMimeType(filePath);
  const isOfficeZipDocument =
    kind === "document"
    && detectedMimeType === "application/zip"
    && !originalName.toLowerCase().endsWith(".docx")
    && !originalName.toLowerCase().endsWith(".xlsx");
  const allowed =
    kind === "image"
      ? Boolean(detectedMimeType && allowedImageTypes.has(detectedMimeType))
      : Boolean(detectedMimeType && (allowedDocumentTypes.has(detectedMimeType) || (
          detectedMimeType === "application/zip"
          && !isOfficeZipDocument
        )));
  if (!allowed) {
    removeFileIfExists(filePath);
    throw new Error(`Uploaded ${kind} content does not match an allowed file signature.`);
  }
  if (isOfficeZipDocument) {
    removeFileIfExists(filePath);
    throw new Error("ZIP archives are not accepted as standalone documents. Upload Office files or PDFs only.");
  }
};

const upload = multer({
  storage,
  limits: { files: 16, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImage = file.fieldname === "images" && allowedImageTypes.has(file.mimetype);
    const isDocument = file.fieldname === "documents" && allowedDocumentTypes.has(file.mimetype);
    cb(null, isImage || isDocument);
  }
});

const bulkImportStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, importsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${safeFileName(file.originalname)}`)
});

const bulkImportUpload = multer({
  storage: bulkImportStorage,
  limits: { files: 2, fileSize: 25 * 1024 * 1024 }
});

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

const removeStoredFile = (url: string) => {
  if (!url.startsWith("/uploads/")) return;
  const filePath = path.normalize(path.join(__dirname, url.replace(/^\/+/, "")));
  if (!filePath.startsWith(uploadsDir)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const buildStoragePath = (kind: "image" | "document", originalName: string) =>
  `${kind}s/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomUUID()}-${safeFileName(originalName)}`;

const buildStoredFileUrl = (kind: "image" | "document", storagePath: string) =>
  `/uploads/${kind === "image" ? "images" : "documents"}/${encodeURIComponent(Buffer.from(storagePath, "utf8").toString("base64url"))}`;

const decodeStoredFilePath = (encodedPath: string) => {
  try {
    return Buffer.from(decodeURIComponent(encodedPath), "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const runMalwareScan = async (filePath: string) => {
  const quarantinePath = path.join(quarantineDir, `${Date.now()}-${safeFileName(path.basename(filePath))}`);
  fs.copyFileSync(filePath, quarantinePath);
  try {
    if (malwareScanMode === "command" && malwareScanCommand) {
      const parts = malwareScanCommand.split(/\s+/).filter(Boolean);
      const [command, ...args] = parts;
      if (!command) throw new Error("MALWARE_SCAN_COMMAND is not configured.");
      await execFileAsync(command, [...args, quarantinePath], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: malwareScanTimeoutMs
      });
    }
    return quarantinePath;
  } catch (error) {
    await sendOpsAlert("Malware scan failed", {
      filePath: path.basename(filePath),
      message: error instanceof Error ? error.message : "Malware scan failed."
    });
    throw new Error(error instanceof Error ? `Malware scan failed: ${error.message}` : "Malware scan failed.");
  }
};

const verifyMalwareScannerHealth = async () => {
  if (malwareScanMode !== "command") return;
  const probePath = path.join(tempUploadsDir, `scanner-probe-${randomUUID()}.txt`);
  fs.writeFileSync(probePath, `scanner-health-check:${new Date().toISOString()}\n`, "utf8");
  let scannedPath = "";
  try {
    scannedPath = await runMalwareScan(probePath);
  } finally {
    removeFileIfExists(probePath);
    if (scannedPath) removeFileIfExists(scannedPath);
  }
};

const uploadFileToManagedStorage = async (sourcePath: string, kind: "image" | "document", originalName: string) => {
  const storagePath = buildStoragePath(kind, originalName);
  const bucket = kind === "image" ? imageBucket : documentBucket;
  const fileBuffer = fs.readFileSync(sourcePath);
  const uploadResult = await supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
    contentType: guessContentType(originalName),
    upsert: false
  });
  if (uploadResult.error) throw new Error(uploadResult.error.message);
  return {
    storagePath,
    bucket,
    url: buildStoredFileUrl(kind, storagePath)
  };
};

const normalizeImageForUpload = async (sourcePath: string, originalName: string) => {
  const normalizedName = replaceFileExtension(originalName, ".jpg");
  const normalizedPath = path.join(tempUploadsDir, `${Date.now()}-${randomUUID()}-${normalizedName}`);
  const image = sharp(sourcePath, { failOn: "error" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read uploaded image dimensions.");
  }
  await image
    .resize(normalizedImageWidth, normalizedImageHeight, {
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(normalizedPath);

  return {
    path: normalizedPath,
    originalName: normalizedName,
  };
};

const removeManagedStoredFile = async (url: string) => {
  const documentMatch = url.match(/^\/uploads\/documents\/(.+)$/);
  const imageMatch = url.match(/^\/uploads\/images\/(.+)$/);
  const kind = documentMatch ? "document" : imageMatch ? "image" : null;
  const encodedPath = documentMatch?.[1] || imageMatch?.[1] || "";
  if (!kind || !encodedPath) {
    removeStoredFile(url);
    return;
  }
  const storagePath = decodeStoredFilePath(encodedPath);
  if (!storagePath) {
    removeStoredFile(url);
    return;
  }
  const bucket = kind === "image" ? imageBucket : documentBucket;
  const result = await supabase.storage.from(bucket).remove([storagePath]);
  if (result.error && !result.error.message.toLowerCase().includes("not found")) {
    throw new Error(result.error.message);
  }
};

const ensureStorageBucket = async (bucketName: string, publicBucket: boolean) => {
  const listResult = await supabase.storage.listBuckets();
  if (listResult.error) throw new Error(listResult.error.message);
  if (listResult.data?.some((bucket) => bucket.name === bucketName)) return;
  const createResult = await supabase.storage.createBucket(bucketName, {
    public: publicBucket,
    fileSizeLimit: "25MB"
  });
  if (createResult.error && !createResult.error.message.toLowerCase().includes("already exists")) {
    throw new Error(createResult.error.message);
  }
};

const ensureStorageBuckets = async () => {
  await ensureStorageBucket(imageBucket, false);
  await ensureStorageBucket(documentBucket, false);
};

const isAllowedRequestSource = (source: string) => {
  try {
    return allowedOrigins.has(new URL(source).origin);
  } catch {
    return false;
  }
};

const detectSecurityEventsTable = async () => {
  const result = await supabase.from("security_events").select("id").limit(1);
  if (result.error) {
    throw new Error(result.error.message);
  }
  securityEventsTableAvailable = true;
};

const verifyRequiredSchemaMigrations = async () => {
  const result = await supabase.from("schema_migrations").select("version").in("version", requiredSchemaMigrations);
  if (result.error) {
    throw new Error(
      `Database migration metadata is unavailable. Run docs/migrations/0001_bid_queue_hardening.sql first. Details: ${result.error.message}`
    );
  }
  const applied = new Set((result.data || []).map((row: { version: string }) => row.version));
  const missing = requiredSchemaMigrations.filter((version) => !applied.has(version));
  if (missing.length) {
    throw new Error(`Missing database migrations: ${missing.join(", ")}. Run docs/migrations before starting the server.`);
  }
};

const pruneExpiredDatabaseRows = async () => {
  const now = new Date().toISOString();
  const securityEventsCutoff = new Date(Date.now() - securityEventsRetentionMs).toISOString();
  await handleSupabase(await supabase.from("bid_idempotency_keys").delete().lte("expires_at", now));
  await handleSupabase(await supabase.from("security_events").delete().lte("created_at", securityEventsCutoff));
};

const removeFileIfExists = (filePath: string) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const formatBidTime = (createdAt: string) =>
  new Date(createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const toIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const csvEscape = (value: string | number | boolean) => `"${String(value).replace(/"/g, "\"\"")}"`;
const toCsv = (rows: Array<Record<string, string | number | boolean>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(","))].join("\n");
};

const handleSupabase = <T>(result: { data: T; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

const handleSupabaseMaybe = <T>(result: { data: T | null; error: { message: string } | null }, allowNotFound = false) => {
  if (result.error && !allowNotFound) throw new Error(result.error.message);
  return result.data;
};

const getClientKey = (req: express.Request, extra = "") =>
  `${req.ip || req.socket.remoteAddress || "unknown"}:${extra}`;

const buildRateLimitSlotId = (eventType: string, actor: string, windowStartMs: number, slot: number) =>
  createHmac("sha256", tokenSigningSecret)
    .update(`${eventType}:${actor}:${windowStartMs}:${slot}`)
    .digest("hex");

const recordSharedRateLimitAttempt = async (
  req: express.Request,
  eventType: string,
  actor: string,
  windowMs: number,
  limit: number,
  details: Record<string, string | number | boolean> = {}
) => {
  if (!securityEventsTableAvailable) {
    throw new Error("security_events table is required for rate-limit telemetry. Run docs/security-events.sql in Supabase.");
  }
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const createdAt = new Date(now).toISOString();
  for (let slot = 0; slot < limit; slot += 1) {
    const id = buildRateLimitSlotId(eventType, actor, windowStartMs, slot);
    const result = await supabase.from("security_events").insert({
      id,
      event_type: eventType,
      actor,
      request_id: String((req as express.Request & { requestId?: string }).requestId || ""),
      details_json: {
        path: req.path,
        method: req.method,
        windowStart: new Date(windowStartMs).toISOString(),
        slot,
        ...details
      },
      created_at: createdAt
    });
    if (!result.error) return true;
    const duplicate = result.error.message.toLowerCase().includes("duplicate key");
    if (!duplicate) throw new Error(result.error.message);
  }
  await sendOpsAlert("Rate limit threshold reached", {
    eventType,
    actor,
    path: req.path,
    method: req.method,
    limit,
    windowMs,
    ...details
  });
  return false;
};

const checkAuthRateLimit = async (req: express.Request, key: string) =>
  recordSharedRateLimitAttempt(req, "AUTH_ATTEMPT", key, authRateWindowMs, authRateLimit);

const reportServerError = async (req: express.Request, error: unknown) => {
  if (!errorWebhookUrl) return;
  try {
    await fetch(errorWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Unknown server error",
        path: req.path,
        method: req.method,
        requestId: String((req as express.Request & { requestId?: string }).requestId || ""),
        occurredAt: new Date().toISOString()
      })
    });
  } catch {
    // Ignore error-reporting failures.
  }
};

const sendOpsAlert = async (title: string, details: Record<string, unknown>) => {
  if (!opsAlertWebhookUrl) return;
  try {
    await fetch(opsAlertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        occurredAt: new Date().toISOString(),
        details
      })
    });
  } catch {
    // Ignore monitoring delivery failures.
  }
};

const pruneFilesOlderThan = (directory: string, maxAgeMs: number) => {
  if (!fs.existsSync(directory)) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(directory, entry.name);
    const stats = fs.statSync(fullPath);
    if (stats.mtimeMs <= cutoff) {
      fs.unlinkSync(fullPath);
    }
  }
};

const pruneOperationalFiles = () => {
  pruneFilesOlderThan(tempUploadsDir, tempUploadRetentionHours * 60 * 60 * 1000);
  pruneFilesOlderThan(outboxDir, outboxRetentionDays * 24 * 60 * 60 * 1000);
  pruneFilesOlderThan(deadLetterDir, deadLetterRetentionDays * 24 * 60 * 60 * 1000);
  pruneFilesOlderThan(quarantineDir, quarantineRetentionDays * 24 * 60 * 60 * 1000);
};

const getUserByEmail = async (email: string) =>
  handleSupabaseMaybe<UserRow>(
    await supabase
      .from("users")
      .select("id,email,password_hash,display_name,status,created_at,last_login_at")
      .eq("email", email)
      .maybeSingle(),
    true
  );

const getUserById = async (id: string) =>
  handleSupabaseMaybe<UserRow>(
    await supabase
      .from("users")
      .select("id,email,display_name,status,created_at,last_login_at")
      .eq("id", id)
      .maybeSingle(),
    true
  );

const getUserByDisplayName = async (displayName: string) =>
  handleSupabaseMaybe<UserRow>(
    await supabase
      .from("users")
      .select("id,email,display_name,status,created_at,last_login_at")
      .eq("display_name", displayName)
      .eq("status", "active")
      .maybeSingle(),
    true
  );

const getUserByIdWithPassword = async (id: string) =>
  handleSupabaseMaybe<UserRow>(
    await supabase
      .from("users")
      .select("id,email,password_hash,display_name,status,created_at,last_login_at")
      .eq("id", id)
      .maybeSingle(),
    true
  );

const listUsersWithRoles = async () => {
  const users = handleSupabase(
    await supabase
      .from("users")
      .select("id,email,display_name,status,created_at,last_login_at")
      .order("created_at", { ascending: false })
  ) as Array<Omit<UserRow, "password_hash">>;
  const roles = handleSupabase(
    await supabase.from("user_roles").select("user_id,role_name")
  ) as Array<{ user_id: string; role_name: string }>;
  return users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    roles: roles.filter((role) => role.user_id === user.id).map((role) => normalizeDisplayRoleName(role.role_name))
  }));
};

const getAuditActorRoleLookup = async () => {
  const users = await listUsersWithRoles();
  const roleLookup = new Map<string, string | null>();

  for (const user of users) {
    const normalizedRole = normalizeRole(user.roles);
    const existing = roleLookup.get(user.displayName);
    if (existing === undefined) {
      roleLookup.set(user.displayName, normalizedRole);
      continue;
    }
    if (existing !== normalizedRole) {
      roleLookup.set(user.displayName, null);
    }
  }

  return roleLookup;
};

const mapAuditRowToEntry = (row: AuditRow, actorRoleLookup?: Map<string, string | null>) => ({
  id: row.id,
  eventType: row.event_type,
  entityType: row.entity_type,
  entityId: row.entity_id,
  actor: row.actor,
  actorType: row.actor_type,
  actorRole: actorRoleLookup?.get(row.actor) ?? undefined,
  requestId: row.request_id,
  details: typeof row.details_json === "string" ? row.details_json : JSON.stringify(row.details_json || {}),
  createdAt: row.created_at
});

const getUserRoles = async (userId: string) =>
  handleSupabase(
    await supabase.from("user_roles").select("role_name").eq("user_id", userId)
  ) as RoleRow[];

const ensureCanManageTargetUser = (actor: AuthContext, targetRoles: string[]) => {
  return ensureCanManageTargetRoles(actor.role, targetRoles);
};

const isUserWinningItem = (auth: AuthContext, item: StoredItem) => {
  if (!auth.userId) return false;
  if (new Date(item.endTime).getTime() > Date.now()) return false;
  if (item.currentBid <= 0) return false;
  const matchingBid = item.bids.find((bid) => bid.bidderUserId === auth.userId);
  return Boolean(matchingBid && matchingBid.amount === item.currentBid);
};

const canAccessItemDocument = (auth: AuthContext, item: StoredItem, visibility: DocumentVisibility) =>
  canAccessDocumentVisibility({
    signedIn: auth.signedIn,
    adminAuthorized: auth.adminAuthorized,
    role: auth.role,
    itemArchived: Boolean(item.archivedAt),
    itemEnded: new Date(item.endTime).getTime() <= Date.now(),
    reserveState: getReserveState(item),
    isWinner: isUserWinningItem(auth, item)
  }, visibility);

const sanitizeItemForAuth = (item: StoredItem, auth: AuthContext): StoredItem => ({
  ...item,
  documents: item.documents.filter((document) => canAccessItemDocument(auth, item, document.visibility || "bidder_visible"))
});

const getSessionRow = async (sessionId: string) =>
  handleSupabaseMaybe<SessionRow>(
    await supabase.from("sessions").select("id,user_id,created_at,expires_at").eq("id", sessionId).maybeSingle(),
    true
  );

const getUserSessions = async (userId: string) =>
  handleSupabase(
    await supabase.from("sessions").select("id,user_id,created_at,expires_at").eq("user_id", userId).order("created_at", { ascending: false })
  ) as SessionRow[];

const deleteSessionRow = async (sessionId: string) => {
  await handleSupabase(await supabase.from("sessions").delete().eq("id", sessionId));
};

const getEmailVerificationRow = async (token: string) =>
  handleSupabaseMaybe<EmailVerificationRow>(
    await supabase
      .from("email_verification_tokens")
      .select("id,user_id,token,created_at,expires_at")
      .eq("token", token)
      .maybeSingle(),
    true
  );

const createUserSession = async (res: express.Response, userId: string) => {
  const sessionId = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  await handleSupabase(
    await supabase.from("sessions").insert({ id: sessionId, user_id: userId, created_at: createdAt, expires_at: expiresAt })
  );
  setSessionCookie(res, sessionId, expiresAt);
  return { sessionId, createdAt, expiresAt };
};

const createEmailVerificationToken = async (userId: string) => {
  const token = randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + emailVerificationTtlMs).toISOString();
  await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("user_id", userId));
  await handleSupabase(
    await supabase
      .from("email_verification_tokens")
      .insert({ id: randomUUID(), user_id: userId, token, created_at: createdAt, expires_at: expiresAt })
  );
  return { token, createdAt, expiresAt, verifyUrl: buildEmailVerificationUrl(token) };
};

const createPasswordResetToken = (user: UserRow & { password_hash?: string }) => {
  const expiresAt = new Date(Date.now() + passwordResetTtlMs).toISOString();
  const token = buildSignedToken({
    type: "password-reset",
    sub: user.id,
    email: user.email,
    exp: expiresAt,
    fp: passwordHashFingerprint(user.password_hash || "")
  });
  return { token, expiresAt, resetUrl: buildPasswordResetUrl(token) };
};

const queuePasswordReset = async (user: UserRow & { password_hash?: string }, triggeredBy?: string) => {
  const reset = createPasswordResetToken(user);
  await queueNotification(
    "PASSWORD_RESET",
    "Reset your FMDQ Auctions password",
    {
      email: user.email,
      displayName: user.display_name,
      resetUrl: reset.resetUrl,
      expiresAt: reset.expiresAt,
      triggeredBy: triggeredBy || "self-service"
    },
    user.email
  );
  return reset;
};

const queueBidActivityNotifications = async (
  item: StoredItem,
  bidder: { userId?: string; email?: string; displayName: string },
  amount: number,
  previousLeader?: StoredBid
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
        itemUrl: buildItemUrl(item.id)
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
      itemUrl: buildItemUrl(item.id)
    },
    previousLeaderUser.email
  );
};

const getAuthContext = async (req: express.Request): Promise<AuthContext> => {
  if (adminApiToken && req.header("x-admin-token") === adminApiToken) {
    return {
      userId: "admin-token",
      sessionId: undefined,
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
    return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
  }
  const sessionRow = await getSessionRow(sessionId);
  if (!sessionRow || new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    await deleteSessionRow(sessionId).catch(() => undefined);
    return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
  }
  const user = await getUserById(sessionRow.user_id);
  if (!user || user.status !== "active") {
    await deleteSessionRow(sessionId).catch(() => undefined);
    return { actor: "anonymous-client", actorType: "system", role: "Guest", trusted: false, adminAuthorized: false, signedIn: false };
  }
  const roleRows = await getUserRoles(user.id);
  const role = normalizeRole(roleRows.map((row) => row.role_name));
  return {
    userId: user.id,
    sessionId,
    actor: user.display_name,
    actorType: "user",
    role,
    trusted: true,
    adminAuthorized: role === "Admin" || role === "SuperAdmin",
    signedIn: true
  };
};

const serializeSession = async (req: express.Request): Promise<((StoredUser & { role: Role }) & { csrfToken?: string }) | null> => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) return null;
  const user = await getUserById(auth.userId);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    role: auth.role,
    csrfToken: auth.sessionId ? buildCsrfToken(auth.sessionId) : undefined
  };
};

const appendAudit = async (req: express.Request, entry: AuditEntry) => {
  const auth = await getAuthContext(req);
  const details = {
    ...entry.details,
    actorRole: auth.role,
    ...(auth.userId ? { actorUserId: auth.userId } : {}),
  };

  await handleSupabase(
    await supabase.from("audits").insert({
      id: randomUUID(),
      event_type: entry.eventType,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      actor: entry.actor,
      actor_type: entry.actorType,
      request_id: String((req as express.Request & { requestId?: string }).requestId || ""),
      details_json: details,
      created_at: new Date().toISOString()
    })
  );
};

const queueNotification = async (
  eventType: string,
  subject: string,
  payload: Record<string, unknown>,
  recipient = notificationRecipient
) => {
  if (eventType === "ACCOUNT_VERIFICATION") {
    await handleSupabase(
      await supabase
        .from("notification_queue")
        .delete()
        .eq("event_type", "ACCOUNT_VERIFICATION")
        .eq("recipient", recipient)
        .eq("status", "pending")
    );
  }
  if (eventType === "PASSWORD_RESET") {
    await handleSupabase(
      await supabase
        .from("notification_queue")
        .delete()
        .eq("event_type", "PASSWORD_RESET")
        .eq("recipient", recipient)
        .eq("status", "pending")
    );
  }
  const basePayload = {
    id: randomUUID(),
    channel: "email" as const,
    event_type: eventType,
    recipient,
    subject,
    status: "pending" as const,
    payload_json: payload,
    created_at: new Date().toISOString(),
    processed_at: null,
    next_attempt_at: new Date().toISOString(),
    attempt_count: 0,
    claim_token: null,
    claim_expires_at: null,
    error_message: null
  };
  await handleSupabase(await supabase.from("notification_queue").insert(basePayload));
};

const getCategories = async () => {
  const rows = handleSupabase(
    await supabase.from("categories").select("name").order("name", { ascending: true })
  ) as Array<{ name: string }>;
  return rows.map((row) => row.name);
};

const getRoles = async () => {
  const rows = handleSupabase(
    await supabase.from("roles").select("name").order("name", { ascending: true })
  ) as Array<{ name: string }>;
  return rows.map((row) => row.name);
};

const formatProcessUptime = (uptimeSeconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(uptimeSeconds / 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const getLandingStats = async () => {
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

const mapItem = (
  row: ItemRow,
  files: ItemFileRow[],
  bids: BidRow[],
  bidAuditLookup: Map<string, Map<string, string>>
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
    bidder: bid.bidder_alias,
    amount: Number(bid.amount),
    time: bid.bid_time,
    createdAt: bid.created_at,
    bidderUserId: bid.bidder_user_id || bidAuditLookup.get(row.id)?.get(bid.created_at)
  })),
  createdAt: row.created_at,
  archivedAt: row.archived_at
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
  return rows.map((row) => mapItem(row, files, bids, bidAuditLookup));
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

const getReserveState = (item: StoredItem) => {
  if (item.reserve <= 0) return "no_reserve";
  if (new Date(item.endTime).getTime() > Date.now()) {
    return item.currentBid >= item.reserve ? "reserve_met" : "reserve_pending";
  }
  return item.currentBid >= item.reserve ? "reserve_met" : "reserve_not_met";
};

const parseAuditDetails = (value: Record<string, unknown> | string | null | undefined) => {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value;
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

const getBidAuditRowsForUser = async (userId: string) => {
  return handleSupabase(
    await supabase
      .from("audits")
      .select("entity_id,details_json,created_at")
      .eq("event_type", "BID_PLACED")
      .contains("details_json", { bidderUserId: userId })
      .order("created_at", { ascending: false })
  ) as BidAuditRow[];
};

const getUserBidRecords = async (userId: string) => {
  const bidAudits = await getBidAuditRowsForUser(userId);
  const uniqueItemIds = Array.from(new Set(bidAudits.map((row) => row.entity_id)));
  const items = new Map((await getItems(true)).map((item) => [item.id, item]));
  return uniqueItemIds.flatMap((itemId) => {
    const item = items.get(itemId);
    if (!item) return [];
    const auditsForItem = bidAudits.filter((row) => row.entity_id === itemId);
    if (!auditsForItem.length) return [];
    const latestAudit = auditsForItem[0];
    const details = parseAuditDetails(latestAudit.details_json);
    const latestAmount = Number(details.amount || 0);
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
      lastBidAt: latestAudit.created_at,
      status
    }];
  });
};

const getRecentAudits = async (limit = 20) => {
  const actorRoleLookup = await getAuditActorRoleLookup();
  const rows = handleSupabase(
    await supabase
      .from("audits")
      .select("id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at")
      .order("created_at", { ascending: false })
      .limit(limit + 100)
  ) as AuditRow[];
  return rows
    .filter((row) => !securityTelemetryEvents.has(row.event_type))
    .slice(0, limit)
    .map((row) => mapAuditRowToEntry(row, actorRoleLookup));
};

const mapNotificationRow = (row: NotificationRow): NotificationQueueItem => ({
  id: row.id,
  channel: row.channel,
  eventType: row.event_type,
  recipient: row.recipient,
  subject: row.subject,
  status: row.status,
  payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json || "{}") : row.payload_json || {},
  createdAt: row.created_at,
  processedAt: row.processed_at,
  nextAttemptAt: row.next_attempt_at,
  attemptCount: Number(row.attempt_count || 0),
  claimToken: row.claim_token,
  claimExpiresAt: row.claim_expires_at,
  errorMessage: row.error_message
});

const getNotificationQueue = async (limit = 20) => {
  const rows = handleSupabase(
    await supabase
      .from("notification_queue")
      .select("id,channel,event_type,recipient,subject,status,payload_json,created_at,processed_at,next_attempt_at,attempt_count,claim_token,claim_expires_at,error_message")
      .order("created_at", { ascending: false })
      .limit(limit)
  ) as NotificationRow[];
  return rows.map(mapNotificationRow);
};

const getPendingNotificationQueue = async () => {
  const now = new Date().toISOString();
  const rows = handleSupabase(
    await supabase
      .from("notification_queue")
      .select("id,channel,event_type,recipient,subject,status,payload_json,created_at,processed_at,next_attempt_at,attempt_count,claim_token,claim_expires_at,error_message")
      .eq("status", "pending")
      .lte("next_attempt_at", now)
      .or(`claim_expires_at.is.null,claim_expires_at.lte.${now}`)
      .order("next_attempt_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(10)
  ) as NotificationRow[];
  return rows.map(mapNotificationRow);
};

const claimNotificationQueueEntry = async (entry: NotificationQueueItem) => {
  const claimTime = new Date().toISOString();
  const claimToken = `claim:${randomUUID()}`;
  const claimExpiresAt = new Date(Date.now() + notificationClaimTtlMs).toISOString();
  let request = supabase
    .from("notification_queue")
    .update({
      claim_token: claimToken,
      claim_expires_at: claimExpiresAt,
      processed_at: claimTime,
      error_message: null
    })
    .eq("id", entry.id)
    .eq("status", "pending")
    .lte("next_attempt_at", claimTime);
  request = entry.claimToken ? request.eq("claim_token", entry.claimToken) : request.is("claim_token", null);
  const result = await request
    .select("id,claim_token")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data?.claim_token === claimToken ? claimToken : null;
};

const updateNotificationOutcome = async (
  entryId: string,
  claimToken: string,
  status: "pending" | "sent" | "failed",
  errorMessage: string | null,
  processedAt = new Date().toISOString(),
  nextAttemptAt: string | null = processedAt,
  attemptCount?: number
) => {
  const row = await handleSupabaseMaybe<{ id: string }>(
    await supabase
      .from("notification_queue")
      .update({
        status,
        processed_at: processedAt,
        next_attempt_at: nextAttemptAt,
        attempt_count: attemptCount,
        claim_token: null,
        claim_expires_at: null,
        error_message: errorMessage
      })
      .eq("id", entryId)
      .eq("claim_token", claimToken)
      .select("id")
      .maybeSingle(),
    true
  );
  if (!row) {
    await sendOpsAlert("Notification claim was lost before outcome update", {
      entryId,
      status,
      processedAt,
      nextAttemptAt,
      attemptCount: Number(attemptCount || 0)
    });
    throw new NotificationClaimLostError(entryId);
  }
};

const renewNotificationClaimLease = async (entryId: string, claimToken: string) => {
  const nextClaimExpiry = new Date(Date.now() + notificationClaimTtlMs).toISOString();
  const row = await handleSupabaseMaybe<{ id: string }>(
    await supabase
      .from("notification_queue")
      .update({ claim_expires_at: nextClaimExpiry })
      .eq("id", entryId)
      .eq("claim_token", claimToken)
      .select("id")
      .maybeSingle(),
    true
  );
  if (!row) {
    await sendOpsAlert("Notification claim lease could not be renewed", {
      entryId,
      claimToken,
      nextClaimExpiry
    });
    throw new NotificationClaimLostError(entryId);
  }
};

const startNotificationClaimLeaseRenewal = (entryId: string, claimToken: string) => {
  let renewalError: Error | null = null;
  let latestRenewal = Promise.resolve();
  const timer = setInterval(() => {
    latestRenewal = renewNotificationClaimLease(entryId, claimToken).catch((error) => {
      renewalError = error instanceof Error ? error : new Error("Unable to renew notification claim lease.");
    });
  }, notificationLeaseRenewMs);

  return async () => {
    clearInterval(timer);
    await latestRenewal;
    if (renewalError) {
      throw renewalError;
    }
  };
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const loadEmailInlineImage = async (imageUrl: string, title: string) => {
  const imageMatch = imageUrl.match(/^\/uploads\/images\/(.+)$/);
  if (!imageMatch) return null;
  const storagePath = decodeStoredFilePath(imageMatch[1]);
  if (!storagePath) return null;
  const downloadResult = await supabase.storage.from(imageBucket).download(storagePath);
  if (downloadResult.error || !downloadResult.data) return null;
  const content = Buffer.from(await downloadResult.data.arrayBuffer());
  return {
    cid: `auction-item-${randomUUID()}@fmdq-auctions`,
    filename: safeFileName(path.basename(storagePath) || `${title || "auction-item"}.jpg`),
    contentType: guessContentType(storagePath),
    content
  };
};

const renderNotificationContent = async (entry: NotificationQueueItem) => {
  if (entry.eventType === "ACCOUNT_VERIFICATION") {
    const displayName = escapeHtml(entry.payload.displayName || "there");
    const verifyUrl = String(entry.payload.verifyUrl || "");
    return {
      text: `Hello ${displayName},\n\nUse the link below to verify your FMDQ Auctions account:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          <p>Hello ${displayName},</p>
          <p>Use the link below to verify your FMDQ Auctions account:</p>
          <p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
          <p>This link expires in 24 hours.</p>
        </div>
      `
    };
  }

  if (entry.eventType === "ACCOUNT_VERIFIED") {
    const displayName = escapeHtml(entry.payload.displayName || "there");
    const signInUrl = buildSignInUrl();
    return {
      text: `Hello ${displayName},\n\nYour FMDQ Auctions account has been verified. You can now sign in here:\n${signInUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          <p>Hello ${displayName},</p>
          <p>Your FMDQ Auctions account has been verified.</p>
          <p>You can now sign in here: <a href="${escapeHtml(signInUrl)}">${escapeHtml(signInUrl)}</a></p>
        </div>
      `
    };
  }

  if (entry.eventType === "PASSWORD_RESET") {
    const displayName = escapeHtml(entry.payload.displayName || "there");
    const resetUrl = String(entry.payload.resetUrl || "");
    return {
      text: `Hello ${displayName},\n\nUse the link below to reset your FMDQ Auctions password:\n${resetUrl}\n\nThis link expires in 1 hour.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          <p>Hello ${displayName},</p>
          <p>Use the link below to reset your FMDQ Auctions password:</p>
          <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
          <p>This link expires in 1 hour.</p>
        </div>
      `
    };
  }

  if (entry.eventType === "BID_PLACED") {
    const displayName = escapeHtml(entry.payload.displayName || "there");
    const title = escapeHtml(entry.payload.title || "this auction item");
    const currentBid = escapeHtml(entry.payload.currentBid || entry.payload.amount || "");
    const inlineImage = await loadEmailInlineImage(String(entry.payload.imageUrl || ""), title);
    const itemUrl = String(entry.payload.itemUrl || `${appBaseUrl}/bidding`);
    return {
      text: `Hello ${displayName},\n\nYour bid of ${currentBid} was placed successfully for ${title}.\n\nView the item here:\n${itemUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          ${inlineImage ? `<img src="cid:${escapeHtml(inlineImage.cid)}" alt="${title}" style="display:block;width:100%;max-width:520px;border-radius:18px;margin:0 0 18px;" />` : ""}
          <p>Hello ${displayName},</p>
          <p>Your bid of <strong>${currentBid}</strong> was placed successfully for <strong>${title}</strong>.</p>
          <p>View the item here: <a href="${escapeHtml(itemUrl)}">${escapeHtml(itemUrl)}</a></p>
        </div>
      `,
      attachments: inlineImage ? [inlineImage] : []
    };
  }

  if (entry.eventType === "OUTBID_ALERT") {
    const displayName = escapeHtml(entry.payload.displayName || "there");
    const title = escapeHtml(entry.payload.title || "this auction item");
    const previousBid = escapeHtml(entry.payload.previousBid || "");
    const currentBid = escapeHtml(entry.payload.currentBid || "");
    const inlineImage = await loadEmailInlineImage(String(entry.payload.imageUrl || ""), title);
    const itemUrl = String(entry.payload.itemUrl || `${appBaseUrl}/bidding`);
    return {
      text: `Hello ${displayName},\n\nYou were outbid on ${title}.\nYour previous bid: ${previousBid}\nCurrent bid: ${currentBid}\n\nOpen the item to place a new bid:\n${itemUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          ${inlineImage ? `<img src="cid:${escapeHtml(inlineImage.cid)}" alt="${title}" style="display:block;width:100%;max-width:520px;border-radius:18px;margin:0 0 18px;" />` : ""}
          <p>Hello ${displayName},</p>
          <p>You were outbid on <strong>${title}</strong>.</p>
          <p>Your previous bid: <strong>${previousBid}</strong><br />Current bid: <strong>${currentBid}</strong></p>
          <p>Open the item to place a new bid: <a href="${escapeHtml(itemUrl)}">${escapeHtml(itemUrl)}</a></p>
        </div>
      `,
      attachments: inlineImage ? [inlineImage] : []
    };
  }

  const prettyPayload = JSON.stringify(entry.payload, null, 2);
  return {
    text: `${entry.subject}\n\n${prettyPayload}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <p>${escapeHtml(entry.subject)}</p>
        <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px;">${escapeHtml(prettyPayload)}</pre>
      </div>
    `,
    attachments: []
  };
};

const deliverNotification = async (entry: NotificationQueueItem, claimToken: string) => {
  const processedAt = new Date().toISOString();
  const stopLeaseRenewal = startNotificationClaimLeaseRenewal(entry.id, claimToken);
  try {
    if (notificationTransport === "noop") {
      await stopLeaseRenewal();
      await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
      return;
    }
    if (notificationTransport === "smtp") {
      if (!smtpTransporter) {
        throw new Error("SMTP transport is enabled but SMTP_HOST, SMTP_USER, or SMTP_PASS is missing.");
      }
      const content = await renderNotificationContent(entry);
      await smtpTransporter.sendMail({
        from: smtpFrom,
        to: entry.recipient,
        subject: entry.subject,
        text: content.text,
        html: content.html,
        attachments: content.attachments
      });
      await stopLeaseRenewal();
      await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
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
    await stopLeaseRenewal();
    await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
  } catch (error) {
    await stopLeaseRenewal().catch(() => undefined);
    throw error;
  }
};

const processNotificationQueue = async () => {
  if (notificationProcessingInFlight) return 0;
  notificationProcessingInFlight = true;
  try {
    const entries = await getPendingNotificationQueue();
    let processed = 0;
    for (const entry of entries) {
      const claimToken = await claimNotificationQueueEntry(entry);
      if (!claimToken) continue;
      try {
        await deliverNotification(entry, claimToken);
        processed += 1;
      } catch (error) {
        if (error instanceof NotificationClaimLostError) {
          continue;
        }
        const errorMessage = error instanceof Error ? error.message : "Notification processing failed.";
        const now = new Date();
        const currentMeta = {
          attempts: Number(entry.attemptCount || 0),
          nextAttemptAt: entry.nextAttemptAt || undefined
        };
        const retry = buildNotificationMeta(currentMeta, errorMessage, now, notificationMaxAttempts);
        if (retry.nextStatus === "failed") {
          const deadLetterPath = path.join(deadLetterDir, `${now.toISOString().replace(/[:.]/g, "-")}-${entry.id}.json`);
          fs.writeFileSync(deadLetterPath, JSON.stringify({
            id: entry.id,
            eventType: entry.eventType,
            recipient: entry.recipient,
            subject: entry.subject,
            payload: entry.payload,
            errorMessage
          }, null, 2));
          await sendOpsAlert("Notification moved to dead letter", {
            entryId: entry.id,
            eventType: entry.eventType,
            recipient: entry.recipient,
            errorMessage,
            attempts: retry.meta.attempts
          });
        }
        await updateNotificationOutcome(
          entry.id,
          claimToken,
          retry.nextStatus,
          errorMessage,
          now.toISOString(),
          retry.meta.nextAttemptAt || now.toISOString(),
          retry.meta.attempts
        );
      }
    }
    return processed;
  } finally {
    notificationProcessingInFlight = false;
  }
};

const runMaintenanceTasks = async () => {
  if (maintenanceInFlight) return;
  maintenanceInFlight = true;
  try {
    await pruneExpiredDatabaseRows();
    pruneOperationalFiles();
  } catch (error) {
    await sendOpsAlert("Maintenance cleanup failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown maintenance error."
    });
  } finally {
    maintenanceInFlight = false;
  }
};

const startMaintenanceLoop = async () => {
  await runMaintenanceTasks();
  setInterval(() => {
    void runMaintenanceTasks();
  }, maintenancePollMs);
};

const shouldRunApiServer = notificationWorkerMode === "api" || notificationWorkerMode === "both";
const shouldRunNotificationWorker = notificationWorkerMode === "worker" || notificationWorkerMode === "both";

const startNotificationWorkerLoop = async () => {
  if (!shouldRunNotificationWorker) return;
  try {
    await processNotificationQueue();
  } catch (error) {
    await sendOpsAlert("Notification worker startup failure", {
      errorMessage: error instanceof Error ? error.message : "Unknown notification worker error."
    });
    throw error;
  }
  setInterval(() => {
    void processNotificationQueue().catch(async (error) => {
      console.error("Notification processing failed.", error);
      await sendOpsAlert("Notification processing failed", {
        errorMessage: error instanceof Error ? error.message : "Unknown notification processing error."
      });
    });
  }, notificationPollMs);
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
  if (!title || !category || !lot || !sku || !condition || !location) return { ok: false as const, error: "Missing required item fields." };
  if (!startTime || !endTime) return { ok: false as const, error: "Invalid start or end time." };
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) return { ok: false as const, error: "Auction end time must be after start time." };
  if (!Number.isFinite(startBid) || startBid <= 0) return { ok: false as const, error: "Starting bid must be greater than zero." };
  if (!Number.isFinite(reserve) || reserve < 0) return { ok: false as const, error: "Reserve price cannot be negative." };
  if (reserve > 0 && reserve < startBid) return { ok: false as const, error: "Reserve price must be at least the starting bid when provided." };
  if (!Number.isFinite(increment) || increment <= 0) return { ok: false as const, error: "Bid increment must be greater than zero." };
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

const parseCsv = (content: string) => {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    current += char;
  }
  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) =>
    headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = (values[index] || "").trim();
      return acc;
    }, {})
  );
};

const normalizeImportKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

const inspectImportArchive = async (zipPath: string) => {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName.trim())
    .filter(Boolean);
  validateArchiveEntries(entries, maxImportArchiveEntries);
};

const extractImportArchive = (zipPath: string, targetDir: string) => {
  const zip = new AdmZip(zipPath);
  let totalBytes = 0;
  let totalFiles = 0;
  const map = new Map<string, string>();

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const normalizedEntryName = entry.entryName.replace(/\\/g, "/").trim();
    validateArchiveEntries([normalizedEntryName], maxImportArchiveEntries);
    totalFiles += 1;
    if (totalFiles > maxImportArchiveEntries) {
      throw new Error(`The ZIP bundle contains too many extracted files. Maximum allowed is ${maxImportArchiveEntries}.`);
    }

    const data = entry.getData();
    totalBytes += data.length;
    if (totalBytes > maxImportExtractedBytes) {
      throw new Error(`The extracted ZIP bundle exceeds the ${Math.round(maxImportExtractedBytes / (1024 * 1024))} MB safety limit.`);
    }

    const fileName = path.basename(normalizedEntryName);
    const outputPath = path.join(targetDir, `${randomUUID()}-${fileName}`);
    fs.writeFileSync(outputPath, data);
    map.set(fileName.toLowerCase(), outputPath);
  }

  return map;
};

const getImportValue = (row: Record<string, string>, candidates: string[]) => {
  const normalized = Object.entries(row).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[normalizeImportKey(key)] = value;
    return acc;
  }, {});
  for (const candidate of candidates) {
    const value = normalized[normalizeImportKey(candidate)];
    if (typeof value === "string") return value;
  }
  return "";
};

const splitImportList = (value: string) =>
  value
    .split(/[;,|]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const documentExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx"]);
const normalizeDocumentVisibility = (value: string | undefined): DocumentVisibility => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "bidder_visible" || normalized === "winner_only") return normalized;
  return "admin_only";
};

const prepareManagedFile = async (
  sourcePath: string,
  kind: "image" | "document",
  originalName = path.basename(sourcePath),
  visibility: DocumentVisibility = "bidder_visible"
) => {
  const extension = path.extname(sourcePath).toLowerCase();
  if (kind === "image" && !imageExtensions.has(extension)) {
    throw new Error(`Unsupported image file type for ${path.basename(sourcePath)}.`);
  }
  if (kind === "document" && !documentExtensions.has(extension)) {
    throw new Error(`Unsupported document file type for ${path.basename(sourcePath)}.`);
  }
  validateManagedFileContent(sourcePath, originalName, kind);
  let workingPath = sourcePath;
  let workingName = originalName;
  let normalizedPath = "";

  if (kind === "image") {
    const normalized = await normalizeImageForUpload(sourcePath, originalName);
    workingPath = normalized.path;
    workingName = normalized.originalName;
    normalizedPath = normalized.path;
  }

  const scannedPath = await runMalwareScan(workingPath);
  try {
    const stored = await uploadFileToManagedStorage(scannedPath, kind, workingName);
    return {
      id: randomUUID(),
      kind,
      name: kind === "document" ? encodeDocumentNameWithVisibility(originalName, visibility) : workingName,
      url: stored.url
    };
  } finally {
    removeFileIfExists(scannedPath);
    if (normalizedPath) removeFileIfExists(normalizedPath);
  }
};

const copyImportedFile = async (sourcePath: string, kind: "image" | "document", visibility: DocumentVisibility = "bidder_visible") => {
  return prepareManagedFile(sourcePath, kind, path.basename(sourcePath), visibility);
};

const prepareUploadedMulterFile = async (
  file: Express.Multer.File,
  kind: "image" | "document",
  visibility: DocumentVisibility = "bidder_visible"
) => {
  try {
    return await prepareManagedFile(file.path, kind, file.originalname, visibility);
  } finally {
    removeFileIfExists(file.path);
  }
};

const createItemRecord = async (
  req: express.Request,
  validation: Extract<ReturnType<typeof validateNewItem>, { ok: true }>["value"],
  auth: AuthContext,
  extra?: { images?: Array<{ id: string; kind: "image" | "document"; name: string; url: string }>; documents?: Array<{ id: string; kind: "image" | "document"; name: string; url: string }>; currentBid?: number }
) => {
  const itemId = randomUUID();
  const createdAt = new Date().toISOString();
  const images = extra?.images || [];
  const documents = extra?.documents || [];
  await handleSupabase(await supabase.from("categories").upsert({ name: validation.category }, { onConflict: "name" }));
  await handleSupabase(await supabase.from("items").insert({
    id: itemId,
    title: validation.title,
    category: validation.category,
    lot: validation.lot,
    sku: validation.sku,
    condition: validation.condition,
    location: validation.location,
    start_bid: validation.startBid,
    reserve: validation.reserve,
    increment_amount: validation.increment,
    current_bid: extra?.currentBid || 0,
    start_time: validation.startTime,
    end_time: validation.endTime,
    description: validation.description,
    created_at: createdAt
  }));
  if (images.length) {
    await handleSupabase(await supabase.from("item_files").insert(
      images.map((image) => ({
        id: image.id,
        item_id: itemId,
        kind: image.kind,
        name: image.name,
        url: image.url
      }))
    ));
  }
  if (documents.length) {
    await handleSupabase(await supabase.from("item_files").insert(
      documents.map((document) => ({
        id: document.id,
        item_id: itemId,
        kind: document.kind,
        name: document.name,
        url: document.url
      }))
    ));
  }
  await appendAudit(req, {
    eventType: "ITEM_CREATED",
    entityType: "item",
    entityId: itemId,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { title: validation.title, category: validation.category, lot: validation.lot, sku: validation.sku }
  });
  await queueNotification("ITEM_CREATED", `Auction item created: ${validation.title}`, { itemId, title: validation.title });
  return itemId;
};

const findExistingItemByLotOrSku = async (lot: string, sku: string) => {
  const rows = handleSupabase(
    await supabase
      .from("items")
      .select("id,title,lot,sku")
      .or(`lot.eq.${lot},sku.eq.${sku}`)
      .limit(10)
  ) as Array<{ id: string; title: string; lot: string; sku: string }>;
  return rows.find((row) => row.lot === lot || row.sku === sku) || null;
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
    p_idempotency_expires_at: idempotencyExpiresAt
  });
  if (result.error) {
    const message = result.error.message || "Unable to place bid.";
    if (message.includes("ITEM_NOT_FOUND")) {
      return { ok: false as const, status: 404, error: "Item not found." };
    }
    if (message.includes("IDEMPOTENCY_KEY_CONFLICT")) {
      return { ok: false as const, status: 409, error: "Duplicate bid submission detected." };
    }
    if (message.includes("BID_STATE_CHANGED")) {
      return { ok: false as const, status: 409, error: "Item bid state changed. Refresh and try again." };
    }
    if (message.includes("BIDDING_CLOSED")) {
      return { ok: false as const, status: 400, error: "Bidding is closed or not yet open for this item." };
    }
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
    duplicate: Boolean(row?.duplicate)
  };
};

const checkBidRateLimit = async (req: express.Request, actor: string, itemId: string) =>
  recordSharedRateLimitAttempt(req, "BID_ATTEMPT", `${actor}:${itemId}`, bidRateWindowMs, bidRateLimit, { itemId });

const asyncHandler = (
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  void fn(req, res, next).catch(next);
};

const requireAdminToken = asyncHandler(async (req, res, next) => {
  const auth = await getAuthContext(req);
  if (!auth.adminAuthorized) {
    res.status(403).json({
      error: adminApiToken ? "Admin token required." : "Admin access requires an authenticated account with the Admin role."
    });
    return;
  }
  next();
});

const requireSuperAdminToken = asyncHandler(async (req, res, next) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || auth.role !== "SuperAdmin") {
    res.status(403).json({ error: "Super admin access is required." });
    return;
  }
  next();
});

const seedRoles = async () => {
  for (const role of ["SuperAdmin", "Admin", "Bidder", "ShopOwner"]) {
    await handleSupabase(await supabase.from("roles").upsert({ name: role }, { onConflict: "name" }));
  }
};

const seedCategoriesIfEmpty = async () => {
  const rows = handleSupabase(await supabase.from("categories").select("name").limit(1)) as Array<{ name: string }>;
  if (rows.length > 0) return;
  await handleSupabase(await supabase.from("categories").insert(defaultCategories.map((name) => ({ name }))));
};

const seedItemsIfEmpty = async () => {
  const rows = handleSupabase(await supabase.from("items").select("id").limit(1)) as Array<{ id: string }>;
  if (rows.length > 0) return;
  for (const item of seedItems) {
    await handleSupabase(
      await supabase.from("items").insert({
        id: item.id,
        title: item.title,
        category: item.category,
        lot: item.lot,
        sku: item.sku,
        condition: item.condition,
        location: item.location,
        start_bid: item.startBid,
        reserve: item.reserve,
        increment_amount: item.increment,
        current_bid: item.currentBid,
        start_time: item.startTime,
        end_time: item.endTime,
        description: item.description,
        created_at: item.createdAt
      })
    );
    if (item.bids.length) {
      await handleSupabase(
        await supabase.from("bids").insert(
          item.bids.map((bid) => ({
            id: randomUUID(),
            item_id: item.id,
            bidder_alias: bid.bidder,
            amount: bid.amount,
            bid_time: bid.time,
            created_at: bid.createdAt
          }))
        )
      );
    }
  }
  await handleSupabase(
    await supabase.from("audits").insert({
      id: randomUUID(),
      event_type: "SYSTEM_SEED",
      entity_type: "system",
      entity_id: "seed",
      actor: "system",
      actor_type: "system",
      request_id: "seed",
      details_json: { itemCount: seedItems.length },
      created_at: new Date().toISOString()
    })
  );
};

app.get("/api/health", asyncHandler(async (req, res) => {
  res.json({ status: "ok" });
}));

app.get("/api/auth/me", asyncHandler(async (req, res) => {
  const session = await serializeSession(req);
  res.json(session ? { signedIn: true, user: session } : { signedIn: false, user: null });
}));

app.post("/api/auth/resend-verification", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }
  if (!(await checkAuthRateLimit(req, getClientKey(req, `resend:${email}`)))) {
    res.status(429).json({ error: "Too many verification attempts. Please wait and try again." });
    return;
  }
  const user = await getUserByEmail(email);
  if (!user || user.status !== "pending_verification") {
    res.json({ queued: true, message: "If a pending account exists for that email, a fresh verification link has been sent." });
    return;
  }
  const verification = await createEmailVerificationToken(user.id);
  await queueNotification(
    "ACCOUNT_VERIFICATION",
    "Confirm your FMDQ Auctions account",
    { email: user.email, displayName: user.display_name, verifyUrl: verification.verifyUrl },
    user.email
  );
  await appendAudit(req, {
    eventType: "ACCOUNT_VERIFICATION_RESENT",
    entityType: "system",
    entityId: user.id,
    actor: user.display_name,
    actorType: "user",
    details: { email: user.email }
  });
  res.json({ queued: true, message: "A new verification link has been sent to your email." });
}));

app.post("/api/auth/register", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  const displayName = sanitizeDisplayName(String(req.body?.displayName || ""));
  if (!(await checkAuthRateLimit(req, getClientKey(req, `register:${email}`)))) {
    res.status(429).json({ error: "Too many signup attempts. Please wait and try again." });
    return;
  }
  if (!email || !displayName || !password) {
    res.status(400).json({ error: "Display name, email, and password are required." });
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json({ error: passwordRuleMessage });
    return;
  }
  const existing = await getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  const userId = randomUUID();
  const createdAt = new Date().toISOString();
  await handleSupabase(
    await supabase.from("users").insert({
      id: userId,
      email,
      password_hash: hashPassword(password),
      display_name: displayName,
      status: "pending_verification",
      created_at: createdAt,
      last_login_at: null
    })
  );
  await handleSupabase(
    await supabase.from("user_roles").insert({ user_id: userId, role_name: "Bidder", created_at: createdAt })
  );
  const verification = await createEmailVerificationToken(userId);
  await queueNotification(
    "ACCOUNT_VERIFICATION",
    "Confirm your FMDQ Auctions account",
    { email, displayName, verifyUrl: verification.verifyUrl },
    email
  );
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
    verificationUrl: process.env.NODE_ENV === "production" || notificationTransport === "smtp" ? undefined : verification.verifyUrl,
    message: "Account created. Check your email to verify your account, then sign in."
  });
}));

app.post("/api/auth/login", express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  const auditActor = sanitizeDisplayName(email) || "unknown";
  if (!(await checkAuthRateLimit(req, getClientKey(req, `login:${email}`)))) {
    res.status(429).json({ error: "Too many sign-in attempts. Please wait and try again." });
    return;
  }
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash || "")) {
    await appendAudit(req, {
      eventType: "LOGIN_FAILED",
      entityType: "auth",
      entityId: email || "unknown",
      actor: auditActor,
      actorType: "user",
      details: { email, reason: "invalid_credentials" }
    });
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  if (user.status === "pending_verification") {
    await appendAudit(req, {
      eventType: "LOGIN_BLOCKED",
      entityType: "auth",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email, reason: "pending_verification" }
    });
    res.status(403).json({ error: "Please verify your email before signing in." });
    return;
  }
  if (user.status !== "active") {
    await appendAudit(req, {
      eventType: "LOGIN_BLOCKED",
      entityType: "auth",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email, reason: `status_${user.status}` }
    });
    res.status(403).json({ error: "This account is not active." });
    return;
  }
  const lastLoginAt = new Date().toISOString();
  await handleSupabase(await supabase.from("users").update({ last_login_at: lastLoginAt }).eq("id", user.id));
  const sessionRecord = await createUserSession(res, user.id);
  const roles = await getUserRoles(user.id);
  const role = normalizeRole(roles.map((row) => row.role_name));
  await appendAudit(req, {
    eventType: "LOGIN_SUCCEEDED",
    entityType: "auth",
    entityId: user.id,
    actor: user.display_name,
    actorType: "user",
    details: { email: user.email, role, sessionId: sessionRecord.sessionId }
  });
  res.json({
    signedIn: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      createdAt: user.created_at,
      lastLoginAt,
      role
    },
    csrfToken: buildCsrfToken(sessionRecord.sessionId)
  });
}));

app.post("/api/auth/verify-email", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!(await checkAuthRateLimit(req, getClientKey(req, `verify:${token.slice(0, 12)}`)))) {
    res.status(429).json({ error: "Too many verification attempts. Please wait and try again." });
    return;
  }
  if (!token) {
    res.status(400).json({ error: "Verification token is required." });
    return;
  }
  const row = await getEmailVerificationRow(token);
  if (!row) {
    res.status(404).json({ error: "Verification link is invalid or has already been used." });
    return;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("token", token));
    res.status(410).json({ error: "Verification link has expired. Please create your account again or request a new link." });
    return;
  }
  const user = await getUserById(row.user_id);
  if (!user) {
    await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("token", token));
    res.status(404).json({ error: "Account not found for this verification link." });
    return;
  }
  await handleSupabase(await supabase.from("users").update({ status: "active" }).eq("id", user.id));
  await handleSupabase(await supabase.from("email_verification_tokens").delete().eq("user_id", user.id));
  await queueNotification(
    "ACCOUNT_VERIFIED",
    "FMDQ Auctions account verified",
    {
      email: user.email,
      displayName: user.display_name
    },
    user.email
  );
  await appendAudit(req, {
    eventType: "ACCOUNT_VERIFIED",
    entityType: "system",
    entityId: user.id,
    actor: user.display_name,
    actorType: "user",
    details: { email: user.email, status: "active" }
  });
  res.json({ verified: true, message: "Your account has been verified. You can now sign in." });
}));

app.post("/api/auth/request-password-reset", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const email = normalizeEmail(String(req.body?.email || ""));
  if (!(await checkAuthRateLimit(req, getClientKey(req, `reset-request:${email}`)))) {
    res.status(429).json({ error: "Too many password reset requests. Please wait and try again." });
    return;
  }
  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }
  const user = await getUserByEmail(email);
  if (user && user.status === "active") {
    await queuePasswordReset(user, "self-service");
    await appendAudit(req, {
      eventType: "PASSWORD_RESET_REQUESTED",
      entityType: "system",
      entityId: user.id,
      actor: user.display_name,
      actorType: "user",
      details: { email: user.email, channel: "email" }
    });
  }
  res.json({
    requested: true,
    message: "If an active account exists for that email, a password reset link has been sent."
  });
}));

app.post("/api/auth/reset-password", express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  if (!(await checkAuthRateLimit(req, getClientKey(req, `reset:${token.slice(0, 12)}`)))) {
    res.status(429).json({ error: "Too many password reset attempts. Please wait and try again." });
    return;
  }
  if (!token || !password) {
    res.status(400).json({ error: "Token and new password are required." });
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json({ error: passwordRuleMessage });
    return;
  }
  const payload = parseSignedToken<{ type: string; sub: string; exp: string; fp: string }>(token);
  if (!payload || payload.type !== "password-reset") {
    res.status(400).json({ error: "Password reset link is invalid." });
    return;
  }
  if (new Date(payload.exp).getTime() <= Date.now()) {
    res.status(410).json({ error: "Password reset link has expired." });
    return;
  }
  const user = await getUserByIdWithPassword(payload.sub);
  if (!user || user.status !== "active") {
    res.status(404).json({ error: "Account not found for this reset link." });
    return;
  }
  if (passwordHashFingerprint(user.password_hash || "") !== payload.fp) {
    res.status(409).json({ error: "This reset link is no longer valid. Request a new one." });
    return;
  }
  await handleSupabase(await supabase.from("users").update({ password_hash: hashPassword(password) }).eq("id", user.id));
  await handleSupabase(await supabase.from("sessions").delete().eq("user_id", user.id));
  await appendAudit(req, {
    eventType: "PASSWORD_RESET_COMPLETED",
    entityType: "system",
    entityId: user.id,
    actor: user.display_name,
    actorType: "user",
    details: { email: user.email }
  });
  res.json({ reset: true, message: "Password updated successfully. You can now sign in." });
}));

app.post("/api/auth/logout", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  const sessionId = parseCookies(req)[sessionCookieName];
  if (auth.signedIn && auth.userId) {
    await appendAudit(req, {
      eventType: "LOGOUT_SUCCEEDED",
      entityType: "auth",
      entityId: auth.userId,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { sessionId: sessionId || "unknown" }
    });
  }
  if (sessionId) {
    await deleteSessionRow(sessionId).catch(() => undefined);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/me/profile", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = await getUserById(auth.userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const roles = await getUserRoles(user.id);
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    role: auth.role,
    roles: roles.map((row) => normalizeDisplayRoleName(row.role_name))
  });
}));

app.get("/api/me/sessions", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const currentSessionId = parseCookies(req)[sessionCookieName] || "";
  const sessions = await getUserSessions(auth.userId);
  res.json(sessions.map((session) => ({
    id: session.id,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    current: session.id === currentSessionId
  })));
}));

app.delete("/api/me/sessions/:id", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const session = await getSessionRow(String(req.params.id || ""));
  if (!session || session.user_id !== auth.userId) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await deleteSessionRow(session.id);
  const currentSessionId = parseCookies(req)[sessionCookieName] || "";
  if (session.id === currentSessionId) {
    clearSessionCookie(res);
  }
  await appendAudit(req, {
    eventType: "SESSION_REVOKED",
    entityType: "user",
    entityId: auth.userId,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { sessionId: session.id }
  });
  res.json({ revoked: true, message: "Session revoked." });
}));

app.delete("/api/me/sessions", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const currentSessionId = parseCookies(req)[sessionCookieName] || "";
  const sessions = await getUserSessions(auth.userId);
  const revocable = sessions.filter((session) => session.id !== currentSessionId);
  for (const session of revocable) {
    await deleteSessionRow(session.id);
  }
  await appendAudit(req, {
    eventType: "SESSIONS_REVOKED",
    entityType: "user",
    entityId: auth.userId,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { count: revocable.length }
  });
  res.json({ revoked: true, count: revocable.length, message: `Revoked ${revocable.length} other session(s).` });
}));

app.get("/api/me/dashboard", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const bidRecords = await getUserBidRecords(auth.userId);
  const sessions = await getUserSessions(auth.userId);
  const closedItems = (await getItems(true)).filter((item) => new Date(item.endTime).getTime() < Date.now());
  res.json({
    summary: {
      openBidCount: bidRecords.filter((record) => ["winning", "outbid", "active"].includes(record.status)).length,
      wonAuctionCount: bidRecords.filter((record) => record.status === "won").length,
      activeSessionCount: sessions.length,
      totalBidCount: bidRecords.length,
      reserveMetClosedCount: closedItems.filter((item) => getReserveState(item) === "reserve_met").length,
      reserveNotMetClosedCount: closedItems.filter((item) => getReserveState(item) === "reserve_not_met").length
    },
    recentBidActivity: bidRecords.slice(0, 8)
  });
}));

app.get("/api/me/bids", asyncHandler(async (req, res) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !auth.userId) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  res.json(await getUserBidRecords(auth.userId));
}));

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
      if (!auth.adminAuthorized && (!itemVisible || auth.role !== "Bidder")) {
        res.status(403).json({ error: "You do not have access to this image." });
        return;
      }
    }
  }
  const localFileName = safeFileName(rawFile);
  const localPath = path.join(imagesDir, localFileName);
  if (localFileName && fs.existsSync(localPath)) {
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
  res.setHeader("Content-Type", result.data.type || guessContentType(storagePath, "image/jpeg"));
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
  if (localFileName && fs.existsSync(localPath)) {
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
  res.setHeader("Content-Type", result.data.type || guessContentType(parsedDocument.displayName, "application/octet-stream"));
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

app.get("/api/categories", asyncHandler(async (req, res) => {
  res.json(await getCategories());
}));

app.get("/api/landing-stats", asyncHandler(async (req, res) => {
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
    details: { category: validation.value }
  });
  res.json({ ok: true });
}));

app.get("/api/exports/items.csv", requireAdminToken, asyncHandler(async (req, res) => {
  const items = await getItems();
  const rows = items.map((item) => ({
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
  const rows = handleSupabase(
    await supabase
      .from("audits")
      .select("id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at")
      .order("created_at", { ascending: false })
  ) as AuditRow[];
  const formatted = rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor,
    actorType: row.actor_type,
    requestId: row.request_id,
    details: typeof row.details_json === "string" ? row.details_json : JSON.stringify(row.details_json || {}),
    createdAt: row.created_at
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
  const bidAudits = await getBidAuditRowsForUser(auth.userId!);
  const wins = bidAudits.flatMap((row) => {
    const item = itemsById.get(row.entity_id);
    if (!item) return [];
    const details = parseAuditDetails(row.details_json);
    const won = new Date(item.endTime).getTime() < Date.now() && item.currentBid > 0 && Number(details.amount || 0) === item.currentBid;
    return won ? [{ id: item.id, title: item.title, category: item.category, currentBid: item.currentBid, endTime: item.endTime }] : [];
  });
  res.json(Array.from(new Map(wins.map((row) => [row.id, row])).values()));
}));

app.get("/api/admin/operations", requireAdminToken, asyncHandler(async (req, res) => {
  const items = await getItems(true);
  const pendingNotifications = handleSupabase(await supabase.from("notification_queue").select("id").eq("status", "pending")) as Array<{ id: string }>;
  const audits = handleSupabase(await supabase.from("audits").select("id")) as Array<{ id: string }>;
  const wins = handleSupabase(await supabase.from("audits").select("id").eq("event_type", "BID_PLACED")) as Array<{ id: string }>;
  const users = await listUsersWithRoles();
  const summary = {
    totalItems: items.length,
    liveCount: items.filter((item) => new Date(item.startTime).getTime() <= Date.now() && new Date(item.endTime).getTime() >= Date.now() && !item.archivedAt).length,
    closedCount: items.filter((item) => new Date(item.endTime).getTime() < Date.now() && !item.archivedAt).length,
    archivedCount: items.filter((item) => Boolean(item.archivedAt)).length,
    pendingNotifications: pendingNotifications.length,
    auditCount: audits.length,
    wins: wins.length,
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status === "active").length,
    disabledUsers: users.filter((user) => user.status === "disabled").length,
    adminUsers: users.filter((user) => user.roles.includes("Admin")).length,
    superAdminUsers: users.filter((user) => user.roles.includes("SuperAdmin")).length
  };
  res.json({
    summary,
    metrics: {
      totalItems: summary.totalItems,
      liveItems: summary.liveCount,
      closedItems: summary.closedCount,
      archivedItems: summary.archivedCount,
      pendingNotifications: summary.pendingNotifications,
      auditEvents: summary.auditCount,
      wins: summary.wins
    },
    recentAudits: await getRecentAudits(20),
    notificationQueue: await getNotificationQueue(20)
  });
}));

app.get("/api/admin/audits", requireAdminToken, asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const eventType = String(req.query.eventType || "").trim();
  const actor = String(req.query.actor || "").trim();
  const entityType = String(req.query.entityType || "").trim();
  const includeSecurity = String(req.query.includeSecurity || "") === "1";
  let request = supabase
    .from("audits")
    .select("id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (itemId) request = request.eq("entity_id", itemId);
  if (from) request = request.gte("created_at", from);
  if (to) request = request.lte("created_at", to);
  if (eventType) request = request.eq("event_type", eventType);
  if (actor) request = request.ilike("actor", `%${actor}%`);
  if (entityType) request = request.eq("entity_type", entityType);
  const rows = handleSupabase(await request) as AuditRow[];
  const filteredRows = includeSecurity ? rows : rows.filter((row) => !securityTelemetryEvents.has(row.event_type));
  const actorRoleLookup = await getAuditActorRoleLookup();
  res.json(filteredRows.map((row) => ({
    ...row,
    actor_role:
      (typeof row.details_json === "object" &&
      row.details_json !== null &&
      "actorRole" in row.details_json &&
      typeof row.details_json.actorRole === "string"
        ? row.details_json.actorRole
        : null) ??
      actorRoleLookup.get(row.actor) ??
      null,
  })));
}));

app.get("/api/admin/notifications", requireAdminToken, asyncHandler(async (req, res) => {
  res.json(await getNotificationQueue(200));
}));

app.post("/api/admin/notifications/process", requireAdminToken, asyncHandler(async (req, res) => {
  const processed = await processNotificationQueue();
  res.json({ processed, transport: notificationTransport });
}));

app.get("/api/admin/users", requireAdminToken, asyncHandler(async (req, res) => {
  res.json(await listUsersWithRoles());
}));

app.get("/api/admin/roles", requireAdminToken, asyncHandler(async (req, res) => {
  res.json(await getRoles());
}));

app.post("/api/admin/users/:id/roles", requireSuperAdminToken, express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const roleName = String(req.body?.roleName || "").trim();
  if (!userId || !roleName) {
    res.status(400).json({ error: "User ID and role name are required." });
    return;
  }
  const availableRoles = await getRoles();
  if (!availableRoles.includes(roleName)) {
    res.status(400).json({ error: "That role does not exist." });
    return;
  }
  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  await handleSupabase(await supabase.from("user_roles").upsert({ user_id: user.id, role_name: roleName, created_at: new Date().toISOString() }, { onConflict: "user_id,role_name" }));
  const auth = await getAuthContext(req);
  await appendAudit(req, {
    eventType: "USER_ROLE_ASSIGNED",
    entityType: "user",
    entityId: user.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { email: user.email, role: roleName }
  });
  res.json({ updated: true, message: `${roleName} assigned to ${user.display_name}.` });
}));

app.delete("/api/admin/users/:id/roles/:roleName", requireSuperAdminToken, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const roleName = String(req.params.roleName || "").trim();
  if (!userId || !roleName) {
    res.status(400).json({ error: "User ID and role name are required." });
    return;
  }
  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  if ((await getUserRoles(user.id)).length <= 1) {
    res.status(400).json({ error: "Every user must retain at least one role." });
    return;
  }
  await handleSupabase(await supabase.from("user_roles").delete().eq("user_id", user.id).eq("role_name", roleName));
  const auth = await getAuthContext(req);
  await appendAudit(req, {
    eventType: "USER_ROLE_REMOVED",
    entityType: "user",
    entityId: user.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { email: user.email, role: roleName }
  });
  res.json({ updated: true, message: `${roleName} removed from ${user.display_name}.` });
}));

app.post("/api/admin/users/:id/disable", requireAdminToken, express.json({ limit: "64kb" }), asyncHandler(async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const auth = await getAuthContext(req);
  const reason = sanitizeDisplayName(String(req.body?.reason || "")) || "No reason provided";
  if (!userId) {
    res.status(400).json({ error: "User ID is required." });
    return;
  }
  if (auth.userId && auth.userId === userId) {
    res.status(400).json({ error: "You cannot disable your own account." });
    return;
  }
  const user = await getUserByIdWithPassword(userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const targetRoles = (await getUserRoles(user.id)).map((row) => row.role_name);
  const targetCheck = ensureCanManageTargetUser(auth, targetRoles);
  if (!targetCheck.ok) {
    res.status(403).json({ error: targetCheck.error });
    return;
  }
  if (user.status === "disabled") {
    res.json({ updated: true, message: `${user.display_name} is already disabled.` });
    return;
  }
  await handleSupabase(
    await supabase
      .from("users")
      .update({ status: "disabled" })
      .eq("id", user.id)
  );
  await handleSupabase(await supabase.from("sessions").delete().eq("user_id", user.id));
  await appendAudit(req, {
    eventType: "USER_DISABLED",
    entityType: "user",
    entityId: user.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { email: user.email, target: user.display_name, reason }
  });
  res.json({ updated: true, message: `${user.display_name} has been disabled and signed out everywhere.` });
}));

app.post("/api/admin/users/:id/enable", requireAdminToken, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const auth = await getAuthContext(req);
  if (!userId) {
    res.status(400).json({ error: "User ID is required." });
    return;
  }
  const user = await getUserByIdWithPassword(userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const targetRoles = (await getUserRoles(user.id)).map((row) => row.role_name);
  const targetCheck = ensureCanManageTargetUser(auth, targetRoles);
  if (!targetCheck.ok) {
    res.status(403).json({ error: targetCheck.error });
    return;
  }
  if (user.status === "active") {
    res.json({ updated: true, message: `${user.display_name} is already active.` });
    return;
  }
  await handleSupabase(
    await supabase
      .from("users")
      .update({ status: "active" })
      .eq("id", user.id)
  );
  await appendAudit(req, {
    eventType: "USER_ENABLED",
    entityType: "user",
    entityId: user.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { email: user.email, target: user.display_name }
  });
  res.json({ updated: true, message: `${user.display_name} has been re-enabled.` });
}));

app.post("/api/admin/users/:id/password-reset", requireAdminToken, asyncHandler(async (req, res) => {
  const user = await getUserByIdWithPassword(String(req.params.id || "").trim());
  if (!user || user.status !== "active") {
    res.status(404).json({ error: "Active user not found." });
    return;
  }
  const auth = await getAuthContext(req);
  const targetRoles = (await getUserRoles(user.id)).map((row) => row.role_name);
  const targetCheck = ensureCanManageTargetUser(auth, targetRoles);
  if (!targetCheck.ok) {
    res.status(403).json({ error: targetCheck.error });
    return;
  }
  await queuePasswordReset(user, auth.actor);
  await appendAudit(req, {
    eventType: "PASSWORD_RESET_FORCED",
    entityType: "system",
    entityId: user.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { email: user.email, target: user.display_name }
  });
  res.json({ queued: true, count: 1, message: `Password reset sent to ${user.email}.` });
}));

app.post("/api/admin/users/password-resets", requireAdminToken, express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
  const scope = String(req.body?.scope || "selected");
  const role = String(req.body?.role || "").trim();
  const selectedIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((value: unknown) => String(value).trim()).filter(Boolean) : [];
  const auth = await getAuthContext(req);
  const users = (await listUsersWithRoles()).filter((user) => user.status === "active");
  const targets = users.filter((user) => {
    if (scope === "all") return true;
    if (scope === "role") return role ? user.roles.includes(role) : false;
    return selectedIds.includes(user.id);
  }).filter((user) => auth.role === "SuperAdmin" || !user.roles.includes("SuperAdmin"));
  if (!targets.length) {
    res.status(400).json({ error: "No users matched the selected bulk reset criteria." });
    return;
  }
  for (const target of targets) {
    await queuePasswordReset({
      id: target.id,
      email: target.email,
      display_name: target.displayName,
      status: target.status,
      created_at: target.createdAt,
      last_login_at: target.lastLoginAt,
      password_hash: (await getUserByIdWithPassword(target.id))?.password_hash
    }, auth.actor);
  }
  await appendAudit(req, {
    eventType: "PASSWORD_RESET_BULK_FORCED",
    entityType: "system",
    entityId: scope === "role" ? role || "bulk" : scope,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { scope, count: targets.length, role: role || "n/a" }
  });
  res.json({ queued: true, count: targets.length, message: `Queued password resets for ${targets.length} user(s).` });
}));

app.post("/api/admin/users/bulk-import", requireSuperAdminToken, bulkImportUpload.single("csv"), asyncHandler(async (req, res) => {
  const csvFile = req.file;
  if (!csvFile) {
    res.status(400).json({ error: "Upload a CSV file first." });
    return;
  }

  const auth = await getAuthContext(req);
  const report: {
    created: number;
    skipped: number;
    failed: number;
    items: Array<{ row: number; status: "created" | "skipped" | "failed"; email: string; message: string }>;
  } = { created: 0, skipped: 0, failed: 0, items: [] };

  try {
    const rows = parseCsv(fs.readFileSync(csvFile.path, "utf8"));
    if (!rows.length) {
      res.status(400).json({ error: "The uploaded CSV is empty." });
      return;
    }
    const availableRoles = await getRoles();
    for (const [index, row] of rows.entries()) {
      const email = normalizeEmail(getImportValue(row, ["email"]));
      const displayName = sanitizeDisplayName(getImportValue(row, ["display_name", "displayName", "full_name", "name"]));
      const roles = splitImportList(getImportValue(row, ["roles", "role"])).filter((role) => availableRoles.includes(role));
      const status = getImportValue(row, ["status"]).trim() || "pending_verification";
      if (!email || !displayName) {
        report.failed += 1;
        report.items.push({ row: index + 2, status: "failed", email: email || `row-${index + 2}`, message: "Email and display name are required." });
        continue;
      }
      if (await getUserByEmail(email)) {
        report.skipped += 1;
        report.items.push({ row: index + 2, status: "skipped", email, message: "Skipped because a user with that email already exists." });
        continue;
      }
      const userId = randomUUID();
      const createdAt = new Date().toISOString();
      const assignedRoles = roles.length ? roles : ["Bidder"];
      await handleSupabase(await supabase.from("users").insert({
        id: userId,
        email,
        password_hash: hashPassword(randomUUID()),
        display_name: displayName,
        status: status === "active" || status === "disabled" ? status : "pending_verification",
        created_at: createdAt,
        last_login_at: null
      }));
      await handleSupabase(await supabase.from("user_roles").insert(
        assignedRoles.map((roleName) => ({
          user_id: userId,
          role_name: roleName,
          created_at: createdAt
        }))
      ));
      if (status === "active") {
        const user = await getUserByEmail(email);
        if (user) {
          await queuePasswordReset(user, auth.actor);
        }
      } else {
        const verification = await createEmailVerificationToken(userId);
        await queueNotification(
          "ACCOUNT_VERIFICATION",
          "Confirm your FMDQ Auctions account",
          { email, displayName, verifyUrl: verification.verifyUrl },
          email
        );
      }
      report.created += 1;
      report.items.push({ row: index + 2, status: "created", email, message: `Created with roles: ${assignedRoles.join(", ")}.` });
    }
    await appendAudit(req, {
      eventType: "USER_BULK_IMPORTED",
      entityType: "system",
      entityId: "user-bulk-import",
      actor: auth.actor,
      actorType: auth.actorType,
      details: { created: report.created, skipped: report.skipped, failed: report.failed }
    });
    res.json(report);
  } finally {
    removeFileIfExists(csvFile.path);
  }
}));

app.post("/api/items/bulk-import", requireAdminToken, bulkImportUpload.fields([{ name: "csv", maxCount: 1 }, { name: "bundle", maxCount: 1 }]), asyncHandler(async (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const csvFile = files?.csv?.[0];
  const zipFile = files?.bundle?.[0];
  if (!csvFile) {
    res.status(400).json({ error: "Upload a CSV file first." });
    return;
  }

  const auth = await getAuthContext(req);
  const tempExtractDir = fs.mkdtempSync(path.join(importsDir, "bulk-"));
  const createdIds: string[] = [];
  const report: {
    created: number;
    skipped: number;
    failed: number;
    items: Array<{ row: number; status: "created" | "skipped" | "failed"; title: string; itemId?: string; message: string }>;
  } = {
    created: 0,
    skipped: 0,
    failed: 0,
    items: []
  };

  try {
    const csvRows = parseCsv(fs.readFileSync(csvFile.path, "utf8"));
    if (!csvRows.length) {
      res.status(400).json({ error: "The uploaded CSV is empty." });
      return;
    }

    let extractedFiles = new Map<string, string>();
    if (zipFile) {
      await inspectImportArchive(zipFile.path);
      extractedFiles = extractImportArchive(zipFile.path, tempExtractDir);
    }

    for (const [index, row] of csvRows.entries()) {
      const title = getImportValue(row, ["title", "item_title"]);
      try {
        const payload = {
          title,
          category: getImportValue(row, ["category"]),
          lot: getImportValue(row, ["lot", "lot_number"]),
          sku: getImportValue(row, ["sku", "asset_code", "sku_asset_code"]),
          condition: getImportValue(row, ["condition"]),
          location: getImportValue(row, ["location"]),
          startBid: getImportValue(row, ["start_bid", "starting_bid"]),
          reserve: getImportValue(row, ["reserve", "reserve_price"]),
          increment: getImportValue(row, ["increment", "bid_increment"]),
          startTime: getImportValue(row, ["start_time", "auction_start", "start"]),
          endTime: getImportValue(row, ["end_time", "auction_end", "end"]),
          description: getImportValue(row, ["description", "item_description"])
        };
        const validation = validateNewItem(payload);
        if (!validation.ok) {
          report.failed += 1;
          report.items.push({ row: index + 2, status: "failed", title: title || `Row ${index + 2}`, message: validation.error });
          continue;
        }

        const duplicate = await findExistingItemByLotOrSku(validation.value.lot, validation.value.sku);
        if (duplicate) {
          report.skipped += 1;
          report.items.push({ row: index + 2, status: "skipped", title: validation.value.title, itemId: duplicate.id, message: `Skipped because lot or SKU already exists on ${duplicate.title}.` });
          continue;
        }

        const normalizedRow = Object.entries(row).reduce<Record<string, string>>((acc, [key, value]) => {
          acc[normalizeImportKey(key)] = value;
          return acc;
        }, {});
        const imageNames = Object.entries(normalizedRow)
          .filter(([key, value]) => key.startsWith("image") && value.trim())
          .flatMap(([, value]) => splitImportList(value));
        const documentEntries = Object.entries(normalizedRow)
          .filter(([key, value]) => (key.startsWith("document") || key.startsWith("doc")) && value.trim())
          .flatMap(([key, value]) => splitImportList(value).map((name) => ({
            key,
            name,
            visibility: normalizeDocumentVisibility(
              normalizedRow[`${key}_visibility`] || normalizedRow.document_visibility || normalizedRow.doc_visibility
            )
          })));

        const imageFiles = await Promise.all(imageNames.map(async (name) => {
          const sourcePath = extractedFiles.get(name.toLowerCase());
          if (!sourcePath) throw new Error(`Image file "${name}" was not found in the ZIP.`);
          return copyImportedFile(sourcePath, "image");
        }));
        const documentFiles = await Promise.all(documentEntries.map(async (entry) => {
          const sourcePath = extractedFiles.get(entry.name.toLowerCase());
          if (!sourcePath) throw new Error(`Document file "${entry.name}" was not found in the ZIP.`);
          return copyImportedFile(sourcePath, "document", entry.visibility);
        }));

        const itemId = await createItemRecord(req, validation.value, auth, { images: imageFiles, documents: documentFiles });
        createdIds.push(itemId);
        report.created += 1;
        report.items.push({ row: index + 2, status: "created", title: validation.value.title, itemId, message: "Imported successfully." });
      } catch (error) {
        report.failed += 1;
        report.items.push({
          row: index + 2,
          status: "failed",
          title: title || `Row ${index + 2}`,
          message: error instanceof Error ? error.message : "Import failed."
        });
      }
    }

    await appendAudit(req, {
      eventType: "ITEM_BULK_IMPORTED",
      entityType: "system",
      entityId: "bulk-import",
      actor: auth.actor,
      actorType: auth.actorType,
      details: { created: report.created, skipped: report.skipped, failed: report.failed }
    });
    res.json(report);
  } finally {
    removeFileIfExists(csvFile.path);
    if (zipFile) removeFileIfExists(zipFile.path);
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }
}));

app.post("/api/items", requireAdminToken, upload.fields([{ name: "images", maxCount: 8 }, { name: "documents", maxCount: 8 }]), asyncHandler(async (req, res) => {
  const validation = validateNewItem(req.body as Record<string, string>);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const images = files?.images || [];
  const documents = files?.documents || [];
  const auth = await getAuthContext(req);
  const documentVisibility = normalizeDocumentVisibility(String(req.body.documentVisibility || "admin_only"));
  const preparedImages = await Promise.all(images.map((image) => prepareUploadedMulterFile(image, "image")));
  const preparedDocuments = await Promise.all(documents.map((document) => prepareUploadedMulterFile(document, "document", documentVisibility)));
  const itemId = await createItemRecord(req, validation.value, auth, {
    images: preparedImages,
    documents: preparedDocuments
  });
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
  const documentVisibility = normalizeDocumentVisibility(String(req.body.documentVisibility || "admin_only"));
  const preparedImages = await Promise.all(images.map((image) => prepareUploadedMulterFile(image, "image")));
  const preparedDocuments = await Promise.all(documents.map((document) => prepareUploadedMulterFile(document, "document", documentVisibility)));

  await handleSupabase(await supabase.from("categories").upsert({ name: validation.value.category }, { onConflict: "name" }));
  await handleSupabase(
    await supabase.from("items").update({
      title: validation.value.title,
      category: validation.value.category,
      lot: validation.value.lot,
      sku: validation.value.sku,
      condition: validation.value.condition,
      location: validation.value.location,
      start_bid: validation.value.startBid,
      reserve: validation.value.reserve,
      increment_amount: validation.value.increment,
      start_time: validation.value.startTime,
      end_time: validation.value.endTime,
      description: validation.value.description
    }).eq("id", existing.id)
  );
  if (images.length) {
    await handleSupabase(await supabase.from("item_files").insert(
      preparedImages.map((image) => ({
        id: randomUUID(),
        item_id: existing.id,
        kind: "image",
        name: image.name,
        url: image.url
      }))
    ));
  }
  if (documents.length) {
    await handleSupabase(await supabase.from("item_files").insert(
      preparedDocuments.map((document) => ({
        id: randomUUID(),
        item_id: existing.id,
        kind: "document",
        name: document.name,
        url: document.url
      }))
    ));
  }
  await appendAudit(req, {
    eventType: "ITEM_UPDATED",
    entityType: "item",
    entityId: existing.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { title: validation.value.title, category: validation.value.category }
  });
  await queueNotification("ITEM_UPDATED", `Auction item updated: ${validation.value.title}`, { itemId: existing.id, title: validation.value.title });
  res.json(await getItemById(existing.id, true));
}));

app.delete("/api/items/:id", requireAdminToken, asyncHandler(async (req, res) => {
  const existing = await getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  const auth = await getAuthContext(req);
  await handleSupabase(await supabase.from("items").update({ archived_at: new Date().toISOString() }).eq("id", existing.id));
  await appendAudit(req, {
    eventType: "ITEM_ARCHIVED",
    entityType: "item",
    entityId: existing.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { title: existing.title }
  });
  await queueNotification("ITEM_ARCHIVED", `Auction item archived: ${existing.title}`, { itemId: existing.id, title: existing.title });
  res.json({ ok: true });
}));

app.post("/api/items/:id/restore", requireAdminToken, asyncHandler(async (req, res) => {
  const existing = await getItemById(req.params.id, true);
  if (!existing) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  const auth = await getAuthContext(req);
  await handleSupabase(await supabase.from("items").update({ archived_at: null }).eq("id", existing.id));
  await appendAudit(req, {
    eventType: "ITEM_RESTORED",
    entityType: "item",
    entityId: existing.id,
    actor: auth.actor,
    actorType: auth.actorType,
    details: { title: existing.title }
  });
  await queueNotification("ITEM_RESTORED", `Auction item restored: ${existing.title}`, { itemId: existing.id, title: existing.title });
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
      bidSequence: bidResult.bidSequence,
      auctionItemId: item.id,
      bidId: bidResult.bidId,
      bidderUserId: persistedBidderUserId
    }
  });
  await queueBidActivityNotifications(
    { ...item, currentBid: bidResult.currentBid },
    {
      userId: auth.userId,
      email: biddingUser?.email,
      displayName: biddingUser?.display_name || actor
    },
    amount,
    item.currentBid > 0
      ? {
          bidder: "",
          bidderUserId: bidResult.previousBidderUserId || null,
          amount: item.currentBid,
          time: "",
          createdAt: ""
        }
      : undefined
  );
  res.json(await getItemById(item.id));
}));

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(error);
  void reportServerError(req, error);
  const requestId = String((req as express.Request & { requestId?: string }).requestId || res.locals.requestId || "");
  const safeError = process.env.NODE_ENV === "production"
    ? `Internal server error. Request ID: ${requestId}`
    : error instanceof Error
      ? error.message
      : "Internal server error.";
  res.status(500).json({ error: safeError });
});

const start = async () => {
  await handleSupabase(await supabase.from("roles").select("name").limit(1));
  await verifyRequiredSchemaMigrations();
  await detectSecurityEventsTable();
  await verifyMalwareScannerHealth();
  await ensureStorageBuckets();
  await startMaintenanceLoop();
  await seedRoles();
  await seedCategoriesIfEmpty();
  await seedItemsIfEmpty();
  await backfillLegacyBidAuditAttribution();
  await handleSupabase(await supabase.from("sessions").delete().lte("expires_at", new Date().toISOString()));
  await handleSupabase(await supabase.from("email_verification_tokens").delete().lte("expires_at", new Date().toISOString()));
  if (notificationTransport === "smtp") {
    if (!smtpTransporter) {
      throw new Error("SMTP transport is enabled but SMTP_HOST, SMTP_USER, or SMTP_PASS is missing.");
    }
    await smtpTransporter.verify();
  }
  await startNotificationWorkerLoop();
  if (!shouldRunApiServer) {
    console.log(`Notification worker running in ${notificationWorkerMode} mode.`);
    console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
    return;
  }
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
    console.log("Storage backend: supabase-js");
    console.log(`Notification worker mode: ${notificationWorkerMode}`);
    console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
  });
};

const shouldAutoStart = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (shouldAutoStart) {
  void start().catch((error) => {
    console.error("Unable to start API server.");
    console.error(error);
    process.exit(1);
  });
}

export { app, start };
