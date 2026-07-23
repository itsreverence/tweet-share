// Discord currently caps the complete message request at 25 MiB. Keep 1 MiB
// available for multipart boundaries, filenames, and the JSON payload.
const ATTACHMENT_MAX_BYTES = 24 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 10;
const MEDIA_FETCH_TIMEOUT_MS = 20_000;
const MEDIA_SIZE_TIMEOUT_MS = 5_000;

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
      timeout: MEDIA_FETCH_TIMEOUT_MS,
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
      },
      ontimeout() {
        reject(new Error("Media download timed out."));
      }
    });
  });
}

function responseContentLength(response) {
  const match = String(response?.responseHeaders || "").match(/^content-length:\s*(\d+)\s*$/im);
  return match ? Number(match[1]) : 0;
}

function fetchMediaSize(url) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method: "HEAD",
      url,
      timeout: MEDIA_SIZE_TIMEOUT_MS,
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          resolve(responseContentLength(response));
          return;
        }
        reject(new Error(`Media size check returned ${response.status}`));
      },
      onerror() {
        reject(new Error("Could not check media size."));
      },
      ontimeout() {
        reject(new Error("Media size check timed out."));
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
      const url = normalizeTweetVideoUrl(item.url);
      if (url) mediaByUrl.set(url, { ...item, url });
    }
    for (const item of imageMedia(post)) {
      if (item.url) mediaByUrl.set(item.url, item);
    }
  }

  addMedia(tweet);
  if (shareOptions.includeQuote !== false && hasQuoteTweet(tweet)) addMedia(tweet.quote);

  return urls.map((url) => mediaByUrl.get(url) || {
    type: /\.mp4(?:\?|$)/i.test(url) ? "video" : "image",
    url
  });
}

function mediaAttachmentVariantUrls(media) {
  if (media.type !== "video") return media.url ? [media.url] : [];
  const variants = playableVideoVariantsForMedia(media).map((variant) => variant.url);
  const directUrl = normalizeTweetVideoUrl(media.url || "");
  return unique([...variants, directUrl].filter(isPlayableTweetVideoUrl));
}

async function resolveMediaAttachment(media, remainingBytes, options = {}) {
  const fetcher = options.fetchMediaBytes || fetchMediaBytes;
  const sizeFetcher = options.fetchMediaSize || fetchMediaSize;
  const variantUrls = mediaAttachmentVariantUrls(media);
  let lastFetchError = null;
  let sawOversizedVariant = false;

  for (const url of variantUrls) {
    if (media.type === "video") {
      try {
        const declaredSize = await sizeFetcher(url, media);
        if (declaredSize > remainingBytes) {
          sawOversizedVariant = true;
          continue;
        }
      } catch {
        // Some CDNs reject HEAD requests. The bounded GET below remains the
        // source of truth and still enforces the request budget.
      }
    }

    try {
      const bytes = await fetcher(url, { ...media, url });
      const size = attachmentBytesLength(bytes);
      if (size > remainingBytes) {
        sawOversizedVariant = true;
        continue;
      }
      return { bytes, size, url };
    } catch (error) {
      lastFetchError = error;
    }
  }

  return {
    error: lastFetchError,
    reason: lastFetchError ? "fetch" : (sawOversizedVariant ? "size" : "fetch")
  };
}

async function resolveAttachmentsForTweet(tweet, shareOptions = {}) {
  const attachments = [];
  const skipped = [];
  const resolvedUrls = [];
  let totalBytes = 0;
  const candidates = collectMediaAttachmentItems(tweet, shareOptions);

  for (const media of candidates) {
    if (attachments.length >= ATTACHMENT_MAX_COUNT) {
      skipped.push({ sourceUrl: media.url, reason: "count" });
      continue;
    }
    if (!media.url) continue;

    const resolved = await resolveMediaAttachment(media, ATTACHMENT_MAX_BYTES - totalBytes, shareOptions);
    if (resolved.bytes) {
      const index = attachments.length;
      attachments.push({
        filename: attachmentFilename(media, index),
        bytes: resolved.bytes,
        contentType: mediaContentType(media, resolved.url),
        sourceUrl: resolved.url
      });
      totalBytes += resolved.size;
      const primaryUrl = media.type === "video" ? normalizeTweetVideoUrl(media.url) : media.url;
      resolvedUrls.push(primaryUrl, resolved.url);
      continue;
    }

    skipped.push({
      sourceUrl: media.url,
      reason: resolved.reason,
      error: resolved.error
    });
  }

  return { attachments, skipped, urls: unique(resolvedUrls.filter(Boolean)) };
}
