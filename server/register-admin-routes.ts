import express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuditRow, AuthContext, UserRow } from "./server-types.js";
import { isSuperAdminRole } from "../shared/permissions.js";

type AsyncRouteHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<void>;

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

type RegisterAdminRoutesOptions = {
  app: express.Express;
  supabase: SupabaseClient;
  asyncHandler: (fn: AsyncRouteHandler) => express.RequestHandler;
  requireAdminToken: express.RequestHandler;
  requireSuperAdminToken: express.RequestHandler;
  bulkImportUpload: {
    single: (fieldName: string) => express.RequestHandler;
  };
  handleSupabase: <T>(result: { data: T; error: { message: string } | null }) => T;
  getAuthContext: (req: express.Request) => Promise<AuthContext>;
  appendAudit: (req: express.Request, entry: AuditEntry) => Promise<void>;
  parseAuditDetails: (value: Record<string, unknown> | string | null | undefined) => Record<string, unknown>;
  redactSensitiveAuditDetails: (value: Record<string, unknown>) => Record<string, unknown>;
  mapNotificationRowForAdmin: (row: NotificationRow) => unknown;
  getRecentAudits: (limit?: number) => Promise<unknown[]>;
  getNotificationQueue: (limit?: number, offset?: number) => Promise<unknown[]>;
  processNotificationQueue: () => Promise<number>;
  listUsersWithRoles: () => Promise<Array<{
    id: string;
    email: string;
    displayName: string;
    status: UserRow["status"];
    createdAt: string;
    lastLoginAt: string | null;
    roles: string[];
  }>>;
  getAuditActorRoleLookup: () => Promise<Map<string, string | null>>;
  getItems: (includeArchived?: boolean) => Promise<Array<{
    id: string;
    title: string;
    category: string;
    lot: string;
    currentBid: number;
    startTime: string;
    endTime: string;
    archivedAt?: string | null;
    bids: Array<{ bidder: string; amount: number; time: string; createdAt: string }>;
  }>>;
  getReserveState: (item: { reserve?: number; endTime: string; currentBid: number }) => string;
  getRoles: () => Promise<string[]>;
  getUserById: (id: string) => Promise<UserRow | null>;
  getUserByIdWithPassword: (id: string) => Promise<(UserRow & { password_hash?: string }) | null>;
  getUserByEmail: (email: string) => Promise<(UserRow & { password_hash?: string }) | null>;
  getUserRoles: (userId: string) => Promise<Array<{ role_name: string }>>;
  ensureCanManageTargetUser: (actor: AuthContext, targetRoles: string[]) => { ok: boolean; error?: string };
  queuePasswordReset: (user: UserRow & { password_hash?: string }, triggeredBy?: string) => Promise<unknown>;
  createEmailVerificationToken: (userId: string) => Promise<{ verifyUrl: string }>;
  queueNotification: (eventType: string, subject: string, payload: Record<string, unknown>, recipient?: string) => Promise<void>;
  parseCsv: (content: string) => Array<Record<string, string>>;
  getImportValue: (row: Record<string, string>, candidates: string[]) => string;
  splitImportList: (value: string) => string[];
  normalizeEmail: (value: string) => string;
  sanitizeDisplayName: (value: string) => string;
  hashPassword: (value: string) => string;
  randomUUID: () => string;
  toCsv: (rows: Array<Record<string, string | number | boolean>>) => string;
};

export const registerAdminRoutes = ({
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
  getItems,
  getReserveState,
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
}: RegisterAdminRoutesOptions) => {
  const securityTelemetryEvents = new Set(["AUTH_ATTEMPT", "BID_ATTEMPT"]);

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
      createdAt: row.created_at,
    }));
    const auth = await getAuthContext(req);
    await appendAudit(req, {
      eventType: "EXPORT_AUDITS",
      entityType: "export",
      entityId: "audits.csv",
      actor: auth.actor,
      actorType: auth.actorType,
      details: { rowCount: formatted.length },
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="audits.csv"');
    res.send(toCsv(formatted));
  }));

  app.get("/api/admin/operations", requireAdminToken, asyncHandler(async (_req, res) => {
    const nowIso = new Date().toISOString();
    const [
      totalItemsResult,
      liveItemsResult,
      closedItemsResult,
      archivedItemsResult,
      pendingNotificationsResult,
      auditsResult,
      winsResult,
      totalUsersResult,
      activeUsersResult,
      disabledUsersResult,
      adminUsersResult,
      superAdminUsersResult,
    ] = await Promise.all([
      supabase.from("items").select("id", { count: "exact", head: true }),
      supabase.from("items").select("id", { count: "exact", head: true }).is("archived_at", null).lte("start_time", nowIso).gte("end_time", nowIso),
      supabase.from("items").select("id", { count: "exact", head: true }).is("archived_at", null).lt("end_time", nowIso),
      supabase.from("items").select("id", { count: "exact", head: true }).not("archived_at", "is", null),
      supabase.from("notification_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("audits").select("id", { count: "exact", head: true }),
      supabase.from("audits").select("id", { count: "exact", head: true }).eq("event_type", "BID_PLACED"),
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("status", "disabled"),
      supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role_name", "Admin"),
      supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role_name", "SuperAdmin"),
    ]);
    const summary = {
      totalItems: totalItemsResult.count ?? 0,
      liveCount: liveItemsResult.count ?? 0,
      closedCount: closedItemsResult.count ?? 0,
      archivedCount: archivedItemsResult.count ?? 0,
      pendingNotifications: pendingNotificationsResult.count ?? 0,
      auditCount: auditsResult.count ?? 0,
      wins: winsResult.count ?? 0,
      totalUsers: totalUsersResult.count ?? 0,
      activeUsers: activeUsersResult.count ?? 0,
      disabledUsers: disabledUsersResult.count ?? 0,
      adminUsers: adminUsersResult.count ?? 0,
      superAdminUsers: superAdminUsersResult.count ?? 0,
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
        wins: summary.wins,
      },
      recentAudits: await getRecentAudits(20),
      notificationQueue: await getNotificationQueue(20),
    });
  }));

  app.get("/api/admin/reports", requireAdminToken, asyncHandler(async (_req, res) => {
    const now = Date.now();
    const items = await getItems(true);

    const getItemStatus = (item: { startTime: string; endTime: string; archivedAt?: string | null }) => {
      if (item.archivedAt) return "Archived";
      if (new Date(item.startTime).getTime() > now) return "Upcoming";
      if (new Date(item.endTime).getTime() < now) return "Closed";
      return "Live";
    };

    const closedItems = items.filter((item) => getItemStatus(item) === "Closed");
    const wonItems = closedItems
      .map((item) => {
        const winningBid = [...item.bids]
          .sort((a, b) => new Date(b.time ?? b.createdAt ?? 0).getTime() - new Date(a.time ?? a.createdAt ?? 0).getTime())
          .find((bid) => bid.amount === item.currentBid);
        if (!winningBid || item.currentBid <= 0) return null;
        const reserveOutcome = getReserveState(item);
        if (reserveOutcome === "reserve_not_met") return null;
        return {
          itemId: item.id,
          title: item.title,
          lot: item.lot,
          category: item.category,
          winner: winningBid.bidder,
          winningBid: item.currentBid,
          endTime: item.endTime,
          reserveOutcome,
        };
      })
      .filter(Boolean) as Array<{
        itemId: string;
        title: string;
        lot: string;
        category: string;
        winner: string;
        winningBid: number;
        endTime: string;
        reserveOutcome: string;
      }>;

    const winners = Array.from(
      wonItems.reduce<Map<string, { bidder: string; itemsWon: number; totalWonAmount: number; itemTitles: string[] }>>((acc, item) => {
        const current = acc.get(item.winner) ?? {
          bidder: item.winner,
          itemsWon: 0,
          totalWonAmount: 0,
          itemTitles: [],
        };
        current.itemsWon += 1;
        current.totalWonAmount += item.winningBid;
        current.itemTitles.push(item.title);
        acc.set(item.winner, current);
        return acc;
      }, new Map()).values()
    ).sort((a, b) => b.totalWonAmount - a.totalWonAmount);

    const noBidItems = items
      .filter((item) => item.bids.length === 0 && item.currentBid <= 0)
      .map((item) => ({
        itemId: item.id,
        title: item.title,
        lot: item.lot,
        category: item.category,
        status: getItemStatus(item),
        endTime: item.endTime,
        archived: Boolean(item.archivedAt),
      }));

    const reserveNotMetItems = closedItems
      .filter((item) => item.currentBid > 0 && getReserveState(item) === "reserve_not_met")
      .map((item) => ({
        itemId: item.id,
        title: item.title,
        lot: item.lot,
        category: item.category,
        currentBid: item.currentBid,
        endTime: item.endTime,
      }));

    res.json({
      summary: {
        winners: winners.length,
        wonItems: wonItems.length,
        noBidItems: noBidItems.length,
        reserveNotMetItems: reserveNotMetItems.length,
      },
      winners,
      wonItems,
      noBidItems,
      reserveNotMetItems,
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
      .order("created_at", { ascending: false });
    if (itemId) request = request.eq("entity_id", itemId);
    if (from) request = request.gte("created_at", from);
    if (to) request = request.lte("created_at", to);
    if (eventType) request = request.eq("event_type", eventType);
    if (actor) request = request.ilike("actor", `%${actor}%`);
    if (entityType) request = request.eq("entity_type", entityType);
    if (!includeSecurity) {
      request = request.not("event_type", "in", `(${Array.from(securityTelemetryEvents).map((value) => `"${value}"`).join(",")})`);
    }
    request = request.range(offset, offset + pageSize - 1);
    const result = await request;
    const rows = handleSupabase(result) as AuditRow[];
    const actorRoleLookup = await getAuditActorRoleLookup();
    res.json({
      items: rows.map((row) => ({
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
      total: result.count ?? rows.length,
      page,
      pageSize,
    });
  }));

  app.get("/api/admin/notifications", requireSuperAdminToken, asyncHandler(async (req, res) => {
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

  app.post("/api/admin/notifications/process", requireSuperAdminToken, asyncHandler(async (_req, res) => {
    const processed = await processNotificationQueue();
    res.json({ processed });
  }));

  app.get("/api/admin/users", requireAdminToken, asyncHandler(async (_req, res) => {
    res.json(await listUsersWithRoles());
  }));

  app.get("/api/admin/roles", requireAdminToken, asyncHandler(async (_req, res) => {
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
      details: { email: user.email, role: roleName },
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
      details: { email: user.email, role: roleName },
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
    await handleSupabase(await supabase.from("users").update({ status: "disabled" }).eq("id", user.id));
    await handleSupabase(await supabase.from("sessions").delete().eq("user_id", user.id));
    await appendAudit(req, {
      eventType: "USER_DISABLED",
      entityType: "user",
      entityId: user.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { email: user.email, target: user.display_name, reason },
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
    await handleSupabase(await supabase.from("users").update({ status: "active" }).eq("id", user.id));
    await appendAudit(req, {
      eventType: "USER_ENABLED",
      entityType: "user",
      entityId: user.id,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { email: user.email, target: user.display_name },
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
      details: { email: user.email, target: user.display_name },
    });
    res.json({ queued: true, count: 1, message: `Password reset sent to ${user.email}.` });
  }));

  app.post("/api/admin/users/password-resets", requireAdminToken, express.json({ limit: "128kb" }), asyncHandler(async (req, res) => {
    const scope = String(req.body?.scope || "selected");
    const role = String(req.body?.role || "").trim();
    const selectedIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((value: unknown) => String(value).trim()).filter(Boolean) : [];
    const auth = await getAuthContext(req);
    const users = (await listUsersWithRoles()).filter((user) => user.status === "active");
    const targets = users
      .filter((user) => {
        if (scope === "all") return true;
        if (scope === "role") return role ? user.roles.includes(role) : false;
        return selectedIds.includes(user.id);
      })
      .filter((user) => isSuperAdminRole(auth.role) || !user.roles.includes("SuperAdmin"));
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
        password_hash: (await getUserByIdWithPassword(target.id))?.password_hash,
      }, auth.actor);
    }
    await appendAudit(req, {
      eventType: "PASSWORD_RESET_BULK_FORCED",
      entityType: "system",
      entityId: scope === "role" ? role || "bulk" : scope,
      actor: auth.actor,
      actorType: auth.actorType,
      details: { scope, count: targets.length, role: role || "n/a" },
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
      const rows = parseCsv(await import("fs").then((fs) => fs.promises.readFile(csvFile.path, "utf8")));
      if (!rows.length) {
        res.status(400).json({ error: "The uploaded CSV is empty." });
        return;
      }
      const availableRoles = await getRoles();
      for (const [index, row] of rows.entries()) {
        const email = normalizeEmail(getImportValue(row, ["email"]));
        const displayName = sanitizeDisplayName(getImportValue(row, ["display_name", "displayName", "full_name", "name"]));
        const roles = splitImportList(getImportValue(row, ["roles", "role"])).filter((candidateRole) => availableRoles.includes(candidateRole));
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
          last_login_at: null,
        }));
        await handleSupabase(await supabase.from("user_roles").insert(
          assignedRoles.map((roleName) => ({
            user_id: userId,
            role_name: roleName,
            created_at: createdAt,
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
        details: { created: report.created, skipped: report.skipped, failed: report.failed },
      });
      res.json(report);
    } finally {
      await import("fs").then((fs) => fs.promises.rm(csvFile.path, { force: true }));
    }
  }));
};
