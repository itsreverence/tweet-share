function directVideoUrlsFromDocument() {
  let entries = [];
  try {
    entries = performance.getEntriesByType("resource").map((entry) => entry.name);
  } catch {
    entries = [];
  }

  const sourceUrls = [...document.querySelectorAll("video source[src], video[src]")]
    .map((node) => node.src || node.getAttribute("src") || "");

  return unique([...entries, ...sourceUrls].map(normalizeTweetVideoUrl).filter(isPlayableTweetVideoUrl))
    .sort(compareTweetVideoQuality);
}

function nearestPlayableVideoUrl(video) {
  const candidates = [
    video.currentSrc,
    video.src,
    ...[...video.querySelectorAll("source[src]")].map((source) => source.src || source.getAttribute("src") || "")
  ].map(normalizeTweetVideoUrl).filter(isPlayableTweetVideoUrl).sort(compareTweetVideoQuality);
  if (candidates.length > 0) return candidates[0];

  const poster = video.poster || "";
  const mediaId = posterMediaId(poster);
  const cached = VIDEO_VARIANT_CACHE.get(mediaId);
  if (cached?.length) return cached[0].url;

  const loadedVideos = directVideoUrlsFromDocument();
  const matchingMediaId = mediaId ? loadedVideos.filter((url) => url.includes(`/${mediaId}/`)) : [];
  if (matchingMediaId.length > 0) return matchingMediaId[0];

  const posterName = poster.split("/").pop()?.split("?")[0]?.replace(/\.(jpg|jpeg|png|webp)$/i, "") || "";
  const matchingPoster = loadedVideos.find((url) => posterName && url.includes(posterName));
  if (matchingPoster) return matchingPoster;

  return "";
}

function imageMedia(tweet) {
  return (tweet.media || []).filter((item) => item.type === "image" && item.url && !isTweetVideoThumbnailUrl(item.url));
}

function videoMedia(tweet) {
  return (tweet.media || []).filter((item) => item.type === "video" && (item.url || item.posterUrl));
}

function playableVideoVariantsForMedia(media) {
  const mediaId = posterMediaId(media.posterUrl);
  const cached = mediaId ? (VIDEO_VARIANT_CACHE.get(mediaId) || []) : [];
  const direct = isPlayableTweetVideoUrl(normalizeTweetVideoUrl(media.url || ""))
    ? [{ url: media.url, bitrate: videoQualityScore(media.url), type: "video/mp4" }]
    : [];
  return playableVideoVariants([...(media.variants || []), ...cached, ...direct]);
}

function directPlayableVideoUrls(tweet) {
  return unique(videoMedia(tweet).map((item) => normalizeTweetVideoUrl(item.url)).filter(isPlayableTweetVideoUrl));
}

function bestCachedVideoUrlForTweet(tweet) {
  const mediaIds = videoMedia(tweet).map((item) => posterMediaId(item.posterUrl)).filter(Boolean);
  for (const mediaId of mediaIds) {
    const cached = VIDEO_VARIANT_CACHE.get(mediaId);
    if (cached?.length) return cached[0].url;
  }
  return "";
}
