import path from "path";
import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import { encodeDocumentNameWithVisibility, type DocumentVisibility, validateArchiveEntries } from "./security-logic.js";
import type { AuthContext, AuditEntry } from "./server-types.js";

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;

export type NewItemValue = {
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  description: string;
  startBid: number;
  reserve: number;
  increment: number;
  startTime: string;
  endTime: string;
};

type ManagedFile = { id: string; kind: "image" | "document"; name: string; url: string };

type CreateItemWriteServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  maxImportArchiveEntries: number;
  maxImportExtractedBytes: number;
  toIso: (value: string) => string | null;
  validateManagedFileContent: (filePath: string, originalName: string, kind: "image" | "document") => Promise<void>;
  normalizeImageForUpload: (sourcePath: string, originalName: string) => Promise<{ path: string; originalName: string }>;
  runMalwareScan: (filePath: string) => Promise<string>;
  uploadFileToManagedStorage: (sourcePath: string, kind: "image" | "document", originalName: string) => Promise<{ storagePath: string; bucket: string; url: string }>;
  removeFileIfExists: (filePath: string) => Promise<void>;
  removeManagedStoredFile: (url: string) => Promise<void>;
  appendAudit: (req: express.Request, entry: AuditEntry) => Promise<void>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
};

export const createItemWriteService = ({
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
}: CreateItemWriteServiceOptions) => {
  const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const documentExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx"]);

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
      value: { title, category, lot, sku, condition, location, description, startBid, reserve, increment, startTime, endTime },
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

  const extractImportArchive = async (zipPath: string, targetDir: string) => {
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
      await import("fs").then((fs) => fs.promises.writeFile(outputPath, data));
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
  ): Promise<ManagedFile> => {
    const extension = path.extname(sourcePath).toLowerCase();
    if (kind === "image" && !imageExtensions.has(extension)) {
      throw new Error(`Unsupported image file type for ${path.basename(sourcePath)}.`);
    }
    if (kind === "document" && !documentExtensions.has(extension)) {
      throw new Error(`Unsupported document file type for ${path.basename(sourcePath)}.`);
    }
    await validateManagedFileContent(sourcePath, originalName, kind);
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
        url: stored.url,
      };
    } finally {
      await removeFileIfExists(scannedPath);
      if (normalizedPath) await removeFileIfExists(normalizedPath);
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
      await removeFileIfExists(file.path);
    }
  };

  const createItemRecord = async (
    req: express.Request,
    validation: NewItemValue,
    auth: AuthContext,
    extra?: { images?: ManagedFile[]; documents?: ManagedFile[]; currentBid?: number }
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
      created_at: createdAt,
    }));
    if (images.length) {
      await handleSupabase(await supabase.from("item_files").insert(
        images.map((image) => ({
          id: image.id,
          item_id: itemId,
          kind: image.kind,
          name: image.name,
          url: image.url,
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
          url: document.url,
        }))
      ));
    }
    await appendAudit(req, {
      eventType: "ITEM_CREATED",
      entityType: "item",
      entityId: itemId,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { title: validation.title, category: validation.category, lot: validation.lot, sku: validation.sku },
    });
    await queueNotification("ITEM_CREATED", `Auction item created: ${validation.title}`, { itemId, title: validation.title });
    return itemId;
  };

  const cleanupManagedFiles = async (files: Array<{ url: string }>) => {
    for (const file of files) {
      await removeManagedStoredFile(file.url).catch(() => undefined);
    }
  };

  const rollbackCreatedItem = async (itemId: string) => {
    const files = handleSupabase(
      await supabase.from("item_files").select("url").eq("item_id", itemId)
    ) as Array<{ url: string }>;
    await cleanupManagedFiles(files);
    await handleSupabase(await supabase.from("item_files").delete().eq("item_id", itemId));
    await handleSupabase(await supabase.from("audits").delete().eq("entity_type", "item").eq("entity_id", itemId));
    await supabase.from("notification_queue").delete().contains("payload_json", { itemId });
    await handleSupabase(await supabase.from("items").delete().eq("id", itemId));
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

  return {
    validateNewItem,
    validateCategoryName,
    parseCsv,
    normalizeImportKey,
    inspectImportArchive,
    extractImportArchive,
    getImportValue,
    splitImportList,
    normalizeDocumentVisibility,
    prepareManagedFile,
    copyImportedFile,
    prepareUploadedMulterFile,
    createItemRecord,
    cleanupManagedFiles,
    rollbackCreatedItem,
    findExistingItemByLotOrSku,
  };
};
