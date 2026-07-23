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
    ATTACHMENT_REQUEST_MAX_BYTES,
    attachmentFilename,
    collectMediaAttachmentUrls,
    fetchMediaSize,
    fetchMediaBytes,
    MEDIA_FETCH_TIMEOUT_MS,
    MEDIA_SIZE_TIMEOUT_MS,
    resolveAttachmentsForTweet,
    summarizeSkippedMedia
  };`, context);
  return context.exports;
}

const {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_REQUEST_MAX_BYTES,
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

test("Buzz Patterson video skips its 15.3 MB variant and uploads the best default-limit variant", async () => {
  const highUrl = "https://video.twimg.com/amplify_video/2079786897140772864/vid/avc1/1288x2230/high.mp4";
  const mediumUrl = "https://video.twimg.com/amplify_video/2079786897140772864/vid/avc1/720x1246/medium.mp4";
  const sizes = new Map([
    [highUrl, 15_319_401],
    [mediumUrl, 3_744_793]
  ]);
  const resolved = await resolveAttachmentsForTweet({
    ...tweet,
    media: [{
      type: "video",
      url: highUrl,
      variants: [
        { content_type: "video/mp4", url: highUrl, bitrate: 10_368_000 },
        { content_type: "video/mp4", url: mediumUrl, bitrate: 2_176_000 }
      ]
    }]
  }, {
    fetchMediaSize(url) {
      return sizes.get(url);
    },
    fetchMediaBytes(url) {
      return { byteLength: sizes.get(url) };
    }
  });

  assert.equal(resolved.attachments.length, 1);
  assert.equal(resolved.attachments[0].sourceUrl, mediumUrl);
  assert.equal(resolved.attachments[0].bytes.byteLength, 3_744_793);
  assert.equal(resolved.skipped.length, 0);
});

test("oversized highest-quality video falls back to the best fitting variant", async () => {
  const highUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/1288x2230/high.mp4";
  const mediumUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/720x1246/medium.mp4";
  const lowUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/480x830/low.mp4";
  const sizes = new Map([
    [highUrl, ATTACHMENT_MAX_BYTES + 1],
    [mediumUrl, 3_744_793],
    [lowUrl, 2_042_211]
  ]);
  const fetched = [];
  const resolved = await resolveAttachmentsForTweet({
    ...tweet,
    media: [{
      type: "video",
      url: highUrl,
      variants: [
        { content_type: "video/mp4", url: highUrl, bitrate: 10_368_000 },
        { content_type: "video/mp4", url: mediumUrl, bitrate: 2_176_000 },
        { content_type: "video/mp4", url: lowUrl, bitrate: 950_000 }
      ]
    }]
  }, {
    fetchMediaSize(url) {
      return sizes.get(url);
    },
    fetchMediaBytes(url) {
      fetched.push(url);
      return { byteLength: sizes.get(url) };
    }
  });

  assert.deepEqual(fetched, [mediumUrl]);
  assert.equal(resolved.attachments[0].sourceUrl, mediumUrl);
  assert.deepEqual(Array.from(resolved.urls), [highUrl, mediumUrl]);
  assert.equal(resolved.skipped.length, 0);
});

test("failed size probes still fall back after enforcing downloaded byte size", async () => {
  const highUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/1288x2230/high.mp4";
  const lowUrl = "https://video.twimg.com/amplify_video/1/vid/avc1/720x1246/low.mp4";
  const fetched = [];
  const resolved = await resolveAttachmentsForTweet({
    ...tweet,
    media: [{
      type: "video",
      url: highUrl,
      variants: [
        { content_type: "video/mp4", url: highUrl, bitrate: 10_368_000 },
        { content_type: "video/mp4", url: lowUrl, bitrate: 2_176_000 }
      ]
    }]
  }, {
    fetchMediaSize() {
      throw new Error("HEAD unavailable");
    },
    fetchMediaBytes(url) {
      fetched.push(url);
      return { byteLength: url === highUrl ? ATTACHMENT_MAX_BYTES + 1 : 3_744_793 };
    }
  });

  assert.deepEqual(fetched, [highUrl, lowUrl]);
  assert.equal(resolved.attachments[0].sourceUrl, lowUrl);
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

test("attachments share one bounded multipart request budget", async () => {
  const firstImage = "https://pbs.twimg.com/media/first.jpg";
  const secondImage = "https://pbs.twimg.com/media/second.jpg";
  const thirdImage = "https://pbs.twimg.com/media/third.jpg";
  const resolved = await resolveAttachmentsForTweet({
    ...tweet,
    media: [
      { type: "image", url: firstImage },
      { type: "image", url: secondImage },
      { type: "image", url: thirdImage }
    ]
  }, {
    fetchMediaBytes() {
      return { byteLength: 9 * 1024 * 1024 };
    }
  });

  assert.equal(resolved.attachments.length, 2);
  assert.equal(resolved.skipped.length, 1);
  assert.equal(resolved.skipped[0].sourceUrl, thirdImage);
  assert.equal(resolved.skipped[0].reason, "size");
  assert.equal(ATTACHMENT_REQUEST_MAX_BYTES, 24 * 1024 * 1024);
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

test("video size probes use a bounded HEAD request and parse content length", async () => {
  let requestOptions;
  const { fetchMediaSize, MEDIA_SIZE_TIMEOUT_MS } = loadMediaFetchContext((options) => {
    requestOptions = options;
    queueMicrotask(() => options.onload({
      status: 200,
      responseHeaders: "content-type: video/mp4\r\nContent-Length: 15319401\r\n"
    }));
  });

  assert.equal(await fetchMediaSize(videoUrl), 15_319_401);
  assert.equal(requestOptions.method, "HEAD");
  assert.equal(requestOptions.timeout, MEDIA_SIZE_TIMEOUT_MS);
});
