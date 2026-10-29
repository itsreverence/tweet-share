import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");
const validWebhook = "https://discord.com/api/webhooks/1234567890/abc_DEF-123";

function loadDeliverContext({ multipartError = null, requestErrorAt = null, holdDelays = false } = {}) {
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
  const calls = { requests: [], multipart: [], toasts: [], log: [], heldDelays: [] };

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
    delay(ms) {
      calls.log.push({ kind: "delay", ms });
      return holdDelays ? new Promise((resolve) => calls.heldDelays.push(resolve)) : Promise.resolve();
    },
    showToast(message, state) {
      calls.toasts.push({ message, state });
    },
    __calls: calls,
    __multipartError: multipartError,
    __requestErrorAt: requestErrorAt,
    xhrClient() {
      throw new Error("xhrClient should not run in deliver tests");
    }
  });

  runInNewContext(
    `${code}
request = async (method, url, body) => {
  const entry = { method, url, body, kind: "json" };
  __calls.requests.push(entry);
  __calls.log.push(entry);
  if (__requestErrorAt === __calls.requests.length) throw new Error("follow-up failed");
  return {};
};
requestMultipart = async (url, payload, files) => {
  if (__multipartError) throw __multipartError;
  const entry = {
    url,
    payload,
    files: files.map((file) => ({ filename: file.filename, contentType: file.contentType })),
    kind: "multipart"
  };
  __calls.multipart.push(entry);
  __calls.log.push(entry);
  return {};
};
this.exports = {
  shareToDestination,
  buildWebhookTestPayload,
  sendWebhookTest,
  saveAllDestinations
};`,
    context
  );

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
  assert.equal(calls.requests[1].body.content, mainVideoUrl);
  assert.doesNotMatch(JSON.stringify(calls.requests), /Plays below|poster/);
  assert.deepEqual(calls.toasts.map((toast) => toast.message), ["Media not uploaded; 1 failed to download."]);
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

const quoteWithPhotosAndVideo = (videoUrl) => ({
  url: "https://x.com/alice/status/3",
  author: { displayName: "Alice", username: "alice" },
  text: `${"Long post. ".repeat(800)}end`,
  media: [],
  quote: {
    url: "https://x.com/bob/status/2",
    author: { displayName: "Bob", username: "bob" },
    text: "Quoted",
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/q1.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/q2.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/q3.jpg" },
      { type: "video", url: videoUrl }
    ]
  }
});

test("photos that a later message links are never downloaded, so they cannot spend the upload budget", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);
  const fetched = [];

  await shareToDestination("main", quoteWithPhotosAndVideo(mainVideoUrl), {
    fetchMediaSize: () => 10 * 1024 * 1024 - 5,
    fetchMediaBytes(url) {
      fetched.push(url);
      return { byteLength: /\.mp4/.test(url) ? 10 * 1024 * 1024 - 5 : 5 * 1024 * 1024 };
    }
  });

  assert.deepEqual(fetched, [mainVideoUrl], "only the video is downloaded");
  assert.equal(calls.multipart.length, 1, "the video uploads with the first message");
  assert.deepEqual(Array.from(calls.multipart[0].files, (file) => file.contentType), ["video/mp4"]);
  const linked = calls.requests.flatMap((entry) => (entry.body.embeds || []).map((embed) => embed.image?.url)).filter(Boolean);
  assert.deepEqual(linked, ["https://pbs.twimg.com/media/q1.jpg", "https://pbs.twimg.com/media/q2.jpg", "https://pbs.twimg.com/media/q3.jpg"], "the later message links the quote's photos");
  assert.equal(calls.toasts.length, 0, "nothing was skipped, so there is nothing to report");
});

test("a video that cannot upload is reported even when no file uploads at all", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", quoteWithPhotosAndVideo(skippedVideoUrl), {
    fetchMediaSize: () => 15 * 1024 * 1024,
    fetchMediaBytes: () => ({ byteLength: 15 * 1024 * 1024 })
  });

  assert.equal(calls.multipart.length, 0, "nothing uploads");
  assert.ok(calls.requests.at(-1).body.content.includes(skippedVideoUrl), "the video follows as a link");
  assert.deepEqual(calls.toasts.map((toast) => toast.message), ["Media not uploaded; video too large for Discord, sent as a link."]);
});

test("a photo skipped for the upload budget keeps its link, and the toast counts what uploaded", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);
  const photos = ["a", "b", "c"].map((name) => `https://pbs.twimg.com/media/${name}.jpg`);

  await shareToDestination("main", { ...sampleTweet, media: photos.map((url) => ({ type: "image", url })) }, {
    includeQuote: false,
    fetchMediaBytes: () => ({ byteLength: 9 * 1024 * 1024 })
  });

  assert.equal(calls.multipart.length, 1);
  assert.deepEqual(Array.from(calls.multipart[0].files, (file) => file.filename), ["media_0.jpg", "media_1.jpg"], "two photos fit the 24 MiB request budget");
  const shown = Array.from(calls.multipart[0].payload.embeds, (embed) => embed.image.url);
  assert.deepEqual(shown, ["attachment://media_0.jpg", "attachment://media_1.jpg", photos[2]], "the third photo stays a link in the same card");
  assert.deepEqual(calls.toasts.map((toast) => toast.message), ["Uploaded 2 files; 1 too large."]);
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

test("shareToDestination waits out each pacing delay before sending the next message", { timeout: 5000 }, async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext({ holdDelays: true });
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

  let finished = false;
  const sharing = shareToDestination("main", tweet, {
    includeQuote: false,
    fetchMediaBytes() {
      throw new Error("unavailable");
    }
  }).finally(() => {
    finished = true;
  });
  const untilDelayHeldOrShareDone = async () => {
    const deadline = Date.now() + 2000;
    while (!finished && calls.heldDelays.length === 0) {
      if (Date.now() > deadline) assert.fail("the share neither finished nor reached a pacing delay within 2000 ms");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  await untilDelayHeldOrShareDone();
  while (calls.heldDelays.length > 0) {
    const delaysSoFar = calls.log.filter((entry) => entry.kind === "delay").length;
    assert.equal(calls.heldDelays.length, 1, "only one delay is pending at a time");
    assert.equal(calls.log.length - delaysSoFar, delaysSoFar, "no message is sent while a delay is pending");
    calls.heldDelays.shift()();
    await untilDelayHeldOrShareDone();
  }
  await sharing;

  const messageCount = calls.log.filter((entry) => entry.kind !== "delay").length;
  assert.ok(messageCount >= 2, "an embed message and a video message are sent");
  const expected = Array.from({ length: messageCount }, (_, index) => (index === 0 ? ["json"] : ["delay", "json"])).flat();
  assert.deepEqual(calls.log.map((entry) => entry.kind), expected, "one delay between each pair of messages");
  const observedWebhookBucket = { requests: 5, perMs: 2000 };
  const minimumGapMs = observedWebhookBucket.perMs / observedWebhookBucket.requests;
  for (const entry of calls.log.filter((entry) => entry.kind === "delay")) {
    assert.ok(
      entry.ms >= minimumGapMs,
      `delay of ${entry.ms} ms falls below the ${minimumGapMs} ms regression floor, one slot of the ${observedWebhookBucket.requests}-per-${observedWebhookBucket.perMs} ms webhook bucket Discord applies in practice`
    );
  }
});

test("shareToDestination sends no internal message labels to Discord", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);

  await shareToDestination("main", {
    ...sampleTweet,
    text: "Long post. ".repeat(900),
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/photo.jpg" },
      { type: "video", url: skippedVideoUrl }
    ]
  }, {
    includeQuote: false,
    fetchMediaBytes(url) {
      if (url === skippedVideoUrl) throw new Error("unavailable");
      return { byteLength: 128 };
    }
  });

  assert.equal(calls.multipart.length, 1, "the first message uploads the image");
  assert.ok(calls.requests.length >= 2, "continuation embeds and the video link are sent as JSON");
  const bodies = [...calls.multipart.map((entry) => entry.payload), ...calls.requests.map((entry) => entry.body)];
  for (const [index, body] of bodies.entries()) {
    assert.equal(Object.hasOwn(body, "_messageLabel"), false, `message ${index + 1} has no _messageLabel`);
  }
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


test("a quoted video uploads before photos can spend its request budget", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);
  const photos = ["a", "b", "c", "d"].map((name) => `https://pbs.twimg.com/media/${name}.jpg`);
  await shareToDestination("main", {
    ...sampleTweet,
    media: photos.map((url) => ({ type: "image", url })),
    quote: { url: "https://x.com/bob/status/2", text: "video", media: [{ type: "video", url: mainVideoUrl }] }
  }, {
    fetchMediaSize: () => 9 * 1024 * 1024,
    fetchMediaBytes: (url) => ({ byteLength: (url === mainVideoUrl ? 9 : 4.5) * 1024 * 1024 })
  });
  const sent = calls.multipart[0];
  assert.equal(sent.files.filter((file) => file.contentType === "video/mp4").length, 1);
  assert.equal(sent.files.length, 4, "the video and three photos fit");
  assert.deepEqual(Array.from(sent.payload.embeds, (embed) => embed.image?.url).filter(Boolean),
    ["attachment://media_1.jpg", "attachment://media_2.jpg", "attachment://media_3.jpg", photos[3]]);
  assert.equal(calls.requests.length, 0, "the uploaded video needs no fallback message");
});


test("a skipped oversized video is named in the toast when a photo uploads", async () => {
  const { shareToDestination, saveAllDestinations, calls } = loadDeliverContext();
  await saveAllDestinations([{ id: "main", label: "Main", webhookUrl: validWebhook }]);
  await shareToDestination("main", { ...sampleTweet, media: [videoTweet.media[0], ...sampleTweet.media] }, {
    fetchMediaSize: () => 15 * 1024 * 1024,
    fetchMediaBytes: (url) => ({ byteLength: /\.mp4/.test(url) ? 15 * 1024 * 1024 : 100 })
  });
  assert.deepEqual(calls.toasts.map((toast) => toast.message),
    ["Uploaded 1 file; video too large for Discord, sent as a link."]);
});
