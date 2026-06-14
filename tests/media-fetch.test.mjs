import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");

function loadMediaFetchContext() {
  const files = ["00-config.js", "02-utils.js", "04-video.js", "05-format-discord.js", "13-media-fetch.js"];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = createContext({
    console,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] }
  });
  runInNewContext(`${code}\nthis.exports = {
    ATTACHMENT_MAX_BYTES,
    ATTACHMENT_MAX_COUNT,
    attachmentFilename,
    collectMediaAttachmentUrls,
    resolveAttachmentsForTweet,
    summarizeSkippedMedia
  };`, context);
  return context.exports;
}

const {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  attachmentFilename,
  collectMediaAttachmentUrls,
  resolveAttachmentsForTweet,
  summarizeSkippedMedia
} = loadMediaFetchContext();

const tweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice" },
  text: "media",
  media: [
    { type: "image", url: "https://pbs.twimg.com/media/main-one.jpg" },
    { type: "video", url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4" },
    { type: "image", url: "https://pbs.twimg.com/media/main-two.png" }
  ],
  quote: {
    url: "https://x.com/bob/status/2",
    author: { displayName: "Bob", username: "bob" },
    text: "quote",
    media: [
      { type: "video", url: "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4" },
      { type: "image", url: "https://pbs.twimg.com/media/quote-one.webp" }
    ]
  }
};

test("collectMediaAttachmentUrls uploads mixed image/video media in post order, main before quote", () => {
  assert.deepEqual(Array.from(collectMediaAttachmentUrls(tweet)), [
    "https://pbs.twimg.com/media/main-one.jpg",
    "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4",
    "https://pbs.twimg.com/media/main-two.png",
    "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4",
    "https://pbs.twimg.com/media/quote-one.webp"
  ]);
});

test("attachmentFilename uses stable media indexes and extensions", () => {
  assert.equal(attachmentFilename({ type: "video", url: "https://video.twimg.com/clip.mp4" }, 0), "media_0.mp4");
  assert.equal(attachmentFilename({ type: "image", url: "https://pbs.twimg.com/media/a.png?name=orig" }, 1), "media_1.png");
  assert.equal(attachmentFilename({ type: "image", url: "https://pbs.twimg.com/media/a.jpg:small" }, 2), "media_2.jpg");
});

test("summarizeSkippedMedia describes skipped attachment reasons", () => {
  assert.equal(summarizeSkippedMedia([]), "");
  assert.equal(summarizeSkippedMedia([{ reason: "size" }]), "1 too large");
  assert.equal(summarizeSkippedMedia([
    { reason: "fetch" },
    { reason: "size" },
    { reason: "count" },
    { reason: "fetch" }
  ]), "1 too large, 2 failed to download, 1 over limit");
});

test("resolveAttachmentsForTweet skips oversized videos without throwing", async () => {
  const resolved = await resolveAttachmentsForTweet(tweet, {
    fetchMediaBytes(url) {
      if (/quote\.mp4$/.test(url)) return { byteLength: ATTACHMENT_MAX_BYTES + 1 };
      return { byteLength: 1024 };
    }
  });

  assert.equal(resolved.attachments.length, 4);
  assert.deepEqual(Array.from(resolved.attachments, (item) => item.sourceUrl), [
    "https://pbs.twimg.com/media/main-one.jpg",
    "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4",
    "https://pbs.twimg.com/media/main-two.png",
    "https://pbs.twimg.com/media/quote-one.webp"
  ]);
  assert.ok(resolved.skipped.some((item) => /quote\.mp4$/.test(item.sourceUrl) && item.reason === "size"));
});

test("resolveAttachmentsForTweet caps attachments at Discord limit", async () => {
  const many = {
    ...tweet,
    quote: null,
    media: Array.from({ length: ATTACHMENT_MAX_COUNT + 2 }, (_, index) => ({
      type: "video",
      url: `https://video.twimg.com/ext_tw_video/${index}/pu/vid/1280x720/clip.mp4`
    }))
  };

  const resolved = await resolveAttachmentsForTweet(many, {
    fetchMediaBytes() {
      return { byteLength: 10 };
    }
  });

  assert.equal(resolved.attachments.length, ATTACHMENT_MAX_COUNT);
  assert.equal(resolved.skipped.length, 2);
  assert.equal(resolved.skipped.every((item) => item.reason === "count"), true);
});
