import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");
const validWebhook = "https://discord.com/api/webhooks/1234567890/abc_DEF-123";

function loadDeliverContext({ multipartError = null, requestErrorAt = null } = {}) {
  const files = [
    "00-config.js",
    "02-utils.js",
    "04-video.js",
    "05-format-discord.js",
    "13-media-fetch.js",
    "10-destinations.js",
    "10-preferences.js",
    "08-deliver.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const storage = new Map();
  const calls = { requests: [], multipart: [], toasts: [], delays: 0 };

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
    __multipartError: multipartError,
    __requestErrorAt: requestErrorAt,
    xhrClient() {
      throw new Error("xhrClient should not run in deliver tests");
    }
  });

  runInNewContext(
    `${code}
request = async (method, url, body) => {
  __calls.requests.push({ method, url, body, kind: "json" });
  if (__requestErrorAt === __calls.requests.length) throw new Error("follow-up failed");
  return {};
};
requestMultipart = async (url, payload, files) => {
  if (__multipartError) throw __multipartError;
  __calls.multipart.push({
    url,
    payload,
    files: files.map((file) => ({ filename: file.filename, contentType: file.contentType }))
  });
  return {};
};
const __calls = { requests: [], multipart: [], toasts: [], delays: 0 };
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

const mainVideoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4";
const skippedVideoUrl = "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/skipped.mp4";
const videoTweet = {
  url: "https://x.com/alice/status/2",
  author: { displayName: "Alice", username: "alice" },
  text: "Clips",
  media: [
    { type: "video", url: mainVideoUrl },
    { type: "video", url: skippedVideoUrl }
  ]
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
  assert.match(payload.avatar_url, /webhook-avatar-v2\.png$/);
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

test("shareToDestination posts JSON image layout when upload eligibility fails", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", sampleTweet, {
    includeQuote: false,
    fetchMediaBytes() {
      throw new Error("unavailable");
    }
  });

  assert.equal(calls.requests.length, 1);
  assert.equal(calls.multipart.length, 0);
  assert.equal(calls.requests[0].method, "POST");
  assert.equal(calls.requests[0].url, validWebhook);
  assert.match(calls.requests[0].body.content, /alice\/status\/1/);
  assert.ok(Array.isArray(calls.requests[0].body.embeds));
  assert.equal(calls.requests[0].body.embeds[0].image.url, "https://pbs.twimg.com/media/photo.jpg");
  assert.ok(calls.toasts.some((toast) => /failed to download/i.test(toast.message)));
});

test("successful resolution sends one compact multipart request", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", { ...videoTweet, media: [videoTweet.media[0]] }, {
    includeQuote: false,
    fetchMediaBytes() {
      return { byteLength: 128 };
    }
  });

  assert.equal(calls.multipart.length, 1);
  assert.equal(calls.requests.length, 0);
  assert.equal(calls.multipart[0].files.length, 1);
  assert.equal(calls.multipart[0].files[0].contentType, "video/mp4");
  assert.equal(calls.multipart[0].payload.embeds[0].image, undefined);
  assert.doesNotMatch(JSON.stringify(calls.multipart[0].payload), /Video 1|Plays below|main\.mp4/);
});

test("lower fitting video variant uploads without exposing a CDN fallback link", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);
  const highUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/1288x2230/high.mp4";
  const lowerUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/720x1246/lower.mp4";

  await shareToDestination("main", {
    ...videoTweet,
    media: [{
      type: "video",
      url: highUrl,
      variants: [
        { type: "video/mp4", url: highUrl, bitrate: 10_368_000 },
        { type: "video/mp4", url: lowerUrl, bitrate: 2_176_000 }
      ]
    }]
  }, {
    includeQuote: false,
    fetchMediaSize(url) {
      return url === highUrl ? 25 * 1024 * 1024 : 4 * 1024 * 1024;
    },
    fetchMediaBytes(url) {
      assert.equal(url, lowerUrl);
      return { byteLength: 4 * 1024 * 1024 };
    }
  });

  assert.equal(calls.multipart.length, 1);
  assert.equal(calls.multipart[0].files.length, 1);
  assert.equal(calls.requests.length, 0);
  assert.doesNotMatch(JSON.stringify(calls.multipart[0].payload), /video\.twimg\.com|high\.mp4|lower\.mp4/);
});

test("all skipped video media sends one playable fallback URL", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", { ...videoTweet, media: [videoTweet.media[0]] }, {
    includeQuote: false,
    fetchMediaBytes() {
      throw new Error("unavailable");
    }
  });

  assert.equal(calls.multipart.length, 0);
  assert.equal(calls.requests.length, 2);
  assert.equal(calls.requests[1].body.content, `_Video:_\n${mainVideoUrl}`);
  assert.equal(calls.requests[1].body.content.split(mainVideoUrl).length - 1, 1);
  assert.doesNotMatch(JSON.stringify(calls.requests), /Plays below|poster/);
  assert.ok(calls.toasts.some((toast) => /fallback content/i.test(toast.message)));
});

test("partial video success uploads resolved media and retains skipped link once", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", videoTweet, {
    includeQuote: false,
    fetchMediaBytes(url) {
      if (url === skippedVideoUrl) throw new Error("unavailable");
      return { byteLength: 128 };
    }
  });

  assert.equal(calls.multipart.length, 1);
  assert.equal(calls.multipart[0].files.length, 1);
  assert.equal(calls.requests.length, 1);
  assert.ok(calls.requests[0].body.content.includes(skippedVideoUrl));
  assert.equal(calls.requests[0].body.content.split(skippedVideoUrl).length - 1, 1);
  assert.doesNotMatch(JSON.stringify(calls.multipart[0].payload), /main\.mp4|skipped\.mp4|Plays below/);
});

test("multipart network failure is surfaced without an automatic JSON retry", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext({
    multipartError: new Error("ambiguous network failure")
  });
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await assert.rejects(() => shareToDestination("main", { ...videoTweet, media: [videoTweet.media[0]] }, {
    includeQuote: false,
    fetchMediaBytes() {
      return { byteLength: 128 };
    }
  }), /ambiguous network failure/);
  assert.equal(calls.requests.length, 0);
  assert.equal(calls.multipart.length, 0);
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

  await shareToDestination("main", tweet, {
    includeQuote: false,
    fetchMediaBytes() {
      throw new Error("unavailable");
    }
  });

  assert.ok(calls.requests.length >= 2);
  assert.equal(calls.delays, calls.requests.length - 1);
});

test("shareToDestination reports how many messages were sent before a follow-up failure", async () => {
  const { shareToDestination, saveAllDestinations } = loadDeliverContext({ requestErrorAt: 2 });
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await assert.rejects(
    () => shareToDestination("main", videoTweet, {
      includeQuote: false,
      fetchMediaBytes() {
        throw new Error("unavailable");
      }
    }),
    /Sent 1 of 2 Discord messages before delivery failed: follow-up failed/
  );
});
