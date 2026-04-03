import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.APP_SECRET ||= "test-app-secret";
process.env.NOTIFICATION_WORKER_MODE = "api";

const { app } = await import("../server/index.js");

const requestJson = async (server: http.Server, method: string, pathname: string) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, { method });
  const body = await response.json();
  return { status: response.status, body };
};

const requestJsonWithInit = async (server: http.Server, pathname: string, init: RequestInit) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, init);
  const body = await response.json();
  return { status: response.status, body };
};

const startTestServer = async () =>
  new Promise<http.Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

const stopTestServer = async (server: http.Server) =>
  new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });

test("GET /api/auth/me returns an anonymous session when no cookie is present", async () => {
  const server = await startTestServer();
  try {
    const response = await requestJson(server, "GET", "/api/auth/me");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { signedIn: false, user: null });
  } finally {
    await stopTestServer(server);
  }
});

test("POST /api/auth/logout clears anonymous requests safely", async () => {
  const server = await startTestServer();
  try {
    const response = await requestJson(server, "POST", "/api/auth/logout");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
  } finally {
    await stopTestServer(server);
  }
});

test("POST requests from untrusted origins are rejected", async () => {
  const server = await startTestServer();
  try {
    const response = await requestJsonWithInit(server, "/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://evil.example"
      }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "Request origin is not allowed." });
  } finally {
    await stopTestServer(server);
  }
});

test("anonymous users cannot access admin item restore or place bids", async () => {
  const server = await startTestServer();
  try {
    const restoreResponse = await requestJson(server, "POST", "/api/items/item-1/restore");
    assert.equal(restoreResponse.status, 403);
    assert.deepEqual(restoreResponse.body, {
      error: "Admin access requires an authenticated account with the Admin role."
    });

    const bidResponse = await requestJsonWithInit(server, "/api/items/item-1/bids", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount: 1000, expectedCurrentBid: 0 })
    });
    assert.equal(bidResponse.status, 401);
    assert.deepEqual(bidResponse.body, { error: "Sign in to place a bid." });
  } finally {
    await stopTestServer(server);
  }
});
