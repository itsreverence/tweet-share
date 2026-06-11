const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 10;

function mediaUrlExtension(url, fallback = "bin") {
  const match = String(url || "").split("?")[0].match(/\.([a-z0-9]+)(?::[a-z]+)?$/i);
  return (match?.[1] || fallback).toLowerCase().replace("jpeg", "jpg");
}

function mediaContentType(media, url = media?.url || "") {
  if (media?.type === "video" || /\.mp4(?:\?|$)/i.test(url)) return "video/mp4";
  const extension = mediaUrlExtension(url, "jpg");
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

function attachmentFilename(media, index) {
  const extension = media?.type === "video" ? "mp4" : mediaUrlExtension(media?.url, "jpg");
  return `media_${index}.${extension}`;
}

function fetchMediaBytes(url) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method: "GET",
      url,
      responseType: "arraybuffer",
      onload(response) {
        if (response.status >= 200 && response.status < 300 && response.response) {
          resolve(response.response);
          return;
        }
        reject(new Error(`Media fetch returned ${response.status}`));
      },
      onerror() {
        reject(new Error("Could not fetch media for upload."));
      }
    });
  });
}

function attachmentBytesLength(bytes) {
  return bytes?.byteLength ?? bytes?.size ?? bytes?.length ?? 0;
}

function summarizeSkippedMedia(skipped = []) {
  if (!skipped.length) return "";
  const byReason = { fetch: 0, size: 0, count: 0 };
  for (const item of skipped) {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  }

  const parts = [];
  if (byReason.size) parts.push(`${byReason.size} too large`);
  if (byReason.fetch) parts.push(`${byReason.fetch} failed to download`);
  if (byReason.count) parts.push(`${byReason.count} over limit`);
  return parts.join(", ");
}

function collectMediaAttachmentItems(tweet, shareOptions = {}) {
  const urls = collectMediaAttachmentUrls(tweet, shareOptions);
  const mediaByUrl = new Map();

  function addMedia(post) {
    for (const item of videoMedia(post)) {
      if (item.url) mediaByUrl.set(item.url, item);
    }
    for (const item of imageMedia(post)) {
      if (item.url) mediaByUrl.set(item.url, item);
    }
  }

  addMedia(tweet);
  if (shareOptions.includeQuote !== false && hasQuoteTweet(tweet)) addMedia(tweet.quote);

  return urls.map((url) => mediaByUrl.get(url) || { type: /\.mp4(?:\?|$)/i.test(url) ? "video" : "image", url });
}

async function resolveAttachmentsForTweet(tweet, shareOptions = {}) {
  const attachments = [];
  const skipped = [];
  const fetcher = shareOptions.fetchMediaBytes || fetchMediaBytes;
  const candidates = collectMediaAttachmentItems(tweet, shareOptions);

  for (const media of candidates) {
    if (attachments.length >= ATTACHMENT_MAX_COUNT) {
      skipped.push({ sourceUrl: media.url, reason: "count" });
      continue;
    }
    if (!media.url) continue;

    try {
      const bytes = await fetcher(media.url, media);
      const size = attachmentBytesLength(bytes);
      if (size > ATTACHMENT_MAX_BYTES) {
        skipped.push({ sourceUrl: media.url, reason: "size", size });
        continue;
      }
      const index = attachments.length;
      attachments.push({
        filename: attachmentFilename(media, index),
        bytes,
        contentType: mediaContentType(media, media.url),
        sourceUrl: media.url
      });
    } catch (error) {
      skipped.push({ sourceUrl: media.url, reason: "fetch", error });
    }
  }

  return { attachments, skipped, urls: attachments.map((item) => item.sourceUrl) };
}
