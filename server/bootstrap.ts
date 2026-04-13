import type express from "express";

type SeedBid = {
  bidder: string;
  amount: number;
  time: string;
  createdAt: string;
};

type SeedItem = {
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
  bids: SeedBid[];
  createdAt: string;
};

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;

type CreateBootstrapServiceOptions = {
  app: express.Express;
  port: number;
  runtimeEnvironment: string;
  notificationTransport: string;
  outboxDir: string;
  smtpTransporter: { verify: () => Promise<unknown> } | null;
  smtpVerifyTimeoutMs: number;
  notificationWorkerMode: string;
  shouldRunApiServer: boolean;
  verifyRequiredSchemaMigrations: () => Promise<void>;
  detectSecurityEventsTable: () => Promise<void>;
  verifyMalwareScannerHealth: () => Promise<void>;
  ensureStorageBuckets: () => Promise<void>;
  startMaintenanceLoop: () => Promise<void>;
  backfillLegacyBidAuditAttribution: () => Promise<void>;
  startNotificationWorkerLoop: () => Promise<void>;
  handleSupabase: HandleSupabase;
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        limit: (value: number) => Promise<unknown>;
      };
      upsert: (value: unknown, options?: unknown) => Promise<unknown>;
      insert: (value: unknown) => Promise<unknown>;
      delete: () => {
        lte: (column: string, value: string) => Promise<unknown>;
      };
    };
  };
  defaultCategories: string[];
  seedItems: SeedItem[];
  randomUUID: () => string;
};

export const createBootstrapService = ({
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
}: CreateBootstrapServiceOptions) => {
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
          created_at: item.createdAt,
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
              created_at: bid.createdAt,
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
        created_at: new Date().toISOString(),
      })
    );
  };

  const start = async () => {
    if (runtimeEnvironment === "production" && notificationTransport === "file") {
      throw new Error("NOTIFY_TRANSPORT=file is not allowed in production. Use smtp or noop.");
    }
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
      try {
        await Promise.race([
          smtpTransporter.verify(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`SMTP verification timed out after ${smtpVerifyTimeoutMs}ms.`)), smtpVerifyTimeoutMs);
          }),
        ]);
      } catch (error) {
        if (runtimeEnvironment === "production") {
          throw error;
        }
        console.warn("SMTP verification failed. Continuing startup because NODE_ENV is not production.");
        console.warn(error);
      }
    }
    await startNotificationWorkerLoop();
    if (!shouldRunApiServer) {
      console.log(`Notification worker running in ${notificationWorkerMode} mode.`);
      console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`Auction API running at http://localhost:${port}`);
        console.log("Storage backend: supabase-js");
        console.log(`Notification worker mode: ${notificationWorkerMode}`);
        console.log(`Notification transport: ${notificationTransport} (${outboxDir})`);
        resolve();
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is already in use. Stop the existing backend process or change PORT in .env before starting another server instance.`
            )
          );
          return;
        }
        reject(error);
      });
    });
  };

  return { start };
};
