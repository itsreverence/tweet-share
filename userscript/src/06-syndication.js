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
    ...(data?.video?.variants || []),
    ...(data?.mediaDetails || []).flatMap((media) => media.video_info?.variants || [])
  ];

  return bestPlayableVideoVariantUrl(candidates);
}

function syndicationPosterUrl(data) {
  return data?.video?.poster || data?.mediaDetails?.find((media) => media.media_url_https)?.media_url_https || "";
}

function mediaFromSyndication(data) {
  if (!data) return [];

  const photos = (data.photos || []).map((photo) => ({
    type: "image",
    url: highResolutionTweetImageUrl(photo.url || photo.media_url_https || ""),
    alt: photo.alt_text || ""
  }));
  const details = (data.mediaDetails || []).flatMap((media) => {
    if (media.type === "photo" && media.media_url_https) {
      return [{
        type: "image",
        url: highResolutionTweetImageUrl(media.media_url_https),
        alt: media.ext_alt_text || ""
      }];
    }

    if ((media.type === "video" || media.type === "animated_gif") && media.video_info?.variants) {
      const videoUrl = bestPlayableVideoVariantUrl(media.video_info.variants);
      const posterUrl = media.media_url_https || "";
      return videoUrl || posterUrl ? [{ type: "video", url: videoUrl, posterUrl, alt: media.ext_alt_text || "" }] : [];
    }

    return [];
  });
  const topVideoUrl = bestPlayableVideoVariantUrl(data.video?.variants || []);
  const topVideo = topVideoUrl || data.video?.poster
    ? [{ type: "video", url: topVideoUrl, posterUrl: data.video?.poster || "", alt: "" }]
    : [];

  return uniqueMedia([...photos, ...details, ...topVideo]);
}

function sameTweetImage(left, right) {
  const leftKey = tweetImageMediaKey(left.url);
  return leftKey && leftKey === tweetImageMediaKey(right.url);
}

function sameTweetVideo(left, right) {
  const leftPoster = posterMediaId(left.posterUrl);
  return leftPoster && leftPoster === posterMediaId(right.posterUrl);
}

function mergeTweetMedia(primary = [], fallback = [], options = {}) {
  const media = uniqueMedia([...(primary || []), ...(fallback || [])]);
  const images = [];
  const videos = [];

  for (const item of media) {
    if (item.type === "image") {
      const normalized = { ...item, url: highResolutionTweetImageUrl(item.url) };
      const existingIndex = images.findIndex((candidate) => sameTweetImage(candidate, normalized));
      if (existingIndex >= 0) {
        const existing = images[existingIndex];
        images[existingIndex] = {
          ...normalized,
          url: existing.url || normalized.url,
          alt: existing.alt || normalized.alt || ""
        };
      } else {
        images.push(normalized);
      }
      continue;
    }

    if (item.type === "video") {
      const normalized = { ...item, url: normalizeTweetVideoUrl(item.url || "") };
      const existingIndex = videos.findIndex((candidate) => sameTweetVideo(candidate, normalized));
      if (existingIndex >= 0) {
        const existing = videos[existingIndex];
        videos[existingIndex] = {
          ...existing,
          ...normalized,
          url: isPlayableTweetVideoUrl(normalized.url) ? normalized.url : existing.url,
          posterUrl: normalized.posterUrl || existing.posterUrl || "",
          alt: normalized.alt || existing.alt || ""
        };
      } else {
        videos.push(normalized);
      }
    }
  }

  const preferredVideoUrl = normalizeTweetVideoUrl(options.cachedVideoUrl || options.videoUrl || "");
  if (preferredVideoUrl) {
    const target = videos.find((item) => !isPlayableTweetVideoUrl(item.url)) || videos[0];
    if (target) {
      target.url = preferredVideoUrl;
      target.posterUrl = target.posterUrl || options.posterUrl || "";
    } else {
      videos.push({ type: "video", url: preferredVideoUrl, posterUrl: options.posterUrl || "", alt: "" });
    }
  }

  return uniqueMedia([...images, ...videos]);
}

function tweetFromSyndication(data, fallback = {}) {
  if (!data) return fallback;

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
    media: mergeTweetMedia(mediaFromSyndication(data), fallback.media || []),
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
  tweet.media = mergeTweetMedia(data ? mediaFromSyndication(data) : [], tweet.media || [], {
    cachedVideoUrl,
    videoUrl,
    posterUrl
  });

  if (hasQuoteCandidate(tweet)) {
    await enrichTweetMedia(tweet.quote);
  }

  if (!hasQuoteTweet(tweet)) {
    tweet.quote = null;
  }

  return tweet;
}
