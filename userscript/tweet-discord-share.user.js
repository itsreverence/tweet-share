// ==UserScript==
// @name         Tweet Discord Share
// @namespace    local.tweet-discord-share
// @version      0.1.0
// @description  Share X/Twitter posts to selected Discord channels through a local relay.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      discord.com
// ==/UserScript==

(function () {
  "use strict";

  const DIRECT_DESTINATIONS = [
    // Add your Discord webhooks here:
    // { id: "friends", label: "Friends server - tweets", webhookUrl: "https://discord.com/api/webhooks/..." },
    // { id: "personal", label: "Personal server - links", webhookUrl: "https://discord.com/api/webhooks/..." }
  ];
  const BUTTON_CLASS = "tds-share-button";
  const STATUS_CLASS = "tds-status";
  const DESTINATION_KEY = "tds-last-destination";

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
  document.documentElement.append(style);

  const DISCORD_LIMITS = {
    content: 2000,
    title: 256,
    description: 4096,
    fieldValue: 1024,
    embeds: 10
  };

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

  function buildTweetEmbed(tweet, label) {
    const author = tweet.author?.displayName || tweet.author?.username || "Unknown author";
    const username = tweet.author?.username ? `@${tweet.author.username}` : "";
    const media = Array.isArray(tweet.media) ? tweet.media : [];
    const firstImage = media.find((item) => item.type === "image" && item.url)?.url;
    const videoUrls = media.filter((item) => item.type === "video" && item.url).map((item) => item.url);
    const fields = [];

    if (tweet.createdAt) {
      fields.push({
        name: "Posted",
        value: truncate(tweet.createdAt, DISCORD_LIMITS.fieldValue),
        inline: true
      });
    }

    if (videoUrls.length > 0) {
      fields.push({
        name: "Video",
        value: truncate(unique(videoUrls).join("\n"), DISCORD_LIMITS.fieldValue),
        inline: false
      });
    }

    const embed = {
      title: truncate([author, username].filter(Boolean).join(" "), DISCORD_LIMITS.title),
      url: tweet.url,
      description: truncate(tweet.text || "(No text found)", DISCORD_LIMITS.description),
      color: label === "Quote" ? 0x657786 : 0x1da1f2,
      footer: { text: label },
      fields
    };

    if (firstImage) embed.image = { url: firstImage };
    if (tweet.author?.avatarUrl) embed.thumbnail = { url: tweet.author.avatarUrl };
    return embed;
  }

  function buildDiscordPayload(tweet) {
    const embeds = [buildTweetEmbed(tweet, "Post")];
    if (tweet.quote) embeds.push(buildTweetEmbed(tweet.quote, "Quote"));

    const mediaLinks = unique([
      ...(tweet.media || []).filter((item) => item.url).map((item) => item.url),
      ...((tweet.quote?.media || []).filter((item) => item.url).map((item) => item.url))
    ]);

    const content = [tweet.url, mediaLinks.length > 1 ? mediaLinks.slice(1, 6).join("\n") : ""]
      .filter(Boolean)
      .join("\n");

    return {
      username: "Tweet Share",
      content: truncate(content, DISCORD_LIMITS.content),
      embeds: embeds.slice(0, DISCORD_LIMITS.embeds),
      allowed_mentions: { parse: [] }
    };
  }

  async function shareToDestination(destinationId, tweet) {
    const destination = DIRECT_DESTINATIONS.find((item) => item.id === destinationId);
    if (!destination?.webhookUrl) {
      throw new Error("That destination is missing a webhook URL.");
    }

    return request("POST", destination.webhookUrl, buildDiscordPayload(tweet));
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
    return parsed.toString();
  }

  function tweetUrlFromArticle(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')];
    const statusLink = links.find((link) => /\/[^/]+\/status\/\d+/.test(link.getAttribute("href") || ""));
    return statusLink ? normalizeTweetUrl(statusLink.href) : normalizeTweetUrl(location.href);
  }

  function extractAuthor(article) {
    const userNameBlock = article.querySelector('[data-testid="User-Name"]');
    const avatar = article.querySelector('[data-testid^="UserAvatar-Container"] img, img[src*="profile_images"]');
    const username = text(userNameBlock || article, 'a[href^="/"] span').match(/@[\w_]+/)?.[0]?.slice(1) || "";
    const displayName = text(userNameBlock || article, 'a[href^="/"] div[dir="ltr"] span') || "";

    return {
      displayName,
      username,
      avatarUrl: avatar?.src || ""
    };
  }

  function extractText(article) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')]
      .map((node) => node.innerText.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function extractMedia(article) {
    const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .map((img) => ({ type: "image", url: img.src, alt: img.alt || "" }));

    const videos = [...article.querySelectorAll('video')]
      .map((video) => ({ type: "video", url: video.currentSrc || video.src || video.poster || "", alt: "" }));

    return [...images, ...videos].filter((item, index, all) => {
      return item.url && all.findIndex((candidate) => candidate.url === item.url) === index;
    });
  }

  function extractTimestamp(article) {
    return article.querySelector("time")?.getAttribute("datetime") || "";
  }

  function extractQuote(article) {
    const quotedLink = [...article.querySelectorAll('a[href*="/status/"]')]
      .map((link) => link.href)
      .filter((href) => normalizeTweetUrl(href) !== tweetUrlFromArticle(article))
      .at(-1);

    const quotedContainer = [...article.querySelectorAll('[role="link"]')]
      .find((node) => node.querySelector('[data-testid="tweetText"]') && node.querySelector('a[href*="/status/"]'));

    if (!quotedContainer && !quotedLink) return null;

    return {
      url: quotedLink ? normalizeTweetUrl(quotedLink) : "",
      author: extractAuthor(quotedContainer || article),
      text: quotedContainer ? extractText(quotedContainer) : "",
      media: quotedContainer ? extractMedia(quotedContainer) : [],
      createdAt: extractTimestamp(quotedContainer || article)
    };
  }

  function extractTweet(article) {
    return {
      url: tweetUrlFromArticle(article),
      author: extractAuthor(article),
      text: extractText(article),
      media: extractMedia(article),
      createdAt: extractTimestamp(article),
      quote: extractQuote(article)
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

      const tweet = extractTweet(article);
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
