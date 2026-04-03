import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const migrationsDir = path.join(repoRoot, "docs", "migrations");

const loadEnvFile = () => {
  const envPath = path.join(repoRoot, ".env");
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

const databaseUrl = process.env.SUPABASE_DB_URL || "";
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required to apply SQL migrations with npm run db:migrate.");
}

const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
  .sort((left, right) => left.localeCompare(right));

if (!migrationFiles.length) {
  throw new Error("No SQL migration files were found in docs/migrations.");
}

for (const fileName of migrationFiles) {
  const filePath = path.join(migrationsDir, fileName);
  process.stdout.write(`Applying ${fileName}...\n`);
  await execFileAsync("psql", [databaseUrl, "--set=ON_ERROR_STOP=1", "--file", filePath], {
    maxBuffer: 20 * 1024 * 1024
  });
}

process.stdout.write(`Applied ${migrationFiles.length} migration file(s).\n`);
