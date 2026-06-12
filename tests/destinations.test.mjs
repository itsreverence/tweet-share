import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");

function loadDestinationContext(initialStore = {}) {
  const files = ["00-config.js", "10-destinations.js", "10-preferences.js"];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const store = new Map(Object.entries(initialStore));
  const context = {
    Date,
    store,
    GM: {
      getValue: async (key, defaultValue) => store.has(key) ? store.get(key) : defaultValue,
      setValue: async (key, value) => {
        store.set(key, value);
      }
    }
  };

  runInNewContext(`${code}\nthis.exports = {\n  createDestinationId,\n  getDestinationById,\n  getDestinations,\n  isValidWebhookUrl,\n  loadAllDestinations,\n  loadPreferences,\n  sanitizeDestination,\n  sanitizeDestinations,\n  sanitizePreferences,\n  saveAllDestinations,\n  savePreferences,\n  store\n};`, context);
  return context.exports;
}

const validWebhook = "https://discord.com/api/webhooks/1234567890/abc_DEF-123";
const plain = (value) => JSON.parse(JSON.stringify(value));

test("sanitizeDestination accepts valid Discord webhook destinations", () => {
  const { sanitizeDestination } = loadDestinationContext();

  assert.deepEqual(plain(sanitizeDestination({
    id: " main ",
    label: " Main channel ",
    webhookUrl: ` ${validWebhook} `
  })), {
    id: "main",
    label: "Main channel",
    webhookUrl: validWebhook
  });
});

test("sanitizeDestinations drops incomplete or non-Discord webhook entries", () => {
  const { sanitizeDestinations } = loadDestinationContext();

  assert.deepEqual(plain(sanitizeDestinations([
    { id: "ok", label: "Okay", webhookUrl: validWebhook },
    { id: "missing-url", label: "No URL", webhookUrl: "" },
    { id: "slack", label: "Wrong service", webhookUrl: "https://hooks.slack.com/services/a/b/c" },
    { id: "domain", label: "Wrong domain", webhookUrl: "https://discord.evil.test/api/webhooks/123/token" },
    null
  ])), [{ id: "ok", label: "Okay", webhookUrl: validWebhook }]);
});

test("createDestinationId slugifies labels and avoids collisions", () => {
  const { createDestinationId } = loadDestinationContext();
  const existingIds = new Set(["friends-server", "friends-server-2"]);

  assert.equal(createDestinationId("Friends Server!", existingIds), "friends-server-3");
  assert.equal(createDestinationId("Real Sports", existingIds), "real-sports");
});

test("destination storage only exposes labels to menu callers", async () => {
  const { getDestinationById, getDestinations, saveAllDestinations, store } = loadDestinationContext();

  await saveAllDestinations([
    { id: "main", label: "Main", webhookUrl: validWebhook },
    { id: "bad", label: "Bad", webhookUrl: "not-a-webhook" }
  ]);

  assert.deepEqual(plain(await getDestinations()), [{ id: "main", label: "Main" }]);
  assert.deepEqual(plain(await getDestinationById("main")), { id: "main", label: "Main", webhookUrl: validWebhook });
  assert.deepEqual(plain(store.get("tds-destinations")), [{ id: "main", label: "Main", webhookUrl: validWebhook }]);
});

test("preferences default to safe enabled behavior and persist sanitized booleans", async () => {
  const { loadPreferences, savePreferences, store } = loadDestinationContext();

  assert.deepEqual(plain(await loadPreferences()), { alwaysShowPreview: true, attachMedia: true });

  await savePreferences({ alwaysShowPreview: false, attachMedia: false, extra: "ignored" });
  assert.deepEqual(plain(store.get("tds-preferences")), { alwaysShowPreview: false, attachMedia: false });
  assert.deepEqual(plain(await loadPreferences()), { alwaysShowPreview: false, attachMedia: false });
});
