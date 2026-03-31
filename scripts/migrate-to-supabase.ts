import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const readEnvFile = () => {
  const envPath = path.join(repoRoot, ".env");
  const parsed: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return parsed;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 0) continue;
    const key = line.slice(0, equalsAt).trim();
    const value = line.slice(equalsAt + 1).trim().replace(/^['"]|['"]$/g, "");
    parsed[key] = value;
  }
  return parsed;
};

const envFile = readEnvFile();
const getEnv = (key: string) => process.env[key] || envFile[key] || "";
const supabaseDbUrl = getEnv("SUPABASE_DB_URL");

if (!supabaseDbUrl) {
  throw new Error("SUPABASE_DB_URL is required in .env or the current shell.");
}

const sqlitePath = path.join(repoRoot, "server", "data", "auctions.sqlite");
if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite source database not found at ${sqlitePath}`);
}

const sqlite = new DatabaseSync(sqlitePath);
const pg = new Client({ connectionString: supabaseDbUrl, ssl: { rejectUnauthorized: false } });

type TableConfig = {
  name: string;
  selectSql: string;
  columns: string[];
  truncateFirst?: boolean;
};

const tableConfigs: TableConfig[] = [
  {
    name: "roles",
    selectSql: "SELECT name, created_at as createdAt FROM roles",
    columns: ["name", "createdAt"],
    truncateFirst: true
  },
  {
    name: "categories",
    selectSql: "SELECT name, created_at as createdAt FROM categories",
    columns: ["name", "createdAt"],
    truncateFirst: true
  },
  {
    name: "users",
    selectSql: `
      SELECT
        id,
        email,
        password_hash as passwordHash,
        display_name as displayName,
        status,
        created_at as createdAt,
        last_login_at as lastLoginAt
      FROM users
    `,
    columns: ["id", "email", "passwordHash", "displayName", "status", "createdAt", "lastLoginAt"],
    truncateFirst: true
  },
  {
    name: "user_roles",
    selectSql: `
      SELECT
        user_id as userId,
        role_name as roleName,
        created_at as createdAt
      FROM user_roles
    `,
    columns: ["userId", "roleName", "createdAt"],
    truncateFirst: true
  },
  {
    name: "sessions",
    selectSql: `
      SELECT
        id,
        user_id as userId,
        created_at as createdAt,
        expires_at as expiresAt
      FROM sessions
    `,
    columns: ["id", "userId", "createdAt", "expiresAt"],
    truncateFirst: true
  },
  {
    name: "email_verification_tokens",
    selectSql: `
      SELECT
        id,
        user_id as userId,
        token,
        created_at as createdAt,
        expires_at as expiresAt
      FROM email_verification_tokens
    `,
    columns: ["id", "userId", "token", "createdAt", "expiresAt"],
    truncateFirst: true
  },
  {
    name: "items",
    selectSql: `
      SELECT
        id,
        title,
        category,
        lot,
        sku,
        condition,
        location,
        start_bid as startBid,
        reserve,
        increment_amount as incrementAmount,
        current_bid as currentBid,
        start_time as startTime,
        end_time as endTime,
        description,
        created_at as createdAt,
        archived_at as archivedAt
      FROM items
    `,
    columns: [
      "id",
      "title",
      "category",
      "lot",
      "sku",
      "condition",
      "location",
      "startBid",
      "reserve",
      "incrementAmount",
      "currentBid",
      "startTime",
      "endTime",
      "description",
      "createdAt",
      "archivedAt"
    ],
    truncateFirst: true
  },
  {
    name: "item_files",
    selectSql: `
      SELECT
        id,
        item_id as itemId,
        kind,
        name,
        url
      FROM item_files
    `,
    columns: ["id", "itemId", "kind", "name", "url"],
    truncateFirst: true
  },
  {
    name: "bids",
    selectSql: `
      SELECT
        id,
        item_id as itemId,
        bidder_alias as bidderAlias,
        amount,
        bid_time as bidTime,
        created_at as createdAt
      FROM bids
    `,
    columns: ["id", "itemId", "bidderAlias", "amount", "bidTime", "createdAt"],
    truncateFirst: true
  },
  {
    name: "audits",
    selectSql: `
      SELECT
        id,
        event_type as eventType,
        entity_type as entityType,
        entity_id as entityId,
        actor,
        actor_type as actorType,
        request_id as requestId,
        details_json as detailsJson,
        created_at as createdAt
      FROM audits
    `,
    columns: ["id", "eventType", "entityType", "entityId", "actor", "actorType", "requestId", "detailsJson", "createdAt"],
    truncateFirst: true
  },
  {
    name: "notification_queue",
    selectSql: `
      SELECT
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
      FROM notification_queue
    `,
    columns: ["id", "channel", "eventType", "recipient", "subject", "status", "payloadJson", "createdAt", "processedAt", "errorMessage"],
    truncateFirst: true
  }
];

const destinationColumns: Record<string, string[]> = {
  roles: ["name", "created_at"],
  categories: ["name", "created_at"],
  users: ["id", "email", "password_hash", "display_name", "status", "created_at", "last_login_at"],
  user_roles: ["user_id", "role_name", "created_at"],
  sessions: ["id", "user_id", "created_at", "expires_at"],
  email_verification_tokens: ["id", "user_id", "token", "created_at", "expires_at"],
  items: [
    "id",
    "title",
    "category",
    "lot",
    "sku",
    "condition",
    "location",
    "start_bid",
    "reserve",
    "increment_amount",
    "current_bid",
    "start_time",
    "end_time",
    "description",
    "created_at",
    "archived_at"
  ],
  item_files: ["id", "item_id", "kind", "name", "url"],
  bids: ["id", "item_id", "bidder_alias", "amount", "bid_time", "created_at"],
  audits: ["id", "event_type", "entity_type", "entity_id", "actor", "actor_type", "request_id", "details_json", "created_at"],
  notification_queue: [
    "id",
    "channel",
    "event_type",
    "recipient",
    "subject",
    "status",
    "payload_json",
    "created_at",
    "processed_at",
    "error_message"
  ]
};

const truncateOrder = [
  "notification_queue",
  "audits",
  "bids",
  "item_files",
  "email_verification_tokens",
  "sessions",
  "user_roles",
  "items",
  "users",
  "categories",
  "roles"
];

const loadRows = (config: TableConfig) =>
  sqlite.prepare(config.selectSql).all() as Array<Record<string, unknown>>;

const insertRows = async (tableName: string, rows: Array<Record<string, unknown>>, sourceColumns: string[]) => {
  if (!rows.length) {
    console.log(`- ${tableName}: 0 rows`);
    return;
  }

  const targetColumns = destinationColumns[tableName];
  const placeholders = targetColumns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `
    insert into public.${tableName} (${targetColumns.join(", ")})
    values (${placeholders})
  `;

  for (const row of rows) {
    const values = sourceColumns.map((key) => row[key] ?? null);
    await pg.query(sql, values);
  }

  console.log(`- ${tableName}: ${rows.length} rows`);
};

const main = async () => {
  await pg.connect();
  console.log("Connected to Supabase Postgres.");

  try {
    await pg.query("begin");

    for (const tableName of truncateOrder) {
      await pg.query(`truncate table public.${tableName} restart identity cascade`);
    }

    for (const config of tableConfigs) {
      const rows = loadRows(config);
      await insertRows(config.name, rows, config.columns);
    }

    await pg.query("commit");
    console.log("SQLite data migrated to Supabase successfully.");
  } catch (error) {
    await pg.query("rollback");
    throw error;
  } finally {
    await pg.end();
    sqlite.close();
  }
};

void main().catch((error) => {
  console.error("Supabase migration failed.");
  console.error(error);
  process.exitCode = 1;
});
