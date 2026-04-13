import express from "express";
import fs from "fs";
import path from "path";

export const loadEnvFile = async (serverDir: string) => {
  const envPath = path.join(path.dirname(serverDir), ".env");
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

export const parseCookies = (req: express.Request) =>
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

export const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-");

export const replaceFileExtension = (name: string, extension: string) => {
  const baseName = path.basename(name, path.extname(name)) || "image";
  return `${safeFileName(baseName)}${extension}`;
};

export const guessContentType = (name: string, fallback = "application/octet-stream") => {
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

export const fileExists = async (filePath: string) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const removeFileIfExists = async (filePath: string) => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
};

export const toIso = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const csvEscape = (value: string | number | boolean) => `"${String(value).replace(/"/g, "\"\"")}"`;

export const toCsv = (rows: Array<Record<string, string | number | boolean>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(","))].join("\n");
};

export const createAsyncHandler = (
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  void fn(req, res, next).catch(next);
};

export const buildStoragePath = (
  kind: "image" | "document",
  originalName: string,
  randomId: () => string
) => `${kind}s/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomId()}-${safeFileName(originalName)}`;

export const buildStoredFileUrl = (kind: "image" | "document", storagePath: string) =>
  `/uploads/${kind === "image" ? "images" : "documents"}/${encodeURIComponent(Buffer.from(storagePath, "utf8").toString("base64url"))}`;

export const decodeStoredFilePath = (encodedPath: string) => {
  try {
    return Buffer.from(decodeURIComponent(encodedPath), "base64url").toString("utf8");
  } catch {
    return null;
  }
};
