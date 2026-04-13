import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuthContext } from "./server-types.js";

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;

type CreateAuditServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  redactSensitiveAuditDetails: (value: Record<string, unknown>) => Record<string, unknown>;
  getAuthContext: (req: express.Request) => Promise<AuthContext>;
  randomUUID: () => string;
};

export const parseAuditDetails = (value: Record<string, unknown> | string | null | undefined) => {
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

export const createAuditService = ({
  supabase,
  handleSupabase,
  redactSensitiveAuditDetails,
  getAuthContext,
  randomUUID,
}: CreateAuditServiceOptions) => {
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
        created_at: new Date().toISOString(),
      })
    );
  };

  return { appendAudit };
};
