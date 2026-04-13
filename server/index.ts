import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  buildCsrfTokenValue,
  canAccessDocumentVisibility,
  ensureCanManageTargetRoles,
  parseDocumentNameWithVisibility,
  type DocumentVisibility,
  validateBidAmount,
  validateMalwareScanConfiguration
} from "./security-logic.js";
import { createItemReadModel } from "./item-read-model.js";
import { createAuthService } from "./auth-service.js";
import { createAdminService } from "./admin-service.js";
import { createNotificationService } from "./notification-service.js";
import { createItemWriteService } from "./item-write-service.js";
import { createBidService } from "./bid-service.js";
import { createBootstrapService } from "./bootstrap.js";
import { registerAuthRoutes } from "./register-auth-routes.js";
import { registerCatalogRoutes } from "./register-catalog-routes.js";
import type { AuditEntry, AuditRow, AuthContext, NotificationQueueItem, Role, UserRow } from "./server-types.js";
import {
  canBidWithRole,
  canViewItemOperationsWithRole,
  canViewReserveWithRole,
  isSuperAdminRole,
  normalizeDisplayRoleName,
  normalizeRole,
} from "../shared/permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnvFile = async () => {
  const envPath = path.join(path.dirname(__dirname), ".env");
  try {
    await fs.promises.access(envPath, fs.constants.F_OK);
  } catch {
    return;
  }
  const contents = await fs.promises.readFile(envPath, "utf8");
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

await loadEnvFile();

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
const smtpConnectionTimeoutMs = Math.max(Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10_000), 1_000);
const smtpGreetingTimeoutMs = Math.max(Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10_000), 1_000);
const smtpSocketTimeoutMs = Math.max(Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15_000), 1_000);
const smtpVerifyTimeoutMs = Math.max(Number(process.env.SMTP_VERIFY_TIMEOUT_MS || 12_000), 1_000);
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
const ensureRuntimeDirectories = async () => {
  await Promise.all(
    [dataDir, outboxDir, deadLetterDir, importsDir, uploadsDir, tempUploadsDir, quarantineDir, imagesDir, docsDir].map((dir) =>
      fs.promises.mkdir(dir, { recursive: true })
    )
  );
};
await ensureRuntimeDirectories();

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
type PaginatedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const defaultCategories = ["Cars", "Furniture", "Household Appliances", "Kitchen Appliances", "Phones", "Other"];
const smtpTransporter = notificationTransport === "smtp" && smtpHost && smtpUser && smtpPass
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      connectionTimeout: smtpConnectionTimeoutMs,
      greetingTimeout: smtpGreetingTimeoutMs,
      socketTimeout: smtpSocketTimeoutMs,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })
  : null;
let maintenanceInFlight = false;

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

const detectFileSignatureMimeType = async (filePath: string) => {
  const descriptor = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    await descriptor.read(header, 0, header.length, 0);
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
    await descriptor.close();
  }
};

const validateManagedFileContent = async (filePath: string, originalName: string, kind: "image" | "document") => {
  const detectedMimeType = await detectFileSignatureMimeType(filePath);
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
    await removeFileIfExists(filePath);
    throw new Error(`Uploaded ${kind} content does not match an allowed file signature.`);
  }
  if (isOfficeZipDocument) {
    await removeFileIfExists(filePath);
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

const fileExists = async (filePath: string) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

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
  void removeFileIfExists(filePath);
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
  await fs.promises.copyFile(filePath, quarantinePath);
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
  await fs.promises.writeFile(probePath, `scanner-health-check:${new Date().toISOString()}\n`, "utf8");
  let scannedPath = "";
  try {
    scannedPath = await runMalwareScan(probePath);
  } finally {
    await removeFileIfExists(probePath);
    if (scannedPath) await removeFileIfExists(scannedPath);
  }
};

const uploadFileToManagedStorage = async (sourcePath: string, kind: "image" | "document", originalName: string) => {
  const storagePath = buildStoragePath(kind, originalName);
  const bucket = kind === "image" ? imageBucket : documentBucket;
  const fileBuffer = await fs.promises.readFile(sourcePath);
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

const removeFileIfExists = async (filePath: string) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
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

const parsePaginationValue = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
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

const pruneFilesOlderThan = async (directory: string, maxAgeMs: number) => {
  const cutoff = Date.now() - maxAgeMs;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(directory, entry.name);
    const stats = await fs.promises.stat(fullPath);
    if (stats.mtimeMs <= cutoff) {
      await removeFileIfExists(fullPath);
    }
  }
};

const pruneOperationalFiles = async () => {
  await Promise.all([
    pruneFilesOlderThan(tempUploadsDir, tempUploadRetentionHours * 60 * 60 * 1000),
    pruneFilesOlderThan(outboxDir, outboxRetentionDays * 24 * 60 * 60 * 1000),
    pruneFilesOlderThan(deadLetterDir, deadLetterRetentionDays * 24 * 60 * 60 * 1000),
    pruneFilesOlderThan(quarantineDir, quarantineRetentionDays * 24 * 60 * 60 * 1000)
  ]);
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

const {
  getUserRoles,
  getSessionRow,
  getUserSessions,
  deleteSessionRow,
  createUserSession,
  getAuthContext: getAuthContextBase,
  serializeSession: serializeSessionBase,
} = createAuthService({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  parseCookies,
  sessionCookieName,
  sessionTtlMs,
  setSessionCookie,
  buildCsrfToken,
  normalizeRole,
  getUserById,
});

const getAuthContext = (req: express.Request) => getAuthContextBase(req, adminApiToken);
const serializeSession = (req: express.Request) => serializeSessionBase(req, adminApiToken);

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
  reserve: canViewReserveWithRole(auth.role) ? item.reserve : undefined,
  bids: item.bids.map((bid) => ({
    ...bid,
    bidder: canViewItemOperationsWithRole(auth.role) || auth.adminAuthorized ? bid.bidder : "Anonymous bidder",
    bidderUserId: canViewItemOperationsWithRole(auth.role) || auth.adminAuthorized ? bid.bidderUserId : undefined
  })),
  documents: item.documents.filter((document) => canAccessItemDocument(auth, item, document.visibility || "bidder_visible"))
});

const getEmailVerificationRow = async (token: string) =>
  handleSupabaseMaybe<EmailVerificationRow>(
    await supabase
      .from("email_verification_tokens")
      .select("id,user_id,token,created_at,expires_at")
      .eq("token", token)
      .maybeSingle(),
    true
  );

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

const appendAudit = async (req: express.Request, entry: AuditEntry) => {
  const auth = await getAuthContext(req);
  const details = redactSensitiveAuditDetails({
    ...entry.details,
    actorRole: auth.role,
    ...(auth.userId ? { actorUserId: auth.userId } : {}),
  });

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

const getReserveState = (item: StoredItem) => {
  if (item.reserve == null || item.reserve <= 0) return "no_reserve";
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

const {
  listUsersWithRoles,
  getAuditActorRoleLookup,
  redactSensitiveAuditDetails,
  sanitizeNotificationPayloadForAdmin,
  mapAuditRowToEntry,
  mapNotificationRow,
  mapNotificationRowForAdmin,
  getRecentAudits,
  getNotificationQueue,
} = createAdminService({
  supabase,
  handleSupabase,
  parseAuditDetails,
  normalizeDisplayRoleName,
  normalizeRole,
  securityTelemetryEvents,
});

const {
  queueNotification,
  processNotificationQueue,
} = createNotificationService({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  mapNotificationRow,
  sanitizeNotificationPayloadForAdmin,
  notificationRecipient,
  notificationTransport,
  notificationClaimTtlMs,
  notificationLeaseRenewMs,
  notificationMaxAttempts,
  outboxDir,
  deadLetterDir,
  appBaseUrl,
  imageBucket,
  smtpFrom,
  smtpTransporter,
  decodeStoredFilePath,
  guessContentType,
  safeFileName,
  buildSignInUrl,
  sendOpsAlert,
});

const {
  validateNewItem,
  validateCategoryName,
  parseCsv,
  normalizeImportKey,
  inspectImportArchive,
  extractImportArchive,
  getImportValue,
  splitImportList,
  normalizeDocumentVisibility,
  prepareUploadedMulterFile,
  copyImportedFile,
  createItemRecord,
  cleanupManagedFiles,
  rollbackCreatedItem,
  findExistingItemByLotOrSku,
} = createItemWriteService({
  supabase,
  handleSupabase,
  maxImportArchiveEntries,
  maxImportExtractedBytes,
  toIso,
  validateManagedFileContent,
  normalizeImageForUpload,
  runMalwareScan,
  uploadFileToManagedStorage,
  removeFileIfExists,
  removeManagedStoredFile,
  appendAudit,
  queueNotification,
});

const { getItems, getItemById } = createItemReadModel({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  parseAuditDetails,
});

const {
  resolveLegacyBidOwnerForNotification,
  getUserBidRecords,
  validateBid,
  placeBidAtomically,
  queueBidActivityNotifications,
} = createBidService({
  supabase,
  handleSupabase,
  parseAuditDetails,
  sessionTtlMs,
  appBaseUrl,
  getItems,
  getUserById,
  getUserByDisplayName,
  queueNotification,
});

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

const runMaintenanceTasks = async () => {
  if (maintenanceInFlight) return;
  maintenanceInFlight = true;
  try {
    await pruneExpiredDatabaseRows();
    await pruneOperationalFiles();
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

const requireItemOperationsViewerToken = asyncHandler(async (req, res, next) => {
  const auth = await getAuthContext(req);
  if (!(auth.adminAuthorized || canViewItemOperationsWithRole(auth.role))) {
    res.status(403).json({
      error: "Item operations access requires an authenticated ShopOwner or Admin account."
    });
    return;
  }
  next();
});

const requireSuperAdminToken = asyncHandler(async (req, res, next) => {
  const auth = await getAuthContext(req);
  if (!auth.signedIn || !isSuperAdminRole(auth.role)) {
    res.status(403).json({ error: "Super admin access is required." });
    return;
  }
  next();
});

app.get("/api/health", asyncHandler(async (req, res) => {
  res.json({ status: "ok" });
}));

registerAuthRoutes({
  app,
  supabase,
  asyncHandler,
  serializeSession,
  normalizeEmail,
  sanitizeDisplayName,
  checkAuthRateLimit,
  getClientKey,
  getUserByEmail,
  getUserById,
  getUserByIdWithPassword,
  getUserRoles,
  getUserSessions,
  getSessionRow,
  deleteSessionRow,
  createUserSession,
  getAuthContext,
  normalizeRole,
  normalizeDisplayRoleName,
  createEmailVerificationToken,
  getEmailVerificationRow,
  queueNotification,
  queuePasswordReset,
  appendAudit,
  notificationTransport,
  isStrongPassword,
  passwordRuleMessage,
  handleSupabase,
  hashPassword,
  verifyPassword,
  buildCsrfToken,
  parseSignedToken,
  passwordHashFingerprint,
  parseCookies,
  sessionCookieName,
  clearSessionCookie,
  getUserBidRecords,
  getItems,
  getReserveState,
  randomUUID,
});

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
    details: JSON.stringify(redactSensitiveAuditDetails(parseAuditDetails(row.details_json))),
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

registerCatalogRoutes({
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
});

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
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20) || 20));
  const offset = (page - 1) * pageSize;
  let request = supabase
    .from("audits")
    .select("id,event_type,entity_type,entity_id,actor,actor_type,request_id,details_json,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  if (itemId) request = request.eq("entity_id", itemId);
  if (from) request = request.gte("created_at", from);
  if (to) request = request.lte("created_at", to);
  if (eventType) request = request.eq("event_type", eventType);
  if (actor) request = request.ilike("actor", `%${actor}%`);
  if (entityType) request = request.eq("entity_type", entityType);
  const result = await request;
  const rows = handleSupabase(result) as AuditRow[];
  const filteredRows = includeSecurity ? rows : rows.filter((row) => !securityTelemetryEvents.has(row.event_type));
  const actorRoleLookup = await getAuditActorRoleLookup();
  res.json({
    items: filteredRows.map((row) => ({
      ...row,
      details_json: redactSensitiveAuditDetails(parseAuditDetails(row.details_json)),
      actor_role:
        (typeof row.details_json === "object" &&
        row.details_json !== null &&
        "actorRole" in row.details_json &&
        typeof row.details_json.actorRole === "string"
          ? row.details_json.actorRole
          : null) ??
        actorRoleLookup.get(row.actor) ??
        null,
    })),
    total: result.count ?? filteredRows.length,
    page,
    pageSize,
  });
}));

app.get("/api/admin/notifications", requireAdminToken, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20) || 20));
  const offset = (page - 1) * pageSize;
  const rowsResult = await supabase
    .from("notification_queue")
    .select("id,channel,event_type,recipient,subject,status,payload_json,created_at,processed_at,next_attempt_at,attempt_count,claim_token,claim_expires_at,error_message", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  const rows = handleSupabase(rowsResult) as NotificationRow[];
  res.json({
    items: rows.map(mapNotificationRowForAdmin),
    total: rowsResult.count ?? rows.length,
    page,
    pageSize,
  });
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
  }).filter((user) => isSuperAdminRole(auth.role) || !user.roles.includes("SuperAdmin"));
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
    const rows = parseCsv(await fs.promises.readFile(csvFile.path, "utf8"));
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
    await removeFileIfExists(csvFile.path);
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
  const tempExtractDir = await fs.promises.mkdtemp(path.join(importsDir, "bulk-"));
  const createdIds: string[] = [];
  const pendingRows: Array<{
    row: number;
    title: string;
    value: Extract<ReturnType<typeof validateNewItem>, { ok: true }>["value"];
    imageNames: string[];
    documentEntries: Array<{ name: string; visibility: DocumentVisibility }>;
  }> = [];
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
    const csvRows = parseCsv(await fs.promises.readFile(csvFile.path, "utf8"));
    if (!csvRows.length) {
      res.status(400).json({ error: "The uploaded CSV is empty." });
      return;
    }

    let extractedFiles = new Map<string, string>();
    if (zipFile) {
      await inspectImportArchive(zipFile.path);
      extractedFiles = await extractImportArchive(zipFile.path, tempExtractDir);
    }
    const seenLots = new Set<string>();
    const seenSkus = new Set<string>();

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
        if (seenLots.has(validation.value.lot) || seenSkus.has(validation.value.sku)) {
          report.failed += 1;
          report.items.push({
            row: index + 2,
            status: "failed",
            title: validation.value.title,
            message: "Duplicate lot or SKU detected within the uploaded CSV."
          });
          continue;
        }
        seenLots.add(validation.value.lot);
        seenSkus.add(validation.value.sku);

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
        for (const name of imageNames) {
          if (!extractedFiles.get(name.toLowerCase())) {
            throw new Error(`Image file "${name}" was not found in the ZIP.`);
          }
        }
        for (const entry of documentEntries) {
          if (!extractedFiles.get(entry.name.toLowerCase())) {
            throw new Error(`Document file "${entry.name}" was not found in the ZIP.`);
          }
        }
        pendingRows.push({
          row: index + 2,
          title: validation.value.title,
          value: validation.value,
          imageNames,
          documentEntries: documentEntries.map((entry) => ({ name: entry.name, visibility: entry.visibility }))
        });
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

    if (report.failed > 0) {
      res.status(400).json({
        ...report,
        message: "Bulk import validation failed. No items were created."
      });
      return;
    }

    try {
      for (const row of pendingRows) {
        const imageFiles = await Promise.all(row.imageNames.map(async (name) => {
          const sourcePath = extractedFiles.get(name.toLowerCase());
          if (!sourcePath) throw new Error(`Image file "${name}" was not found in the ZIP.`);
          return copyImportedFile(sourcePath, "image");
        }));
        const documentFiles = await Promise.all(row.documentEntries.map(async (entry) => {
          const sourcePath = extractedFiles.get(entry.name.toLowerCase());
          if (!sourcePath) throw new Error(`Document file "${entry.name}" was not found in the ZIP.`);
          return copyImportedFile(sourcePath, "document", entry.visibility);
        }));

        try {
          const itemId = await createItemRecord(req, row.value, auth, { images: imageFiles, documents: documentFiles });
          createdIds.push(itemId);
          report.created += 1;
          report.items.push({ row: row.row, status: "created", title: row.title, itemId, message: "Imported successfully." });
        } catch (error) {
          await cleanupManagedFiles([...imageFiles, ...documentFiles]);
          throw error;
        }
      }
    } catch (error) {
      for (const itemId of createdIds.reverse()) {
        await rollbackCreatedItem(itemId).catch(() => undefined);
      }
      res.status(500).json({
        ...report,
        error: error instanceof Error ? error.message : "Bulk import failed.",
        message: "Bulk import failed during commit. Created items were rolled back."
      });
      return;
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
    await removeFileIfExists(csvFile.path);
    if (zipFile) await removeFileIfExists(zipFile.path);
    await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
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

const { start } = createBootstrapService({
  app,
  port,
  runtimeEnvironment,
  notificationTransport,
  outboxDir,
  smtpTransporter,
  smtpVerifyTimeoutMs,
  notificationWorkerMode,
  shouldRunApiServer,
  verifyRequiredSchemaMigrations,
  detectSecurityEventsTable,
  verifyMalwareScannerHealth,
  ensureStorageBuckets,
  startMaintenanceLoop,
  backfillLegacyBidAuditAttribution,
  startNotificationWorkerLoop,
  handleSupabase,
  supabase,
  defaultCategories,
  seedItems,
  randomUUID,
});

const shouldAutoStart = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (shouldAutoStart) {
  void start().catch((error) => {
    console.error("Unable to start API server.");
    console.error(error);
    process.exit(1);
  });
}

export { app, start };
