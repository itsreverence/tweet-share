// ==UserScript==
// @name         Tweet Discord Share
// @namespace    local.tweet-discord-share
// @version      0.1.0
// @description  Share X/Twitter posts to selected Discord channels through a local relay.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      discord.com
// @connect      cdn.syndication.twimg.com
// ==/UserScript==

(function () {
  "use strict";

  const DIRECT_DESTINATIONS = [
    // Add your Discord webhooks here:
    // { id: "friends", label: "Friends server - tweets", webhookUrl: "https://discord.com/api/webhooks/..." },
    // { id: "personal", label: "Personal server - links", webhookUrl: "https://discord.com/api/webhooks/..." }
  ];
  const MEDIA_LINK_STYLE = "preview"; // "preview" keeps raw URLs playable; "masked" uses Markdown links.
  const DEBUG_MEDIA_EXTRACTION = false;
  const DEBUG_QUOTE_EXTRACTION = false;
  const BUTTON_CLASS = "tds-share-button";
  const STATUS_CLASS = "tds-status";
  const DESTINATION_KEY = "tds-last-destination";
  const VIDEO_VARIANT_CACHE = new Map();
  const TWEET_CACHE = new Map();
  const USER_CACHE = new Map();

  installNetworkCapture();

  const style = document.createElement("style");
  style.textContent = `
    .${BUTTON_CLASS} {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: rgb(83, 100, 113);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      gap: 6px;
      min-height: 34px;
      padding: 0 10px;
    }
    .${BUTTON_CLASS}:hover {
      background: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
    }
    .${BUTTON_CLASS}[disabled] {
      cursor: wait;
      opacity: 0.7;
    }
    .${STATUS_CLASS} {
      color: rgb(83, 100, 113);
      font-size: 13px;
      margin-left: 6px;
    }
  `;
  appendWhenReady(style);

  function appendWhenReady(node) {
    if (document.documentElement) {
      document.documentElement.append(node);
      return;
    }

    document.addEventListener("DOMContentLoaded", () => document.documentElement.append(node), { once: true });
  }

  const DISCORD_LIMITS = {
    content: 2000
  };
  const MESSAGE_CHUNK_LIMIT = 1900;
  const WEBHOOK_SEND_DELAY_MS = 750;

  function request(method, url, body) {
    return new Promise((resolve, reject) => {
      const xhr = typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest : GM_xmlhttpRequest;
      xhr({
        method,
        url,
        headers: { "content-type": "application/json" },
        data: body ? JSON.stringify(body) : undefined,
        onload(response) {
          const text = response.responseText || "{}";
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }

          if (response.status >= 200 && response.status < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `Relay returned ${response.status}`));
          }
        },
        onerror() {
          reject(new Error("Could not reach the local relay."));
        }
      });
    });
  }

  async function getDestinations() {
    return DIRECT_DESTINATIONS.map(({ id, label }) => ({ id, label }));
  }

  function truncate(value, limit) {
    const textValue = String(value || "").trim();
    if (textValue.length <= limit) return textValue;
    return `${textValue.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function formatAuthor(tweet) {
    const author = tweet.author?.displayName || tweet.author?.username || "Unknown author";
    const username = tweet.author?.username ? `@${tweet.author.username}` : "";
    return [author, username].filter(Boolean).join(" ");
  }

  function webhookUsername(tweet) {
    return truncate(tweet.author?.displayName || tweet.author?.username || "Tweet Share", 80);
  }

  function webhookAvatarUrl(tweet) {
    return highResolutionProfileImageUrl(tweet.author?.avatarUrl) || undefined;
  }

  function highResolutionProfileImageUrl(url) {
    return (url || "").replace(/_normal(\.(?:jpg|jpeg|png|webp))(?:\?|$)/i, "$1");
  }

  function imageMedia(tweet) {
    return (tweet.media || []).filter((item) => item.type === "image" && item.url && !isTweetVideoThumbnailUrl(item.url));
  }

  function videoMedia(tweet) {
    return (tweet.media || []).filter((item) => item.type === "video" && (item.url || item.posterUrl));
  }

  function directPlayableVideoUrls(tweet) {
    return unique(videoMedia(tweet).map((item) => normalizeTweetVideoUrl(item.url)).filter(isPlayableTweetVideoUrl));
  }

  function posterMediaId(url) {
    return (url || "").match(/\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d+)\//)?.[1] || "";
  }

  function cacheVideoVariants(mediaId, variants) {
    if (!mediaId || !Array.isArray(variants)) return;
    const mp4s = variants
      .map((variant) => ({
        url: normalizeTweetVideoUrl(variant.url || variant.src || ""),
        bitrate: variant.bitrate || 0,
        type: variant.content_type || variant.type || ""
      }))
      .filter((variant) => variant.type === "video/mp4" && isPlayableTweetVideoUrl(variant.url))
      .sort((left, right) => (right.bitrate || videoQualityScore(right.url)) - (left.bitrate || videoQualityScore(left.url)));

    if (mp4s.length > 0) {
      VIDEO_VARIANT_CACHE.set(mediaId, mp4s);
    }
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

  function looksLikeTweetResult(node) {
    return Boolean(
      (node.rest_id || node.id_str) &&
      (node.legacy?.full_text || node.full_text || node.text) &&
      (node.core?.user_results?.result || node.user || node.author)
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

    if (id) USER_CACHE.set(id, user);
    if (user.username) USER_CACHE.set(user.username, user);
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
  }

  function mediaFromLegacyTweet(legacy) {
    const media = legacy.extended_entities?.media || legacy.entities?.media || [];
    return uniqueMedia(media.flatMap((item) => {
      if (item.type === "photo") {
        return [{ type: "image", url: item.media_url_https || item.media_url || "", alt: item.ext_alt_text || "" }];
      }

      if (item.video_info?.variants) {
        const bestVideo = item.video_info.variants
          .map((variant) => ({
            url: normalizeTweetVideoUrl(variant.url || ""),
            bitrate: variant.bitrate || 0,
            type: variant.content_type || ""
          }))
          .filter((variant) => variant.type === "video/mp4" && isPlayableTweetVideoUrl(variant.url))
          .sort((left, right) => (right.bitrate || videoQualityScore(right.url)) - (left.bitrate || videoQualityScore(left.url)))[0];

        return [{
          type: "video",
          url: bestVideo?.url || "",
          posterUrl: item.media_url_https || item.media_url || "",
          alt: item.ext_alt_text || ""
        }];
      }

      return [];
    }));
  }

  function installNetworkCapture() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const url = String(args[0]?.url || args[0] || "");
        if (/\/graphql\/|\/i\/api\/graphql\/|TweetDetail|UserTweets|HomeTimeline|SearchTimeline/i.test(url)) {
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
        if (!/\/graphql\/|\/i\/api\/graphql\/|TweetDetail|UserTweets|HomeTimeline|SearchTimeline/i.test(this.__tdsUrl || "")) return;
        try {
          scanForVideoVariants(JSON.parse(this.responseText));
        } catch {}
      });
      return originalSend.apply(this, args);
    };
  }

  function mediaLinks(tweet) {
    const videos = directPlayableVideoUrls(tweet).map((url, index) => ({
      label: `Video ${index + 1}`,
      url
    }));
    const images = imageMedia(tweet).map((item, index) => ({
      label: `Image ${index + 1}`,
      url: item.url
    }));

    return uniqueMediaLinks([...videos, ...images]);
  }

  function uniqueMediaLinks(items) {
    return items.filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index);
  }

  function formatMediaLink(item) {
    if (MEDIA_LINK_STYLE === "masked") {
      return `[${item.label}](${item.url})`;
    }

    return `**${item.label}**\n${item.url}`;
  }

  function plainTweetParts(tweet, label = "Tweet") {
    return {
      heading: label ? `**${label}**` : "",
      text: tweet.text || "",
      media: mediaLinks(tweet).map(formatMediaLink)
    };
  }

  function formatPlainTweet(tweet, label = "Tweet") {
    const parts = plainTweetParts(tweet, label);
    const lines = [
      parts.heading,
      parts.text,
      ...parts.media
    ].filter(Boolean);

    return lines.join("\n");
  }

  function hasQuoteTweet(tweet) {
    if (!tweet?.quote) return false;
    const quote = tweet.quote;
    const distinctUrl = hasQuoteCandidate(tweet);
    return Boolean((distinctUrl || quote.text || mediaLinks(quote).length > 0) && (quote.text || mediaLinks(quote).length > 0));
  }

  function hasQuoteCandidate(tweet) {
    if (!tweet?.quote?.url) return false;
    return tweetIdFromUrl(tweet.quote.url) && tweetIdFromUrl(tweet.quote.url) !== tweetIdFromUrl(tweet.url);
  }

  function buildDiscordPayload(content, tweet) {
    return {
      username: webhookUsername(tweet),
      avatar_url: webhookAvatarUrl(tweet),
      content: truncate(content, DISCORD_LIMITS.content),
      allowed_mentions: { parse: [] }
    };
  }

  function buildDiscordPayloads(tweet) {
    const payloads = buildPayloadsForTweet(tweet, "Tweet");
    if (hasQuoteTweet(tweet)) {
      payloads.push(...buildPayloadsForTweet(tweet.quote, "Quoted Tweet"));
    }
    return payloads;
  }

  function buildPayloadsForTweet(tweet, label) {
    return splitTweetMessage(tweet, label).map((content) => buildDiscordPayload(content, tweet));
  }

  function splitTweetMessage(tweet, label) {
    const parts = plainTweetParts(tweet, label);
    const prefix = parts.heading ? `${parts.heading}\n` : "";
    const mediaBlock = parts.media.join("\n");
    const textLimit = Math.max(200, MESSAGE_CHUNK_LIMIT - prefix.length);
    const textChunks = splitText(parts.text, textLimit);
    const messages = [];

    if (textChunks.length === 0) {
      const content = [parts.heading, mediaBlock].filter(Boolean).join("\n");
      return content ? [content] : [parts.heading || "(No text found)"];
    }

    textChunks.forEach((chunk, index) => {
      const numberedHeading = textChunks.length > 1 ? `${parts.heading} (${index + 1}/${textChunks.length})` : parts.heading;
      const lines = [numberedHeading, chunk].filter(Boolean);

      if (index === textChunks.length - 1 && mediaBlock) {
        lines.push(mediaBlock);
      }

      messages.push(lines.join("\n"));
    });

    if (mediaBlock && messages[messages.length - 1].length > MESSAGE_CHUNK_LIMIT) {
      const lastText = messages.pop();
      messages.push(lastText.replace(`\n${mediaBlock}`, ""));
      messages.push(...splitMediaMessages(parts.media, parts.heading ? `${parts.heading} media` : "**Media**"));
    }

    return messages;
  }

  function splitMediaMessages(mediaLines, heading) {
    const messages = [];
    let current = heading;

    for (const line of mediaLines) {
      const next = [current, line].filter(Boolean).join("\n");
      if (next.length > MESSAGE_CHUNK_LIMIT && current !== heading) {
        messages.push(current);
        current = [heading, line].filter(Boolean).join("\n");
      } else {
        current = next;
      }
    }

    if (current) messages.push(current);
    return messages;
  }

  function splitText(text, limit) {
    const value = String(text || "").trim();
    if (!value) return [];
    const chunks = [];
    let remaining = value;

    while (remaining.length > limit) {
      let splitAt = Math.max(
        remaining.lastIndexOf("\n\n", limit),
        remaining.lastIndexOf("\n", limit),
        remaining.lastIndexOf(" ", limit)
      );
      if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async function shareToDestination(destinationId, tweet) {
    const destination = DIRECT_DESTINATIONS.find((item) => item.id === destinationId);
    if (!destination?.webhookUrl) {
      throw new Error("That destination is missing a webhook URL.");
    }

    const payloads = buildDiscordPayloads(tweet);
    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      await request("POST", destination.webhookUrl, payload);
      if (index < payloads.length - 1) {
        await delay(WEBHOOK_SEND_DELAY_MS);
      }
    }
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

    const primaryTweetVideo = loadedVideos.find((url) => /\/amplify_video\/|\/ext_tw_video\//.test(url));
    return primaryTweetVideo || "";
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

  function uniqueMedia(items) {
    return items.filter((item, index, all) => {
      const key = item.url || item.posterUrl;
      return key && all.findIndex((candidate) => (candidate.url || candidate.posterUrl) === key) === index;
    });
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

  function bestCachedVideoUrlForTweet(tweet) {
    const mediaIds = videoMedia(tweet).map((item) => posterMediaId(item.posterUrl)).filter(Boolean);
    for (const mediaId of mediaIds) {
      const cached = VIDEO_VARIANT_CACHE.get(mediaId);
      if (cached?.length) return cached[0].url;
    }
    return "";
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

  function normalizeTextForMatch(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function tweetUrlFromArticle(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')];
    const statusLink = links.find((link) => /\/[^/]+\/status\/\d+/.test(link.getAttribute("href") || ""));
    return statusLink ? normalizeTweetUrl(statusLink.href) : normalizeTweetUrl(location.href);
  }

  function statusLinksFromArticle(article) {
    return [...article.querySelectorAll('a[href*="/status/"]')]
      .map((link) => normalizeTweetUrl(link.href))
      .filter((url, index, all) => /\/status\/\d+/.test(url) && all.indexOf(url) === index);
  }

  function extractAuthor(article) {
    const userNameBlock = article.querySelector('[data-testid="User-Name"]');
    const avatar = article.querySelector('[data-testid^="UserAvatar-Container"] img, img[src*="profile_images"]');
    const usernameText = [...(userNameBlock || article).querySelectorAll("span")]
      .map((span) => span.textContent?.trim() || "")
      .find((value) => /^@[\w_]+$/.test(value)) || "";
    const profileLink = [...(userNameBlock || article).querySelectorAll('a[href^="/"]')]
      .map((link) => link.getAttribute("href") || "")
      .find((href) => /^\/[^/]+$/.test(href));
    const username = usernameText.slice(1) || profileLink?.slice(1) || "";
    const displayName = text(userNameBlock || article, 'a[href^="/"] div[dir="ltr"] span')
      || [...(userNameBlock || article).querySelectorAll("span")]
        .map((span) => span.textContent?.trim() || "")
        .find((value) => value && value !== usernameText && !/^@/.test(value)) || "";

    return {
      displayName,
      username,
      avatarUrl: highResolutionProfileImageUrl(avatar?.src || "")
    };
  }

  function extractText(article, excludedNodes = []) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')]
      .filter((node) => !isInsideExcludedNode(node, excludedNodes))
      .map((node) => node.innerText.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function isInsideExcludedNode(node, excludedNodes = []) {
    return excludedNodes.some((excludedNode) => excludedNode && excludedNode !== node && excludedNode.contains(node));
  }

  function extractMedia(article, excludedNodes = []) {
    const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .filter((img) => !isInsideExcludedNode(img, excludedNodes))
      .filter((img) => !isTweetVideoThumbnailUrl(img.src))
      .map((img) => ({ type: "image", url: img.src, alt: img.alt || "" }));

    const videos = [...article.querySelectorAll('video')]
      .filter((video) => !isInsideExcludedNode(video, excludedNodes))
      .map((video) => ({
        type: "video",
        url: nearestPlayableVideoUrl(video),
        posterUrl: isTweetVideoPosterUrl(video.poster) ? video.poster : "",
        alt: ""
      }));

    return uniqueMedia([...images, ...videos]);
  }

  function extractTimestamp(article) {
    return article.querySelector("time")?.getAttribute("datetime") || "";
  }

  function extractQuote(article) {
    const mainUrl = tweetUrlFromArticle(article);
    const statusLinks = statusLinksFromArticle(article);
    const quotedLink = statusLinks.find((href) => href !== mainUrl && tweetIdFromUrl(href) !== tweetIdFromUrl(mainUrl));

    const quoteCandidates = [
      ...article.querySelectorAll('[role="link"]'),
      ...article.querySelectorAll('[data-testid="card.wrapper"]')
    ];
    const quotedContainer = quoteCandidates.find((node) => {
      const links = statusLinksFromArticle(node);
      const hasDistinctStatus = links.some((href) => href !== mainUrl && tweetIdFromUrl(href) !== tweetIdFromUrl(mainUrl));
      return hasDistinctStatus || (node.querySelector('[data-testid="tweetText"]') && node !== article);
    });

    if (!quotedContainer && !quotedLink) return null;

    const quote = {
      url: quotedLink ? normalizeTweetUrl(quotedLink) : "",
      author: extractAuthor(quotedContainer || article),
      text: quotedContainer ? extractText(quotedContainer) : "",
      media: quotedContainer ? extractMedia(quotedContainer) : [],
      createdAt: extractTimestamp(quotedContainer || article),
      container: quotedContainer || null
    };

    const cachedQuote = quote.url ? TWEET_CACHE.get(tweetIdFromUrl(quote.url)) : bestCachedTweetForQuote(quote, tweetIdFromUrl(mainUrl));
    if (cachedQuote) {
      quote.url = cachedQuote.url || quote.url;
      quote.author = mergeAuthor(cachedQuote.author, quote.author);
      quote.text = cachedQuote.text || quote.text;
      quote.media = cachedQuote.media?.length ? cachedQuote.media : quote.media;
      quote.createdAt = cachedQuote.createdAt || quote.createdAt;
    }

    if (DEBUG_QUOTE_EXTRACTION) {
      console.group("Tweet Discord Share quote debug");
      console.log("mainUrl", mainUrl);
      console.log("statusLinks", statusLinks);
      console.log("quotedLink", quotedLink);
        console.log("quotedContainer", quotedContainer);
        console.log("cachedQuote", cachedQuote);
        console.log("tweetCache", Object.fromEntries(TWEET_CACHE));
        console.log("userCache", Object.fromEntries(USER_CACHE));
        console.groupEnd();
      }

    if (!quote.url && !quote.text && quote.media.length === 0) return null;
    if (quote.url && quote.url === mainUrl && !quote.text && quote.media.length === 0) return null;

    return quote;
  }

  function mergeAuthor(primary = {}, fallback = {}) {
    return {
      displayName: primary.displayName || fallback.displayName || "",
      username: primary.username || fallback.username || "",
      avatarUrl: primary.avatarUrl || fallback.avatarUrl || ""
    };
  }

  function extractTweet(article) {
    const quote = extractQuote(article);
    const excludedMediaNodes = quote?.container ? [quote.container] : [];

    if (quote) {
      delete quote.container;
    }

    return {
      url: tweetUrlFromArticle(article),
      author: extractAuthor(article),
      text: extractText(article, excludedMediaNodes),
      media: extractMedia(article, excludedMediaNodes),
      createdAt: extractTimestamp(article),
      quote
    };
  }

  function setStatus(container, message) {
    let status = container.querySelector(`.${STATUS_CLASS}`);
    if (!status) {
      status = document.createElement("span");
      status.className = STATUS_CLASS;
      container.append(status);
    }
    status.textContent = message;
    window.setTimeout(() => status.remove(), 3500);
  }

  async function chooseDestination() {
    const destinations = await getDestinations();
    if (destinations.length === 0) {
      throw new Error("No destinations are configured.");
    }

    if (destinations.length === 1) {
      return destinations[0].id;
    }

    const last = localStorage.getItem(DESTINATION_KEY);
    const options = destinations
      .map((destination, index) => `${index + 1}. ${destination.label}${destination.id === last ? " (last)" : ""}`)
      .join("\n");
    const answer = window.prompt(`Send this post to which Discord destination?\n\n${options}`, last || "1");
    if (!answer) return "";

    const byNumber = destinations[Number(answer) - 1];
    const byId = destinations.find((destination) => destination.id === answer);
    const destination = byNumber || byId;
    if (!destination) {
      throw new Error("That destination was not found.");
    }

    localStorage.setItem(DESTINATION_KEY, destination.id);
    return destination.id;
  }

  async function shareTweet(article, button) {
    const actionBar = button.parentElement;
    button.disabled = true;
    setStatus(actionBar, "Preparing...");

    try {
      const destinationId = await chooseDestination();
      if (!destinationId) {
        setStatus(actionBar, "Canceled");
        return;
      }

      const tweet = await enrichTweetMedia(extractTweet(article));
      if (DEBUG_MEDIA_EXTRACTION) {
        console.group("Tweet Discord Share media debug");
        console.log(tweet);
        console.log("Detected direct video URLs", directVideoUrlsFromDocument());
        console.log("Cached video variants", Object.fromEntries(VIDEO_VARIANT_CACHE));
        console.groupEnd();
      }
      await shareToDestination(destinationId, tweet);
      setStatus(actionBar, "Sent");
    } catch (error) {
      console.error(error);
      setStatus(actionBar, error.message);
    } finally {
      button.disabled = false;
    }
  }

  function makeButton(article) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.title = "Share to Discord";
    button.innerHTML = `<span aria-hidden="true">Discord</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      shareTweet(article, button);
    });
    return button;
  }

  function enhanceArticle(article) {
    if (article.querySelector(`.${BUTTON_CLASS}`)) return;

    const actionBar = article.querySelector('[role="group"]');
    if (!actionBar) return;

    actionBar.append(makeButton(article));
  }

  function enhanceTimeline() {
    document.querySelectorAll("article").forEach(enhanceArticle);
  }

  const observer = new MutationObserver(enhanceTimeline);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceTimeline();
})();
