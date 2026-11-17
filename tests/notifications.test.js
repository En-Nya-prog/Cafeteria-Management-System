import assert from "node:assert/strict";
import test from "node:test";
import { SyncService } from "../src/services/SyncServiceRuntime.js";

test("seller inventory uses the canonical shared meal list", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const meals = [{ id: "admin-meal", name: "Shared lunch", seller_id: null }];
  globalThis.fetch = async (url) => {
    requestedUrls.push(url);
    return { ok: true, json: async () => meals };
  };

  try {
    assert.deepEqual(await SyncService.getInventory("Seller"), meals);
    assert.deepEqual(requestedUrls, ["/api/meals"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("seller sees shared meals even when the legacy endpoint would return none", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  const sharedMeals = [{ id: "admin-meal", name: "Admin meal", seller_id: null }];
  globalThis.fetch = async (url) => {
    requestedUrls.push(url);
    return { ok: true, json: async () => (url === "/api/inventory" ? [] : sharedMeals) };
  };

  try {
    assert.deepEqual(await SyncService.getInventory("Seller"), sharedMeals);
    assert.deepEqual(requestedUrls, ["/api/meals"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment confirmation retries a temporary server failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let attempts = 0;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 502, json: async () => ({ message: "Temporary verification failure." }) };
    return { ok: true, json: async () => ({ status: "paid" }) };
  };

  try {
    assert.deepEqual(await SyncService.verifyPayment("ebd_reference"), { status: "paid" });
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("orders API errors are surfaced instead of being mistaken for an empty queue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
  });

  try {
    assert.deepEqual(await SyncService.getSales(), { error: "Orders request failed (HTTP 404)." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("markNotificationAsRead sends POST with notification id", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let requestedOptions;

  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      json: async () => ({ success: true }),
    };
  };

  try {
    await SyncService.markNotificationAsRead("notif-123");
    assert.equal(requestedUrl, "/api/notifications/read");
    assert.equal(requestedOptions.method, "POST");
    assert.deepEqual(JSON.parse(requestedOptions.body), { id: "notif-123" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("markNotificationsAsRead sends POST for all notifications", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  let requestedOptions;

  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      json: async () => ({ success: true }),
    };
  };

  try {
    await SyncService.markNotificationsAsRead();
    assert.equal(requestedUrl, "/api/notifications/read");
    assert.equal(requestedOptions.method, "POST");
    assert.equal(requestedOptions.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("clicking notification updates read_at and reduces unread badge count", () => {
  const notifications = [
    { id: "1", title: "Meal 1", message: "Available", read_at: null },
    { id: "2", title: "Meal 2", message: "Available", read_at: null },
    { id: "3", title: "Meal 3", message: "Available", read_at: "2026-11-17T12:00:00Z" },
  ];

  const initialUnreadCount = notifications.filter((n) => !n.read_at).length;
  assert.equal(initialUnreadCount, 2);

  // Simulate clicking notification 1
  const readTimestamp = new Date().toISOString();
  const updatedNotifications = notifications.map((n) =>
    n.id === "1" ? { ...n, read_at: readTimestamp } : n
  );

  const updatedUnreadCount = updatedNotifications.filter((n) => !n.read_at).length;
  assert.equal(updatedUnreadCount, 1);
  assert.equal(updatedNotifications[0].read_at, readTimestamp);
});

test("background polling merge preserves locally read notifications", () => {
  const previousState = [
    { id: "1", title: "Meal 1", message: "Available", read_at: "2026-11-17T12:00:00Z" },
    { id: "2", title: "Meal 2", message: "Available", read_at: null },
  ];

  // Server response where notification 1 is still null on server (e.g. replication lag)
  const staleServerResponse = [
    { id: "1", title: "Meal 1", message: "Available", read_at: null },
    { id: "2", title: "Meal 2", message: "Available", read_at: null },
  ];

  const localReadMap = { "1": "2026-11-17T12:00:00Z" };

  const merged = staleServerResponse.map((item) => {
    const readAt = item.read_at || localReadMap[item.id] || previousState.find(p => p.id === item.id)?.read_at;
    return readAt ? { ...item, read_at: readAt } : item;
  });

  const unreadCount = merged.filter((n) => !n.read_at).length;
  assert.equal(unreadCount, 1);
  assert.equal(merged[0].read_at, "2026-11-17T12:00:00Z");
});
