function tweetUrlFromArticle(article) {
  const links = [...article.querySelectorAll('a[href*="/status/"]')];
  const statusLinks = links.filter((link) => /\/[^/]+\/status\/\d+/.test(link.getAttribute("href") || ""));
  const pageTweetId = tweetIdFromUrl(location.href);
  const statusLink = statusLinks.find((link) => link.querySelector?.("time"))
    || statusLinks.find((link) => pageTweetId && tweetIdFromUrl(link.href) === pageTweetId)
    || statusLinks[0];
  return statusLink ? normalizeTweetUrl(statusLink.href) : normalizeTweetUrl(location.href);
}

function statusLinksFromArticle(article) {
  const selfHref = article.getAttribute?.("href") || "";
  return [selfHref, ...[...article.querySelectorAll('a[href*="/status/"]')].map((link) => link.href)]
    .filter(Boolean)
    .map((href) => normalizeTweetUrl(href))
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

function normalizeTweetBodyText(value) {
  return String(value || "")
    // X often splits "https://" into its own span; innerText inserts a newline.
    .replace(/(https?:\/\/)\s*\n\s*/gi, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readTweetTextNode(node) {
  if (typeof node.cloneNode === "function") {
    const clone = node.cloneNode(true);
    for (const anchor of clone.querySelectorAll("a")) {
      const compact = String(anchor.textContent || "").replace(/\s+/g, "");
      if (/^https?:\/\//i.test(compact) || /^[\w.-]+\.[a-z]{2,}\//i.test(compact)) {
        anchor.replaceWith(compact);
      }
    }
    return normalizeTweetBodyText(clone.innerText || clone.textContent || "");
  }

  return normalizeTweetBodyText(node.innerText || node.textContent || "");
}

function extractText(article, excludedNodes = []) {
  return [...article.querySelectorAll('[data-testid="tweetText"]')]
    .filter((node) => !isInsideExcludedNode(node, excludedNodes))
    .map(readTweetTextNode)
    .filter(Boolean)
    .join("\n\n");
}

function imageNodePixelSize(img) {
  return Math.max(
    Number(img.naturalWidth || 0),
    Number(img.naturalHeight || 0),
    Number(img.width || 0),
    Number(img.height || 0),
    Number(img.clientWidth || 0),
    Number(img.clientHeight || 0)
  );
}

function isLikelyTweetMediaImageNode(img) {
  if (!isTweetImageMediaUrl(img.src) || isTweetVideoThumbnailUrl(img.src)) return false;
  const size = imageNodePixelSize(img);
  return size === 0 || size >= 96;
}

function extractMedia(article, excludedNodes = []) {
  const photoImages = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
    .filter((img) => !isInsideExcludedNode(img, excludedNodes))
    .filter((img) => isTweetImageMediaUrl(img.src) && !isTweetVideoThumbnailUrl(img.src));
  const fallbackImages = [...article.querySelectorAll('img[src*="pbs.twimg.com/media/"]')]
    .filter((img) => !isInsideExcludedNode(img, excludedNodes))
    .filter((img) => !img.closest?.('[data-testid="tweetPhoto"]'))
    .filter(isLikelyTweetMediaImageNode);
  const images = [...photoImages, ...fallbackImages]
    .map((img) => ({ type: "image", url: highResolutionTweetImageUrl(img.src), alt: img.alt || "" }));
  const videos = [...article.querySelectorAll("video")]
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
  const quotedTweetId = tweetIdFromUrl(quotedLink);

  const quoteCandidates = [
    ...article.querySelectorAll('[role="link"]'),
    ...article.querySelectorAll('[data-testid="card.wrapper"]')
  ];
  const linkedQuoteCandidates = quotedTweetId
    ? quoteCandidates.filter((node) =>
      statusLinksFromArticle(node).some((href) => tweetIdFromUrl(href) === quotedTweetId)
    )
    : [];
  const quotedContainer = linkedQuoteCandidates.find((candidate) =>
    !linkedQuoteCandidates.some((other) =>
      other !== candidate && typeof candidate.contains === "function" && candidate.contains(other)
    )
  ) || quoteCandidates.find((node) => node !== article && node.querySelector('[data-testid="tweetText"]'));

  if (!quotedContainer && !quotedLink) return null;

  const quote = {
    url: quotedLink ? normalizeTweetUrl(quotedLink) : "",
    author: quotedContainer ? extractAuthor(quotedContainer) : { displayName: "", username: "", avatarUrl: "" },
    text: quotedContainer ? extractText(quotedContainer) : "",
    media: quotedContainer ? extractMedia(quotedContainer) : [],
    createdAt: quotedContainer ? extractTimestamp(quotedContainer) : "",
    container: quotedContainer || null
  };

  const cachedQuote = quote.url ? TWEET_CACHE.get(tweetIdFromUrl(quote.url)) : bestCachedTweetForQuote(quote, tweetIdFromUrl(mainUrl));
  if (cachedQuote) {
    quote.url = cachedQuote.url || quote.url;
    quote.author = mergeAuthor(cachedQuote.author, quote.author);
    quote.text = cachedQuote.text || quote.text;
    quote.media = mergeTweetMedia(cachedQuote.media || [], quote.media || []);
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
