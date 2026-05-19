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

function extractMedia(article, excludedNodes = []) {
  const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
    .filter((img) => !isInsideExcludedNode(img, excludedNodes))
    .filter((img) => !isTweetVideoThumbnailUrl(img.src))
    .map((img) => ({ type: "image", url: img.src, alt: img.alt || "" }));

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
