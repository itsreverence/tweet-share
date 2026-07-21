import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");

function loadMediaFetchContext(xhrHandler = () => {
  throw new Error("Unexpected media request");
}) {
  const files = ["00-config.js", "02-utils.js", "04-video.js", "05-format-discord.js", "13-media-fetch.js"];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = createContext({
    console,
    URL,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] },
    xhrClient: () => xhrHandler
  });
  runInNewContext(`${code}\nthis.exports = {
    ATTACHMENT_MAX_BYTES,
    ATTACHMENT_MAX_COUNT,
    attachmentFilename,
    collectMediaAttachmentUrls,
    fetchMediaBytes,
    MEDIA_FETCH_TIMEOUT_MS,
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

const videoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4";
const imageUrl = "https://pbs.twimg.com/media/main-one.jpg";
const tweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice" },
  text: "media",
  media: [
    { type: "video", url: videoUrl },
    { type: "image", url: imageUrl }
  ]
};

test("collectMediaAttachmentUrls keeps media order", () => {
  assert.deepEqual(Array.from(collectMediaAttachmentUrls(tweet)), [videoUrl, imageUrl]);
});

test("collectMediaAttachmentUrls deduplicates responsive variants shared by main and quoted posts", () => {
  const duplicatedImage = "https://pbs.twimg.com/media/quote-one.jpg?format=jpg&name=small";
  const quotedVariant = "https://pbs.twimg.com/media/quote-one?format=png&name=orig";
  const quoteOnlyImages = [
    "https://pbs.twimg.com/media/quote-two.jpg?format=jpg&name=orig",
    "https://pbs.twimg.com/media/quote-three.jpg?format=jpg&name=orig"
  ];
  const urls = collectMediaAttachmentUrls({
    ...tweet,
    media: [{ type: "image", url: duplicatedImage }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted post",
      media: [
        { type: "image", url: quotedVariant },
        ...quoteOnlyImages.map((url) => ({ type: "image", url }))
      ]
    }
  });

  assert.deepEqual(Array.from(urls), [duplicatedImage, ...quoteOnlyImages]);
});

test("successful video fetch creates one MP4 attachment", async () => {
  const resolved = await resolveAttachmentsForTweet({ ...tweet, media: [tweet.media[0]] }, {
    fetchMediaBytes() {
      return { byteLength: 1024 };
    }
  });

  assert.equal(resolved.attachments.length, 1);
  assert.equal(resolved.attachments[0].filename, "media_0.mp4");
  assert.equal(resolved.attachments[0].contentType, "video/mp4");
  assert.equal(resolved.attachments[0].sourceUrl, videoUrl);
  assert.deepEqual(Array.from(resolved.urls), [videoUrl]);
  assert.equal(resolved.skipped.length, 0);
});

test("oversized video is skipped with its source URL and size reason", async () => {
  const resolved = await resolveAttachmentsForTweet({ ...tweet, media: [tweet.media[0]] }, {
    fetchMediaBytes() {
      return { byteLength: ATTACHMENT_MAX_BYTES + 1 };
    }
  });

  assert.equal(resolved.attachments.length, 0);
  assert.equal(resolved.skipped.length, 1);
  assert.equal(resolved.skipped[0].sourceUrl, videoUrl);
  assert.equal(resolved.skipped[0].reason, "size");
});

test("failed fetch is skipped with its source URL and fetch reason", async () => {
  const resolved = await resolveAttachmentsForTweet({ ...tweet, media: [tweet.media[0]] }, {
    fetchMediaBytes() {
      throw new Error("network down");
    }
  });

  assert.equal(resolved.attachments.length, 0);
  assert.equal(resolved.skipped.length, 1);
  assert.equal(resolved.skipped[0].sourceUrl, videoUrl);
  assert.equal(resolved.skipped[0].reason, "fetch");
});

test("ten-file limit retains every over-limit source URL", async () => {
  const many = {
    ...tweet,
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
  assert.equal(resolved.skipped.every((item) => item.reason === "count" && item.sourceUrl), true);
});

test("partial success returns attachments and skipped source details", async () => {
  const resolved = await resolveAttachmentsForTweet(tweet, {
    fetchMediaBytes(url) {
      if (url === imageUrl) throw new Error("image unavailable");
      return { byteLength: 1024 };
    }
  });

  assert.deepEqual(Array.from(resolved.urls), [videoUrl]);
  assert.equal(resolved.attachments.length, 1);
  assert.equal(resolved.skipped.length, 1);
  assert.equal(resolved.skipped[0].sourceUrl, imageUrl);
  assert.equal(resolved.skipped[0].reason, "fetch");
});

test("attachment helpers keep stable names and summarize reasons", () => {
  assert.equal(attachmentFilename({ type: "image", url: "https://pbs.twimg.com/media/a.png?name=orig" }, 1), "media_1.png");
  assert.equal(summarizeSkippedMedia([
    { reason: "fetch" },
    { reason: "size" },
    { reason: "count" },
    { reason: "fetch" }
  ]), "1 too large, 2 failed to download, 1 over limit");
});

test("media downloads apply a timeout and surface timeout failures", async () => {
  let requestOptions;
  const { fetchMediaBytes, MEDIA_FETCH_TIMEOUT_MS } = loadMediaFetchContext((options) => {
    requestOptions = options;
    queueMicrotask(() => options.ontimeout());
  });

  await assert.rejects(() => fetchMediaBytes(videoUrl), /timed out/i);
  assert.equal(requestOptions.timeout, MEDIA_FETCH_TIMEOUT_MS);
});
