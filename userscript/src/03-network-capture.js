function cacheVideoVariants(mediaId, variants) {
  if (!mediaId || !Array.isArray(variants)) return;
  const mp4s = playableVideoVariants(variants);

  if (mp4s.length > 0) {
    VIDEO_VARIANT_CACHE.set(mediaId, mp4s);
    trimCache(VIDEO_VARIANT_CACHE);
  }
}

function looksLikeTweetResult(node) {
  const legacy = node.legacy || node;
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  const userId = legacy.user_id_str || legacy.user_id || node.user_id_str || "";
  return Boolean(
    (node.rest_id || node.id_str) &&
    (legacy.full_text || legacy.text || node.text || media.length > 0) &&
    (node.core?.user_results?.result || node.user || node.author || userId)
  );
}

function looksLikeUserResult(node) {
  return Boolean((node.rest_id || node.id_str) && (node.legacy?.screen_name || node.screen_name || node.username));
}

function cacheUserResult(node) {
  const legacy = node.legacy || node;
  const id = String(node.rest_id || node.id_str || legacy.id_str || "");
  const user = {
    displayName: legacy.name || "",
    username: legacy.screen_name || legacy.username || "",
    avatarUrl: highResolutionProfileImageUrl(legacy.profile_image_url_https || legacy.profile_image_url || "")
  };

  if (id) {
    USER_CACHE.set(id, user);
    trimCache(USER_CACHE);
  }
  if (user.username) {
    USER_CACHE.set(user.username, user);
    trimCache(USER_CACHE);
  }
}

function mediaFromLegacyTweet(legacy) {
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  return uniqueMedia(media.flatMap((item) => {
    if (item.type === "photo") {
      return [{ type: "image", url: item.media_url_https || item.media_url || "", alt: item.ext_alt_text || "" }];
    }

    if (item.video_info?.variants) {
      const bestVideoUrl = bestPlayableVideoVariantUrl(item.video_info.variants);

      return [{
        type: "video",
        url: bestVideoUrl || "",
        posterUrl: item.media_url_https || item.media_url || "",
        alt: item.ext_alt_text || ""
      }];
    }

    return [];
  }));
}

function cacheTweetResult(node) {
  const legacy = node.legacy || node;
  const userResult = node.core?.user_results?.result;
  const userId = legacy.user_id_str || legacy.user_id || node.user_id_str || "";
  const cachedUser = userId ? USER_CACHE.get(String(userId)) : null;
  const userLegacy = userResult?.legacy || node.user || node.author || cachedUser || {};
  const username = userLegacy.screen_name || userLegacy.username || "";
  const id = String(node.rest_id || node.id_str || legacy.id_str || "");
  if (!id) return;

  TWEET_CACHE.set(id, {
    url: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`,
    author: {
      displayName: userLegacy.name || "",
      username,
      avatarUrl: highResolutionProfileImageUrl(userLegacy.profile_image_url_https || userLegacy.profile_image_url || "")
    },
    text: legacy.full_text || legacy.text || node.text || "",
    media: mediaFromLegacyTweet(legacy),
    createdAt: legacy.created_at || ""
  });
  trimCache(TWEET_CACHE);
}

function scanForVideoVariants(value) {
  const seen = new WeakSet();

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const mediaId = node.id_str || node.media_key || node.id;
    if (looksLikeTweetResult(node)) {
      cacheTweetResult(node);
    }
    if (looksLikeUserResult(node)) {
      cacheUserResult(node);
    }
    if (node.video_info?.variants) {
      cacheVideoVariants(String(mediaId || ""), node.video_info.variants);
    }
    if (node.video?.variants && node.video?.poster) {
      cacheVideoVariants(posterMediaId(node.video.poster) || String(mediaId || ""), node.video.variants);
    }
    if (node.media_url_https && node.video_info?.variants) {
      cacheVideoVariants(posterMediaId(node.media_url_https) || String(mediaId || ""), node.video_info.variants);
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    Object.values(node).forEach(visit);
  }

  visit(value);
}

function shouldCaptureApiUrl(url) {
  return /\/graphql\/|\/i\/api\/graphql\/|TweetDetail|UserTweets|HomeTimeline|SearchTimeline/i.test(url);
}

function installNetworkCapture() {
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = String(args[0]?.url || args[0] || "");
      if (shouldCaptureApiUrl(url)) {
        response.clone().json().then(scanForVideoVariants).catch(() => {});
      }
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tdsUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      if (!shouldCaptureApiUrl(this.__tdsUrl || "")) return;
      try {
        scanForVideoVariants(JSON.parse(this.responseText));
      } catch {}
    });
    return originalSend.apply(this, args);
  };
}
