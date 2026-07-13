import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");
const validWebhook = "https://discord.com/api/webhooks/1234567890/abc_DEF-123";

function loadDeliverContext() {
  const files = [
    "00-config.js",
    "02-utils.js",
    "04-video.js",
    "05-format-discord.js",
    "10-destinations.js",
    "10-preferences.js",
    "08-deliver.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const storage = new Map();
  const calls = { requests: [], toasts: [], delays: 0 };

  const context = createContext({
    console,
    URL,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] },
    GM: {
      getValue(key, defaultValue) {
        return Promise.resolve(storage.has(key) ? storage.get(key) : defaultValue);
      },
      setValue(key, value) {
        storage.set(key, value);
        return Promise.resolve();
      }
    },
    delay: async () => {
      calls.delays += 1;
    },
    showToast(message, state) {
      calls.toasts.push({ message, state });
    },
    xhrClient() {
      throw new Error("xhrClient should not run in deliver tests");
    }
  });

  runInNewContext(
    `${code}
request = async (method, url, body) => {
  __calls.requests.push({ method, url, body, kind: "json" });
  return {};
};
const __calls = { requests: [], toasts: [], delays: 0 };
this.exports = {
  shareToDestination,
  sanitizeWebhookPayload,
  buildWebhookTestPayload,
  sendWebhookTest,
  saveAllDestinations,
  __calls
};`,
    context
  );

  Object.assign(calls, context.exports.__calls);
  return { ...context.exports, storage, calls };
}

const sampleTweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice" },
  text: "Hello",
  media: [{ type: "image", url: "https://pbs.twimg.com/media/photo.jpg" }]
};

test("sanitizeWebhookPayload removes internal message labels", () => {
  const { sanitizeWebhookPayload } = loadDeliverContext();
  const cleaned = sanitizeWebhookPayload({ content: "hi", _messageLabel: "Videos" });
  assert.equal(cleaned.content, "hi");
  assert.equal(Object.hasOwn(cleaned, "_messageLabel"), false);
});

test("buildWebhookTestPayload uses Tweet Discord Share branding", () => {
  const { buildWebhookTestPayload } = loadDeliverContext();
  const payload = buildWebhookTestPayload();

  assert.equal(payload.username, "Tweet Share");
  assert.match(payload.avatar_url, /webhook-avatar\.png$/);
  assert.match(payload.content, /connected/i);
  assert.equal(Object.hasOwn(payload, "embeds"), false);
});

test("sendWebhookTest rejects invalid webhook URLs", async () => {
  const { sendWebhookTest, calls } = loadDeliverContext();

  await assert.rejects(() => sendWebhookTest("https://example.com/not-a-webhook"), /valid Discord webhook/i);
  assert.equal(calls.requests.length, 0);
});

test("sendWebhookTest posts a connection check to the webhook", async () => {
  const { sendWebhookTest, calls } = loadDeliverContext();

  await sendWebhookTest(` ${validWebhook} `);

  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].method, "POST");
  assert.equal(calls.requests[0].url, validWebhook);
  assert.equal(calls.requests[0].body.username, "Tweet Share");
  assert.match(calls.requests[0].body.content, /connected/i);
});

test("shareToDestination throws when destination is missing a webhook URL", async () => {
  const { shareToDestination, saveAllDestinations } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await assert.rejects(
    () => shareToDestination("missing", sampleTweet),
    /missing a webhook URL/i
  );
});

test("shareToDestination posts JSON payloads for link shares", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", sampleTweet, { includeQuote: false });

  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].method, "POST");
  assert.equal(calls.requests[0].url, validWebhook);
  assert.match(calls.requests[0].body.content, /alice\/status\/1/);
  assert.ok(Array.isArray(calls.requests[0].body.embeds));
  assert.equal(calls.requests[0].body.embeds[0].image.url, "https://pbs.twimg.com/media/photo.jpg");
});

test("shareToDestination delays between multi-message shares", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  const tweet = {
    ...sampleTweet,
    media: [
      { type: "video", url: "https://video.twimg.com/ext_tw_video/9/pu/vid/1280x720/a.mp4" },
      { type: "image", url: "https://pbs.twimg.com/media/one.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/two.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/three.jpg" }
    ]
  };

  await shareToDestination("main", tweet, { includeQuote: false });

  assert.ok(calls.requests.length >= 2);
  assert.equal(calls.delays, calls.requests.length - 1);
});
