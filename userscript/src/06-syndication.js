async function fetchSyndicationTweet(tweetId) {
  if (!tweetId) return null;
  try {
    return await request("GET", `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`);
  } catch (error) {
    console.debug("Tweet Discord Share syndication lookup failed", error);
    return null;
  }
}

function bestSyndicationVideoUrl(data) {
  const candidates = [
    ...(data?.video?.variants || []).map((variant) => ({
      url: variant.src,
      bitrate: variant.bitrate || 0,
      type: variant.type
    })),
    ...(data?.mediaDetails || []).flatMap((media) => (media.video_info?.variants || []).map((variant) => ({
      url: variant.url,
      bitrate: variant.bitrate || 0,
      type: variant.content_type
    })))
  ];

  return candidates
    .filter((variant) => variant.type === "video/mp4" && isPlayableTweetVideoUrl(variant.url))
    .sort((left, right) => (right.bitrate || videoQualityScore(right.url)) - (left.bitrate || videoQualityScore(left.url)))[0]?.url || "";
}

function syndicationPosterUrl(data) {
  return data?.video?.poster || data?.mediaDetails?.find((media) => media.media_url_https)?.media_url_https || "";
}

function tweetFromSyndication(data, fallback = {}) {
  if (!data) return fallback;

  const photos = (data.photos || []).map((photo) => ({
    type: "image",
    url: photo.url || photo.media_url_https || "",
    alt: photo.alt_text || ""
  }));
  const mediaDetails = (data.mediaDetails || [])
    .filter((media) => media.type === "photo" && media.media_url_https)
    .map((media) => ({ type: "image", url: media.media_url_https, alt: media.ext_alt_text || "" }));
  const videoUrl = normalizeTweetVideoUrl(bestSyndicationVideoUrl(data));
  const posterUrl = syndicationPosterUrl(data);
  const videos = videoUrl || posterUrl ? [{ type: "video", url: videoUrl, posterUrl, alt: "" }] : [];

  return {
    ...fallback,
    url: fallback.url || (data.id_str ? `https://x.com/${data.user?.screen_name || "i"}/status/${data.id_str}` : ""),
    author: {
      displayName: data.user?.name || fallback.author?.displayName || "",
      username: data.user?.screen_name || fallback.author?.username || "",
      avatarUrl: highResolutionProfileImageUrl(data.user?.profile_image_url_https || fallback.author?.avatarUrl || "")
    },
    text: data.text || fallback.text || "",
    createdAt: data.created_at || fallback.createdAt || "",
    media: uniqueMedia([...photos, ...mediaDetails, ...videos, ...(fallback.media || [])]),
    quote: fallback.quote
  };
}

function bestCachedTweetForQuote(quote, mainTweetId = "") {
  const quoteText = normalizeTextForMatch(quote.text);
  const quoteUsername = quote.author?.username || "";
  if (!quoteText && !quoteUsername) return null;

  for (const [id, cachedTweet] of TWEET_CACHE) {
    if (id === mainTweetId) continue;
    const cachedText = normalizeTextForMatch(cachedTweet.text);
    const textMatches = quoteText && (cachedText.includes(quoteText) || quoteText.includes(cachedText));
    const authorMatches = quoteUsername && cachedTweet.author?.username === quoteUsername;

    if ((textMatches && (!quoteUsername || authorMatches)) || (authorMatches && quoteText && cachedText)) {
      return cachedTweet;
    }
  }

  return null;
}

async function enrichTweetMedia(tweet) {
  const data = await fetchSyndicationTweet(tweetIdFromUrl(tweet.url));
  tweet = tweetFromSyndication(data, tweet);
  const videoUrl = normalizeTweetVideoUrl(bestSyndicationVideoUrl(data));
  const posterUrl = syndicationPosterUrl(data);
  const cachedVideoUrl = bestCachedVideoUrlForTweet(tweet);

  if (cachedVideoUrl || videoUrl) {
    const media = tweet.media || [];
    const existingVideo = media.find((item) => item.type === "video");
    if (existingVideo) {
      existingVideo.url = cachedVideoUrl || videoUrl;
      existingVideo.posterUrl = existingVideo.posterUrl || posterUrl;
    } else {
      media.push({ type: "video", url: cachedVideoUrl || videoUrl, posterUrl, alt: "" });
    }
    tweet.media = media;
  }

  if (hasQuoteCandidate(tweet)) {
    await enrichTweetMedia(tweet.quote);
  }

  if (!hasQuoteTweet(tweet)) {
    tweet.quote = null;
  }

  return tweet;
}
