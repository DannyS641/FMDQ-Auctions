import path from "path";
import fs from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { buildNotificationMeta } from "./security-logic.js";
import type { NotificationQueueItem } from "./server-types.js";

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

type HandleSupabase = <T>(result: { data: T; error: { message: string } | null }) => T;
type HandleSupabaseMaybe = <T>(result: { data: T | null; error: { message: string } | null }, allowNotFound?: boolean) => T | null;

type CreateNotificationServiceOptions = {
  supabase: SupabaseClient;
  handleSupabase: HandleSupabase;
  handleSupabaseMaybe: HandleSupabaseMaybe;
  mapNotificationRow: (row: NotificationRow) => NotificationQueueItem;
  sanitizeNotificationPayloadForAdmin: (payload: Record<string, unknown>) => Record<string, unknown>;
  notificationRecipient: string;
  notificationTransport: string;
  notificationClaimTtlMs: number;
  notificationLeaseRenewMs: number;
  notificationMaxAttempts: number;
  outboxDir: string;
  deadLetterDir: string;
  appBaseUrl: string;
  imageBucket: string;
  smtpFrom: string;
  smtpTransporter: nodemailer.Transporter | null;
  decodeStoredFilePath: (encodedPath: string) => string | null;
  guessContentType: (fileName: string, fallback?: string) => string;
  safeFileName: (value: string) => string;
  buildSignInUrl: () => string;
  sendOpsAlert: (title: string, details: Record<string, unknown>) => Promise<void>;
};

export class NotificationClaimLostError extends Error {
  constructor(entryId: string) {
    super(`Notification claim lost for ${entryId}.`);
  }
}

export const createNotificationService = ({
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
}: CreateNotificationServiceOptions) => {
  let notificationProcessingInFlight = false;

  const queueNotification = async (
    eventType: string,
    subject: string,
    payload: Record<string, unknown>,
    recipient = notificationRecipient
  ) => {
    if (eventType === "ACCOUNT_VERIFICATION") {
      await handleSupabase(
        await supabase
          .from("notification_queue")
          .delete()
          .eq("event_type", "ACCOUNT_VERIFICATION")
          .eq("recipient", recipient)
          .eq("status", "pending")
      );
    }
    if (eventType === "PASSWORD_RESET") {
      await handleSupabase(
        await supabase
          .from("notification_queue")
          .delete()
          .eq("event_type", "PASSWORD_RESET")
          .eq("recipient", recipient)
          .eq("status", "pending")
      );
    }
    const basePayload = {
      id: randomUUID(),
      channel: "email" as const,
      event_type: eventType,
      recipient,
      subject,
      status: "pending" as const,
      payload_json: payload,
      created_at: new Date().toISOString(),
      processed_at: null,
      next_attempt_at: new Date().toISOString(),
      attempt_count: 0,
      claim_token: null,
      claim_expires_at: null,
      error_message: null,
    };
    await handleSupabase(await supabase.from("notification_queue").insert(basePayload));
  };

  const getPendingNotificationQueue = async () => {
    const now = new Date().toISOString();
    const rows = handleSupabase(
      await supabase
        .from("notification_queue")
        .select("id,channel,event_type,recipient,subject,status,payload_json,created_at,processed_at,next_attempt_at,attempt_count,claim_token,claim_expires_at,error_message")
        .eq("status", "pending")
        .lte("next_attempt_at", now)
        .or(`claim_expires_at.is.null,claim_expires_at.lte.${now}`)
        .order("next_attempt_at", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(10)
    ) as NotificationRow[];
    return rows.map(mapNotificationRow);
  };

  const claimNotificationQueueEntry = async (entry: NotificationQueueItem) => {
    const claimTime = new Date().toISOString();
    const claimToken = `claim:${randomUUID()}`;
    const claimExpiresAt = new Date(Date.now() + notificationClaimTtlMs).toISOString();
    let request = supabase
      .from("notification_queue")
      .update({
        claim_token: claimToken,
        claim_expires_at: claimExpiresAt,
        processed_at: claimTime,
        error_message: null,
      })
      .eq("id", entry.id)
      .eq("status", "pending")
      .lte("next_attempt_at", claimTime);
    request = entry.claimToken ? request.eq("claim_token", entry.claimToken) : request.is("claim_token", null);
    const result = await request.select("id,claim_token").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return result.data?.claim_token === claimToken ? claimToken : null;
  };

  const updateNotificationOutcome = async (
    entryId: string,
    claimToken: string,
    status: "pending" | "sent" | "failed",
    errorMessage: string | null,
    processedAt = new Date().toISOString(),
    nextAttemptAt: string | null = processedAt,
    attemptCount?: number
  ) => {
    const row = await handleSupabaseMaybe<{ id: string }>(
      await supabase
        .from("notification_queue")
        .update({
          status,
          processed_at: processedAt,
          next_attempt_at: nextAttemptAt,
          attempt_count: attemptCount,
          claim_token: null,
          claim_expires_at: null,
          error_message: errorMessage,
        })
        .eq("id", entryId)
        .eq("claim_token", claimToken)
        .select("id")
        .maybeSingle(),
      true
    );
    if (!row) {
      await sendOpsAlert("Notification claim was lost before outcome update", {
        entryId,
        status,
        processedAt,
        nextAttemptAt,
        attemptCount: Number(attemptCount || 0),
      });
      throw new NotificationClaimLostError(entryId);
    }
  };

  const renewNotificationClaimLease = async (entryId: string, claimToken: string) => {
    const nextClaimExpiry = new Date(Date.now() + notificationClaimTtlMs).toISOString();
    const row = await handleSupabaseMaybe<{ id: string }>(
      await supabase
        .from("notification_queue")
        .update({ claim_expires_at: nextClaimExpiry })
        .eq("id", entryId)
        .eq("claim_token", claimToken)
        .select("id")
        .maybeSingle(),
      true
    );
    if (!row) {
      await sendOpsAlert("Notification claim lease could not be renewed", {
        entryId,
        claimToken,
        nextClaimExpiry,
      });
      throw new NotificationClaimLostError(entryId);
    }
  };

  const startNotificationClaimLeaseRenewal = (entryId: string, claimToken: string) => {
    let renewalError: Error | null = null;
    let latestRenewal = Promise.resolve();
    const timer = setInterval(() => {
      latestRenewal = renewNotificationClaimLease(entryId, claimToken).catch((error) => {
        renewalError = error instanceof Error ? error : new Error("Unable to renew notification claim lease.");
      });
    }, notificationLeaseRenewMs);

    return async () => {
      clearInterval(timer);
      await latestRenewal;
      if (renewalError) throw renewalError;
    };
  };

  const escapeHtml = (value: unknown) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const loadEmailInlineImage = async (imageUrl: string, title: string) => {
    const imageMatch = imageUrl.match(/^\/uploads\/images\/(.+)$/);
    if (!imageMatch) return null;
    const storagePath = decodeStoredFilePath(imageMatch[1]);
    if (!storagePath) return null;
    const downloadResult = await supabase.storage.from(imageBucket).download(storagePath);
    if (downloadResult.error || !downloadResult.data) return null;
    const content = Buffer.from(await downloadResult.data.arrayBuffer());
    return {
      cid: `auction-item-${randomUUID()}@fmdq-auctions`,
      filename: safeFileName(path.basename(storagePath) || `${title || "auction-item"}.jpg`),
      contentType: guessContentType(storagePath),
      content,
    };
  };

  const renderNotificationContent = async (entry: NotificationQueueItem) => {
    if (entry.eventType === "ACCOUNT_VERIFICATION") {
      const displayName = escapeHtml(entry.payload.displayName || "there");
      const verifyUrl = String(entry.payload.verifyUrl || "");
      return {
        text: `Hello ${displayName},\n\nUse the link below to verify your FMDQ Auctions account:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            <p>Hello ${displayName},</p>
            <p>Use the link below to verify your FMDQ Auctions account:</p>
            <p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
            <p>This link expires in 24 hours.</p>
          </div>
        `,
      };
    }

    if (entry.eventType === "ACCOUNT_VERIFIED") {
      const displayName = escapeHtml(entry.payload.displayName || "there");
      const signInUrl = buildSignInUrl();
      return {
        text: `Hello ${displayName},\n\nYour FMDQ Auctions account has been verified. You can now sign in here:\n${signInUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            <p>Hello ${displayName},</p>
            <p>Your FMDQ Auctions account has been verified.</p>
            <p>You can now sign in here: <a href="${escapeHtml(signInUrl)}">${escapeHtml(signInUrl)}</a></p>
          </div>
        `,
      };
    }

    if (entry.eventType === "PASSWORD_RESET") {
      const displayName = escapeHtml(entry.payload.displayName || "there");
      const resetUrl = String(entry.payload.resetUrl || "");
      return {
        text: `Hello ${displayName},\n\nUse the link below to reset your FMDQ Auctions password:\n${resetUrl}\n\nThis link expires in 1 hour.`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            <p>Hello ${displayName},</p>
            <p>Use the link below to reset your FMDQ Auctions password:</p>
            <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
            <p>This link expires in 1 hour.</p>
          </div>
        `,
      };
    }

    if (entry.eventType === "BID_PLACED") {
      const displayName = escapeHtml(entry.payload.displayName || "there");
      const title = escapeHtml(entry.payload.title || "this auction item");
      const currentBid = escapeHtml(entry.payload.currentBid || entry.payload.amount || "");
      const inlineImage = await loadEmailInlineImage(String(entry.payload.imageUrl || ""), title);
      const itemUrl = String(entry.payload.itemUrl || `${appBaseUrl}/bidding`);
      return {
        text: `Hello ${displayName},\n\nYour bid of ${currentBid} was placed successfully for ${title}.\n\nView the item here:\n${itemUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            ${inlineImage ? `<img src="cid:${escapeHtml(inlineImage.cid)}" alt="${title}" style="display:block;width:100%;max-width:520px;border-radius:18px;margin:0 0 18px;" />` : ""}
            <p>Hello ${displayName},</p>
            <p>Your bid of <strong>${currentBid}</strong> was placed successfully for <strong>${title}</strong>.</p>
            <p>View the item here: <a href="${escapeHtml(itemUrl)}">${escapeHtml(itemUrl)}</a></p>
          </div>
        `,
        attachments: inlineImage ? [inlineImage] : [],
      };
    }

    if (entry.eventType === "OUTBID_ALERT") {
      const displayName = escapeHtml(entry.payload.displayName || "there");
      const title = escapeHtml(entry.payload.title || "this auction item");
      const previousBid = escapeHtml(entry.payload.previousBid || "");
      const currentBid = escapeHtml(entry.payload.currentBid || "");
      const inlineImage = await loadEmailInlineImage(String(entry.payload.imageUrl || ""), title);
      const itemUrl = String(entry.payload.itemUrl || `${appBaseUrl}/bidding`);
      return {
        text: `Hello ${displayName},\n\nYou were outbid on ${title}.\nYour previous bid: ${previousBid}\nCurrent bid: ${currentBid}\n\nOpen the item to place a new bid:\n${itemUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
            ${inlineImage ? `<img src="cid:${escapeHtml(inlineImage.cid)}" alt="${title}" style="display:block;width:100%;max-width:520px;border-radius:18px;margin:0 0 18px;" />` : ""}
            <p>Hello ${displayName},</p>
            <p>You were outbid on <strong>${title}</strong>.</p>
            <p>Your previous bid: <strong>${previousBid}</strong><br />Current bid: <strong>${currentBid}</strong></p>
            <p>Open the item to place a new bid: <a href="${escapeHtml(itemUrl)}">${escapeHtml(itemUrl)}</a></p>
          </div>
        `,
        attachments: inlineImage ? [inlineImage] : [],
      };
    }

    const prettyPayload = JSON.stringify(entry.payload, null, 2);
    return {
      text: `${entry.subject}\n\n${prettyPayload}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          <p>${escapeHtml(entry.subject)}</p>
          <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px;">${escapeHtml(prettyPayload)}</pre>
        </div>
      `,
      attachments: [],
    };
  };

  const deliverNotification = async (entry: NotificationQueueItem, claimToken: string) => {
    const processedAt = new Date().toISOString();
    const stopLeaseRenewal = startNotificationClaimLeaseRenewal(entry.id, claimToken);
    try {
      if (notificationTransport === "noop") {
        await stopLeaseRenewal();
        await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
        return;
      }
      if (notificationTransport === "smtp") {
        if (!smtpTransporter) {
          throw new Error("SMTP transport is enabled but SMTP_HOST, SMTP_USER, or SMTP_PASS is missing.");
        }
        const content = await renderNotificationContent(entry);
        await smtpTransporter.sendMail({
          from: smtpFrom,
          to: entry.recipient,
          subject: entry.subject,
          text: content.text,
          html: content.html,
          attachments: content.attachments,
        });
        await stopLeaseRenewal();
        await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
        return;
      }
      const filePath = path.join(outboxDir, `${processedAt.replace(/[:.]/g, "-")}-${entry.id}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify({
        id: entry.id,
        channel: entry.channel,
        eventType: entry.eventType,
        recipient: entry.recipient,
        subject: entry.subject,
        payload: sanitizeNotificationPayloadForAdmin(entry.payload),
        createdAt: entry.createdAt,
        processedAt,
      }, null, 2), "utf8");
      await stopLeaseRenewal();
      await updateNotificationOutcome(entry.id, claimToken, "sent", null, processedAt, processedAt, Number(entry.attemptCount || 0));
    } catch (error) {
      await stopLeaseRenewal().catch(() => undefined);
      throw error;
    }
  };

  const processNotificationQueue = async () => {
    if (notificationProcessingInFlight) return 0;
    notificationProcessingInFlight = true;
    try {
      const entries = await getPendingNotificationQueue();
      let processed = 0;
      for (const entry of entries) {
        const claimToken = await claimNotificationQueueEntry(entry);
        if (!claimToken) continue;
        try {
          await deliverNotification(entry, claimToken);
          processed += 1;
        } catch (error) {
          if (error instanceof NotificationClaimLostError) {
            continue;
          }
          const errorMessage = error instanceof Error ? error.message : "Notification processing failed.";
          const now = new Date();
          const currentMeta = {
            attempts: Number(entry.attemptCount || 0),
            nextAttemptAt: entry.nextAttemptAt || undefined,
          };
          const retry = buildNotificationMeta(currentMeta, errorMessage, now, notificationMaxAttempts);
          if (retry.nextStatus === "failed") {
            const deadLetterPath = path.join(deadLetterDir, `${now.toISOString().replace(/[:.]/g, "-")}-${entry.id}.json`);
            await fs.promises.writeFile(deadLetterPath, JSON.stringify({
              id: entry.id,
              eventType: entry.eventType,
              recipient: entry.recipient,
              subject: entry.subject,
              payload: sanitizeNotificationPayloadForAdmin(entry.payload),
              errorMessage,
            }, null, 2), "utf8");
            await sendOpsAlert("Notification moved to dead letter", {
              entryId: entry.id,
              eventType: entry.eventType,
              recipient: entry.recipient,
              errorMessage,
              attempts: retry.meta.attempts,
            });
          }
          await updateNotificationOutcome(
            entry.id,
            claimToken,
            retry.nextStatus,
            errorMessage,
            now.toISOString(),
            retry.meta.nextAttemptAt || now.toISOString(),
            retry.meta.attempts
          );
        }
      }
      return processed;
    } finally {
      notificationProcessingInFlight = false;
    }
  };

  return {
    queueNotification,
    processNotificationQueue,
  };
};
