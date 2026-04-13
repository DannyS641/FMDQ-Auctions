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
  ensureCanManageTargetRoles,
  validateMalwareScanConfiguration
} from "./security-logic.js";
import { createItemReadModel, type StoredItem } from "./item-read-model.js";
import { createAuthService } from "./auth-service.js";
import { createAdminService } from "./admin-service.js";
import { createNotificationService } from "./notification-service.js";
import { createItemWriteService } from "./item-write-service.js";
import { createBidService } from "./bid-service.js";
import { createBootstrapService } from "./bootstrap.js";
import { createAuditService, parseAuditDetails } from "./audit-service.js";
import { canAccessItemDocument, getLandingStats, getReserveState, sanitizeItemForAuth } from "./item-policy.js";
import {
  buildStoredFileUrl,
  buildStoragePath,
  createAsyncHandler,
  decodeStoredFilePath,
  fileExists,
  guessContentType,
  loadEnvFile,
  parseCookies,
  removeFileIfExists,
  replaceFileExtension,
  safeFileName,
  toCsv,
  toIso,
} from "./platform-utils.js";
import { registerAuthRoutes } from "./register-auth-routes.js";
import { registerCatalogRoutes } from "./register-catalog-routes.js";
import { registerAdminRoutes } from "./register-admin-routes.js";
import { registerItemMutationRoutes } from "./register-item-mutation-routes.js";
import type { AuthContext, UserRow } from "./server-types.js";
import {
  canViewItemOperationsWithRole,
  isSuperAdminRole,
  normalizeDisplayRoleName,
  normalizeRole,
} from "../shared/permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnvFile(__dirname);

const app = express();
const runtimeEnvironment = process.env.NODE_ENV || "development";
const allowDemoSeeding =
  runtimeEnvironment !== "production" && String(process.env.ENABLE_DEMO_SEEDING || "").toLowerCase() === "true";
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
type EmailVerificationRow = { id: string; user_id: string; token: string; created_at: string; expires_at: string };

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
  const storagePath = buildStoragePath(kind, originalName, randomUUID);
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

const {
  listUsersWithRoles,
  getAuditActorRoleLookup,
  redactSensitiveAuditDetails,
  sanitizeNotificationPayloadForAdmin,
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

const { appendAudit } = createAuditService({
  supabase,
  handleSupabase,
  redactSensitiveAuditDetails,
  getAuthContext,
  randomUUID,
});

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
      triggeredBy: triggeredBy || "self-service",
    },
    user.email
  );
  return reset;
};

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

const { getItems, getItemSummaries, getItemById } = createItemReadModel({
  supabase,
  handleSupabase,
  handleSupabaseMaybe,
  parseAuditDetails,
});

const getLandingStatsSummary = () => getLandingStats({
  getItems,
  listUsersWithRoles,
});

const {
  getUserBidRecords,
  validateBid,
  placeBidAtomically,
  queueBidActivityNotifications,
  backfillLegacyBidAuditAttribution,
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

const asyncHandler = createAsyncHandler;

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
  getItemSummaries,
  getItemById,
  sanitizeItemForAuth,
  getCategories,
  getLandingStats: getLandingStatsSummary,
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

registerAdminRoutes({
  app,
  supabase,
  asyncHandler,
  requireAdminToken,
  requireSuperAdminToken,
  bulkImportUpload,
  handleSupabase,
  getAuthContext,
  appendAudit,
  parseAuditDetails,
  redactSensitiveAuditDetails,
  mapNotificationRowForAdmin,
  getRecentAudits,
  getNotificationQueue,
  processNotificationQueue,
  listUsersWithRoles,
  getAuditActorRoleLookup,
  getRoles,
  getUserById,
  getUserByIdWithPassword,
  getUserByEmail,
  getUserRoles,
  ensureCanManageTargetUser,
  queuePasswordReset,
  createEmailVerificationToken,
  queueNotification,
  parseCsv,
  getImportValue,
  splitImportList,
  normalizeEmail,
  sanitizeDisplayName,
  hashPassword,
  randomUUID,
  toCsv,
});

registerItemMutationRoutes({
  app,
  asyncHandler,
  requireAdminToken,
  upload,
  bulkImportUpload,
  importsDir,
  randomUUID,
  getAuthContext,
  appendAudit,
  queueNotification,
  getItemById,
  handleSupabase,
  supabase,
  validateNewItem,
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
});

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
  allowDemoSeeding,
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
