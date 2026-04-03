import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const migrationsDir = path.join(repoRoot, "docs", "migrations");
const serverFile = path.join(repoRoot, "server", "index.ts");
const requireRemoteMigrationCheck =
  process.env.REQUIRE_REMOTE_MIGRATION_CHECK === "1" || process.env.CI === "true";

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

const readRequiredMigrationVersions = () => {
  const source = fs.readFileSync(serverFile, "utf8");
  const match = source.match(/const requiredSchemaMigrations = \[(.*?)\];/s);
  if (!match) {
    throw new Error("Unable to locate requiredSchemaMigrations in server/index.ts.");
  }
  const versions = Array.from(match[1].matchAll(/"([^"]+)"/g), (entry) => entry[1]);
  if (!versions.length) {
    throw new Error("No required schema migrations are listed in server/index.ts.");
  }
  return versions;
};

const verifyLocalMigrationFiles = (requiredVersions: string[]) => {
  const availableFiles = new Set(
    fs.readdirSync(migrationsDir)
      .filter((entry) => entry.endsWith(".sql"))
      .map((entry) => entry.replace(/\.sql$/, ""))
  );
  const missing = requiredVersions.filter((version) => !availableFiles.has(version));
  if (missing.length) {
    throw new Error(`Missing local migration files for: ${missing.join(", ")}`);
  }
};

const verifyRemoteMigrationState = async (requiredVersions: string[]) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    if (requireRemoteMigrationCheck) {
      throw new Error(
        "Remote migration verification is required, but SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY were not provided."
      );
    }
    console.log("Supabase credentials not present; local migration file check passed.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const result = await supabase.from("schema_migrations").select("version").in("version", requiredVersions);
  if (result.error) {
    if (result.error.message.toLowerCase().includes("schema_migrations")) {
      throw new Error(
        "Supabase cannot see public.schema_migrations yet. Run docs/migrations/0001_bid_queue_hardening.sql in the SQL Editor, then run `notify pgrst, 'reload schema';` and retry."
      );
    }
    throw new Error(`Unable to verify schema_migrations in Supabase: ${result.error.message}`);
  }
  const applied = new Set((result.data || []).map((row: { version: string }) => row.version));
  const missing = requiredVersions.filter((version) => !applied.has(version));
  if (missing.length) {
    throw new Error(`Supabase is missing required migrations: ${missing.join(", ")}`);
  }
  console.log(`Supabase migration check passed for: ${requiredVersions.join(", ")}`);
};

loadEnvFile();
const requiredVersions = readRequiredMigrationVersions();
verifyLocalMigrationFiles(requiredVersions);
await verifyRemoteMigrationState(requiredVersions);
