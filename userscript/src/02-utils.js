function truncate(value, limit) {
  const textValue = String(value || "").trim();
  if (textValue.length <= limit) return textValue;
  const suffix = "...";
  if (limit <= suffix.length) return suffix.slice(0, Math.max(0, limit));
  return `${textValue.slice(0, limit - suffix.length).trimEnd()}${suffix}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function text(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() || "";
}

function absoluteUrl(url) {
  try {
    return new URL(url, location.href).toString();
  } catch {
    return "";
  }
}

function normalizeTweetUrl(url) {
  const parsed = new URL(url, location.href);
  parsed.hostname = "x.com";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/(\/status\/\d+).*/, "$1");
  return parsed.toString();
}

function tweetIdFromUrl(url) {
  return String(url || "").match(/\/status\/(\d+)/)?.[1] || "";
}

function highResolutionProfileImageUrl(url) {
  return (url || "").replace(/_normal(\.(?:jpg|jpeg|png|webp))(?:\?|$)/i, "$1");
}

function isTweetImageMediaUrl(url) {
  const value = String(url || "");
  return /^https:\/\/pbs\.twimg\.com\/media\//i.test(value)
    && !/(?:\.svg(?:[?:]|$)|[?&]format=svg\b|:svg(?:\?|$))/i.test(value);
}

function highResolutionTweetImageUrl(url) {
  if (!isTweetImageMediaUrl(url)) return url;
  const base = url.split("?")[0].replace(/:(?:small|medium|large|orig|thumb)$/i, "");
  return `${base}?format=jpg&name=orig`;
}

function discordEmbedTimestamp(createdAt) {
  const raw = String(createdAt || "").trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeTextForMatch(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPlayableTweetVideoUrl(url) {
  return /^https:\/\/video\.twimg\.com\/.+\.mp4(?:\?|$)/.test(url || "") && !/\/aud\//.test(url || "");
}

function normalizeTweetVideoUrl(url) {
  if (!url) return "";
  return url.replace(/\/vid\/([^/]+)\/0\/0\/(\d+x\d+)\//, "/vid/$1/$2/");
}

function isTweetVideoPosterUrl(url) {
  return /^https:\/\/pbs\.twimg\.com\/.+\.(?:jpg|jpeg|png|webp)(?:\?|$)/.test(url || "");
}

function isTweetVideoThumbnailUrl(url) {
  return /^https:\/\/pbs\.twimg\.com\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(url || "");
}

function posterMediaId(url) {
  return (url || "").match(/\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d+)\//)?.[1] || "";
}

function videoQualityScore(url) {
  if (/\/amplify_video\/|\/ext_tw_video\//.test(url)) return 2_000_000_000;
  if (/\/vid\//.test(url)) return 1_000_000_000;
  if (/\/tweet_video\//.test(url)) return 500_000_000;

  const resolution = url.match(/\/(\d+)x(\d+)\//);
  if (resolution) {
    return Number(resolution[1]) * Number(resolution[2]);
  }

  const bitrate = url.match(/[?&](?:bitrate|br)=(\d+)/i) || url.match(/_(\d+)\.mp4(?:\?|$)/i);
  return bitrate ? Number(bitrate[1]) : 0;
}

function compareTweetVideoQuality(left, right) {
  return videoQualityScore(right) - videoQualityScore(left);
}

function playableVideoVariants(variants = []) {
  return variants
    .map((variant) => ({
      url: normalizeTweetVideoUrl(variant.url || variant.src || ""),
      bitrate: variant.bitrate || 0,
      type: variant.content_type || variant.type || ""
    }))
    .filter((variant) => variant.type === "video/mp4" && isPlayableTweetVideoUrl(variant.url))
    .filter((variant, index, all) => all.findIndex((candidate) => candidate.url === variant.url) === index)
    .sort((left, right) => (right.bitrate || videoQualityScore(right.url)) - (left.bitrate || videoQualityScore(left.url)));
}

function bestPlayableVideoVariantUrl(variants = []) {
  return playableVideoVariants(variants)[0]?.url || "";
}

function uniqueMedia(items) {
  return items.filter((item, index, all) => {
    const key = item.url || item.posterUrl;
    return key && all.findIndex((candidate) => (candidate.url || candidate.posterUrl) === key) === index;
  });
}

function tweetImageMediaKey(url) {
  return (url || "").match(/pbs\.twimg\.com\/media\/([^.?/:]+)/)?.[1] || "";
}

function mergeAuthor(primary = {}, fallback = {}) {
  return {
    displayName: primary.displayName || fallback.displayName || "",
    username: primary.username || fallback.username || "",
    avatarUrl: primary.avatarUrl || fallback.avatarUrl || ""
  };
}

function isInsideExcludedNode(node, excludedNodes = []) {
  return excludedNodes.some((excludedNode) => excludedNode && excludedNode !== node && excludedNode.contains(node));
}
