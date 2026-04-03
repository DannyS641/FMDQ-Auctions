import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationMeta,
  buildCsrfTokenValue,
  canAccessDocumentVisibility,
  encodeDocumentNameWithVisibility,
  ensureCanManageTargetRoles,
  parseDocumentNameWithVisibility,
  shouldProcessNotificationNow,
  validateArchiveEntries,
  validateBidAmount,
  validateMalwareScanConfiguration
} from "../server/security-logic.js";

test("buildCsrfTokenValue is deterministic for the same secret and session", () => {
  const first = buildCsrfTokenValue("secret", "session-1");
  const second = buildCsrfTokenValue("secret", "session-1");
  const third = buildCsrfTokenValue("secret", "session-2");
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test("malware scanning is mandatory in production", () => {
  assert.deepEqual(validateMalwareScanConfiguration("development", "off", ""), { ok: true });
  assert.equal(validateMalwareScanConfiguration("production", "off", "").ok, false);
  assert.deepEqual(validateMalwareScanConfiguration("production", "command", "/usr/bin/clamscan"), { ok: true });
});

test("document visibility encoding round-trips cleanly", () => {
  const stored = encodeDocumentNameWithVisibility("report.pdf", "winner_only");
  assert.deepEqual(parseDocumentNameWithVisibility(stored), {
    displayName: "report.pdf",
    visibility: "winner_only"
  });
  assert.deepEqual(parseDocumentNameWithVisibility("plain.pdf"), {
    displayName: "plain.pdf",
    visibility: "bidder_visible"
  });
});

test("document visibility policies enforce admin, bidder, and winner access correctly", () => {
  assert.equal(canAccessDocumentVisibility({
    signedIn: true,
    adminAuthorized: true,
    role: "Admin",
    itemArchived: false,
    itemEnded: true,
    reserveState: "reserve_met",
    isWinner: false
  }, "admin_only"), true);
  assert.equal(canAccessDocumentVisibility({
    signedIn: true,
    adminAuthorized: false,
    role: "Bidder",
    itemArchived: false,
    itemEnded: false,
    reserveState: "reserve_pending",
    isWinner: false
  }, "bidder_visible"), true);
  assert.equal(canAccessDocumentVisibility({
    signedIn: true,
    adminAuthorized: false,
    role: "Bidder",
    itemArchived: false,
    itemEnded: true,
    reserveState: "reserve_met",
    isWinner: true
  }, "winner_only"), true);
  assert.equal(canAccessDocumentVisibility({
    signedIn: true,
    adminAuthorized: false,
    role: "Bidder",
    itemArchived: false,
    itemEnded: true,
    reserveState: "reserve_not_met",
    isWinner: true
  }, "winner_only"), false);
});

test("super admin targets cannot be managed by plain admins", () => {
  assert.equal(ensureCanManageTargetRoles("Admin", ["SuperAdmin"]).ok, false);
  assert.deepEqual(ensureCanManageTargetRoles("SuperAdmin", ["SuperAdmin"]), { ok: true });
});

test("bid validation enforces timing, minimum, and increment rules", () => {
  const item = {
    startBid: 1000,
    currentBid: 1500,
    increment: 250,
    startTime: "2026-04-02T08:00:00.000Z",
    endTime: "2026-04-02T10:00:00.000Z"
  };
  assert.equal(validateBidAmount(item, 1750, Date.parse("2026-04-02T09:00:00.000Z")).ok, true);
  assert.equal(validateBidAmount(item, 1600, Date.parse("2026-04-02T09:00:00.000Z")).ok, false);
  assert.equal(validateBidAmount(item, 1750, Date.parse("2026-04-02T11:00:00.000Z")).ok, false);
});

test("archive validation rejects unsafe or oversized bundles", () => {
  assert.throws(() => validateArchiveEntries(["../escape.txt"], 10), /unsafe path/i);
  assert.throws(() => validateArchiveEntries(Array.from({ length: 12 }, (_, index) => `file-${index}.txt`), 10), /too many files/i);
  assert.doesNotThrow(() => validateArchiveEntries(["docs/file.pdf", "images/photo.jpg"], 10));
});

test("notification retry metadata backs off and eventually exhausts", () => {
  const first = buildNotificationMeta({}, "SMTP timed out", new Date("2026-04-02T10:00:00.000Z"), 3);
  assert.equal(first.nextStatus, "pending");
  assert.equal(first.meta.attempts, 1);
  assert.equal(shouldProcessNotificationNow(first.meta, new Date("2026-04-02T10:00:30.000Z")), false);
  assert.equal(shouldProcessNotificationNow(first.meta, new Date("2026-04-02T10:01:00.000Z")), true);

  const final = buildNotificationMeta({ attempts: 2 }, "Still failing", new Date("2026-04-02T10:00:00.000Z"), 3);
  assert.equal(final.exhausted, true);
  assert.equal(final.nextStatus, "failed");
});
