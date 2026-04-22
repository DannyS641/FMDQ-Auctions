import express from "express";
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuthContext } from "./server-types.js";
import type { StoredItem } from "./item-read-model.js";
import type { NewItemValue } from "./item-write-service.js";

type AsyncRouteHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

type DocumentVisibility = "admin_only" | "bidder_visible" | "winner_only";

type RegisterItemMutationRoutesOptions = {
  app: express.Express;
  asyncHandler: (fn: AsyncRouteHandler) => express.RequestHandler;
  requireAdminToken: express.RequestHandler;
  upload: {
    fields: (fields: Array<{ name: string; maxCount?: number }>) => express.RequestHandler;
  };
  bulkImportUpload: {
    fields: (fields: Array<{ name: string; maxCount?: number }>) => express.RequestHandler;
  };
  importsDir: string;
  randomUUID: () => string;
  getAuthContext: (req: express.Request) => Promise<AuthContext>;
  appendAudit: (req: express.Request, entry: AuditEntry) => Promise<void>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
  getItemById: (id: string, includeArchived?: boolean) => Promise<StoredItem | null>;
  handleSupabase: <T>(result: { data: T; error: { message: string } | null }) => T;
  supabase: SupabaseClient;
  validateNewItem: (body: Record<string, string>) => { ok: false; error: string } | { ok: true; value: NewItemValue };
  parseCsv: (content: string) => Array<Record<string, string>>;
  normalizeImportKey: (value: string) => string;
  inspectImportArchive: (zipPath: string) => Promise<void>;
  extractImportArchive: (zipPath: string, targetDir: string) => Promise<Map<string, string>>;
  getImportValue: (row: Record<string, string>, candidates: string[]) => string;
  splitImportList: (value: string) => string[];
  normalizeDocumentVisibility: (value: string | undefined) => DocumentVisibility;
  prepareUploadedMulterFile: (file: Express.Multer.File, kind: "image" | "document", visibility?: DocumentVisibility) => Promise<{ id: string; kind: "image" | "document"; name: string; url: string }>;
  copyImportedFile: (sourcePath: string, kind: "image" | "document", visibility?: DocumentVisibility) => Promise<{ id: string; kind: "image" | "document"; name: string; url: string }>;
  createItemRecord: (
    req: express.Request,
    validation: NewItemValue,
    auth: AuthContext,
    extra?: { images?: Array<{ id: string; kind: "image" | "document"; name: string; url: string }>; documents?: Array<{ id: string; kind: "image" | "document"; name: string; url: string }>; currentBid?: number }
  ) => Promise<string>;
  cleanupManagedFiles: (files: Array<{ url: string }>) => Promise<void>;
  rollbackCreatedItem: (itemId: string) => Promise<void>;
  findExistingItemByLotOrSku: (lot: string, sku: string) => Promise<{ id: string; title: string; lot: string; sku: string } | null>;
};

export const registerItemMutationRoutes = ({
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
}: RegisterItemMutationRoutesOptions) => {
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
      items: [],
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
            description: getImportValue(row, ["description", "item_description"]),
          };
          const validation = validateNewItem(payload);
          if (validation.ok === false) {
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
              message: "Duplicate lot or SKU detected within the uploaded CSV.",
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
            .filter(([key, value]) =>
              (key.startsWith("document") || key.startsWith("doc")) &&
              !key.endsWith("_visibility") &&
              value.trim()
            )
            .flatMap(([key, value]) => splitImportList(value).map((name) => ({
              key,
              name,
              visibility: normalizeDocumentVisibility(
                normalizedRow[`${key}_visibility`] || normalizedRow.document_visibility || normalizedRow.doc_visibility
              ),
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
            documentEntries: documentEntries.map((entry) => ({ name: entry.name, visibility: entry.visibility })),
          });
        } catch (error) {
          report.failed += 1;
          report.items.push({
            row: index + 2,
            status: "failed",
            title: title || `Row ${index + 2}`,
            message: error instanceof Error ? error.message : "Import failed.",
          });
        }
      }

      if (report.failed > 0) {
        res.status(400).json({
          ...report,
          message: "Bulk import validation failed. No items were created.",
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
          message: "Bulk import failed during commit. Created items were rolled back.",
        });
        return;
      }

      await appendAudit(req, {
        eventType: "ITEM_BULK_IMPORTED",
        entityType: "system",
        entityId: "bulk-import",
        actor: auth.actor,
        actorType: auth.actorType,
        details: { created: report.created, skipped: report.skipped, failed: report.failed },
      });
      res.json(report);
    } finally {
      await fs.promises.rm(csvFile.path, { force: true });
      if (zipFile) await fs.promises.rm(zipFile.path, { force: true });
      await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
    }
  }));

  app.post("/api/items", requireAdminToken, upload.fields([{ name: "images", maxCount: 8 }, { name: "documents", maxCount: 8 }]), asyncHandler(async (req, res) => {
    const validation = validateNewItem(req.body as Record<string, string>);
    if (validation.ok === false) {
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
      documents: preparedDocuments,
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
    if (validation.ok === false) {
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
        description: validation.value.description,
      }).eq("id", existing.id)
    );
    if (images.length) {
      await handleSupabase(await supabase.from("item_files").insert(
        preparedImages.map((image) => ({
          id: randomUUID(),
          item_id: existing.id,
          kind: "image",
          name: image.name,
          url: image.url,
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
          url: document.url,
        }))
      ));
    }
    await appendAudit(req, {
      eventType: "ITEM_UPDATED",
      entityType: "item",
      entityId: existing.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { title: validation.value.title, category: validation.value.category },
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
      details: { title: existing.title },
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
      details: { title: existing.title },
    });
    await queueNotification("ITEM_RESTORED", `Auction item restored: ${existing.title}`, { itemId: existing.id, title: existing.title });
    res.json(await getItemById(existing.id, true));
  }));
};
