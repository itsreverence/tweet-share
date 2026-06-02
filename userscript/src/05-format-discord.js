function formatAuthor(tweet) {
  const author = tweet.author?.displayName || tweet.author?.username || "Unknown author";
  const username = tweet.author?.username ? `@${tweet.author.username}` : "";
  return [author, username].filter(Boolean).join(" ");
}

function tweetAuthorAvatarUrl(tweet) {
  const url = highResolutionProfileImageUrl(tweet.author?.avatarUrl);
  return isHttpsUrl(url) ? url : undefined;
}

function webhookSenderName() {
  return WEBHOOK_SENDER_NAME;
}

function embedAuthorDisplayName(tweet) {
  const displayName = String(tweet.author?.displayName || "").trim();
  const username = String(tweet.author?.username || "").trim();
  if (displayName) return truncate(displayName, DISCORD_EMBED_LIMITS.authorName);
  if (username) return truncate(`@${username}`, DISCORD_EMBED_LIMITS.authorName);
  return "Unknown author";
}

function webhookSenderAvatarUrl() {
  return WEBHOOK_SENDER_AVATAR_URL;
}

function uniqueMediaLinks(items) {
  return items.filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index);
}

function tweetHasVisualMedia(tweet) {
  return imageMedia(tweet).length > 0 || directPlayableVideoUrls(tweet).length > 0;
}

function needsMediaPostPrefix(rootTweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return false;
  return tweetHasVisualMedia(rootTweet) && tweetHasVisualMedia(rootTweet.quote);
}

function mediaCaption(kind, postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  const label = kind === "video" ? `Video ${index + 1}` : `Image ${index + 1}`;
  if (!needsMediaPostPrefix(rootTweet, shareOptions)) return label;
  return `${embedAuthorDisplayName(postTweet)} · ${label}`;
}

function videoCaption(postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  return mediaCaption("video", postTweet, index, shareOptions, rootTweet);
}

function mediaLinks(tweet, shareOptions = {}) {
  const rootTweet = shareOptions.rootTweet || tweet;
  const videos = directPlayableVideoUrls(tweet).map((url, index) => ({
    kind: "video",
    label: videoCaption(tweet, index, shareOptions, rootTweet),
    url
  }));
  const images = imageMedia(tweet).map((item, index) => ({
    kind: "image",
    label: mediaCaption("image", tweet, index, shareOptions, rootTweet),
    url: item.url
  }));

  return uniqueMediaLinks([...videos, ...images]);
}

function isHttpsUrl(url) {
  return /^https:\/\//i.test(String(url || ""));
}

function embedAuthorBlock(tweet) {
  const block = { name: embedAuthorDisplayName(tweet) };
  const iconUrl = tweetAuthorAvatarUrl(tweet);
  if (isHttpsUrl(iconUrl)) block.icon_url = iconUrl;
  if (tweet.author?.username) block.url = `https://x.com/${tweet.author.username}`;
  return block;
}

function embedFooterForUrl(url) {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return { text: truncate(host, DISCORD_EMBED_LIMITS.footer) };
  } catch {
    return { text: truncate(url, DISCORD_EMBED_LIMITS.footer) };
  }
}

function countEmbedChars(embed) {
  let total = 0;
  if (embed.title) total += embed.title.length;
  if (embed.description) total += embed.description.length;
  if (embed.footer?.text) total += embed.footer.text.length;
  if (embed.author?.name) total += embed.author.name.length;
  for (const field of embed.fields || []) {
    total += (field.name || "").length + (field.value || "").length;
  }
  return total;
}

function pruneEmbed(embed) {
  const next = { ...embed };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  }
  if (next.fields?.length === 0) delete next.fields;
  return next;
}

function buildMediaFields(mediaItems, fieldOptions = {}) {
  if (!mediaItems.length) return [];

  const fields = mediaItems.slice(0, DISCORD_EMBED_LIMITS.fieldsPerEmbed).map((item) => {
    let value;
    if (item.kind === "video" && fieldOptions.videosBelow) {
      value = "Plays below ↓";
    } else if (MEDIA_LINK_STYLE === "masked") {
      value = `[${item.label}](${item.url})`;
    } else {
      value = item.url;
    }
    return {
      name: truncate(item.label, DISCORD_EMBED_LIMITS.fieldName),
      value: truncate(value, DISCORD_EMBED_LIMITS.fieldValue),
      inline: false
    };
  });

  if (mediaItems.length > DISCORD_EMBED_LIMITS.fieldsPerEmbed) {
    fields.push({
      name: "More media",
      value: truncate(`${mediaItems.length - DISCORD_EMBED_LIMITS.fieldsPerEmbed} more attached on X`, DISCORD_EMBED_LIMITS.fieldValue),
      inline: false
    });
  }

  return fields;
}

function pickEmbedImageUrl(mediaItems) {
  const image = mediaItems.find((item) => isHttpsUrl(item.url) && /\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(item.url));
  return image?.url || mediaItems.find((item) => isHttpsUrl(item.url) && /pbs\.twimg\.com/i.test(item.url))?.url || "";
}

function pickEmbedHeroUrl(tweet, mediaItems) {
  const imageHero = pickEmbedImageUrl(mediaItems);
  if (imageHero) return imageHero;

  const poster = videoMedia(tweet).map((item) => item.posterUrl).find((url) => isTweetVideoPosterUrl(url));
  return poster || "";
}

function isImageSupplementEmbed(embed) {
  return Boolean(embed.image?.url && embed.title && !embed.author);
}

function buildMediaHintField(imageSupplementCount, videosBelow) {
  if (imageSupplementCount <= 0) return null;

  const parts = [
    imageSupplementCount === 1 ? "1 more image below" : `${imageSupplementCount} more images below`
  ];
  if (videosBelow) parts.push("then video in next message");

  return {
    name: "More images",
    value: truncate(`${parts.join(", ")} ↓`, DISCORD_EMBED_LIMITS.fieldValue),
    inline: false
  };
}

function appendMediaHintToLastContentEmbed(embeds, imageSupplementCount, videosBelow) {
  const hintField = buildMediaHintField(imageSupplementCount, videosBelow);
  if (!hintField || !embeds.length) return embeds;

  const lastContentEmbed = [...embeds].reverse().find((embed) => embed.author || embed.description);
  if (!lastContentEmbed) return embeds;

  lastContentEmbed.fields = [...(lastContentEmbed.fields || []), hintField];
  return embeds;
}

function buildImageSupplementEmbeds(tweet, mediaItems, heroUrl, kind) {
  const color = kind === "quote" ? EMBED_COLOR_QUOTE : EMBED_COLOR_MAIN;
  const permalink = tweet.url || "";

  return mediaItems
    .filter((item) => item.kind === "image" && item.url && item.url !== heroUrl)
    .map((item) =>
      pruneEmbed({
        color,
        title: truncate(item.label, DISCORD_EMBED_LIMITS.title),
        url: permalink || undefined,
        image: { url: item.url }
      })
    );
}

function assembleTweetEmbedGroup(tweet, kind, shareOptions, contentEmbeds, media, heroImageUrl) {
  const supplements = buildImageSupplementEmbeds(tweet, media, heroImageUrl, kind);
  const withHints = appendMediaHintToLastContentEmbed(
    contentEmbeds,
    supplements.length,
    shareOptions.videosBelow === true
  );
  return [...withHints, ...supplements];
}

function buildTweetEmbedGroup(tweet, kind, shareOptions = {}) {
  const color = kind === "quote" ? EMBED_COLOR_QUOTE : EMBED_COLOR_MAIN;
  const permalink = tweet.url || "";
  const text = String(tweet.text || "").trim();
  const media = mediaLinks(tweet, shareOptions);
  const heroImageUrl = pickEmbedHeroUrl(tweet, media);
  const mediaFields = buildMediaFields(media.filter((item) => item.kind === "video"), {
    videosBelow: shareOptions.videosBelow === true
  });
  const footer = embedFooterForUrl(permalink);
  const descriptionChunks = splitText(text, DISCORD_EMBED_LIMITS.description);
  const contentEmbeds = [];

  if (descriptionChunks.length === 0) {
    contentEmbeds.push(
      pruneEmbed({
        color,
        author: embedAuthorBlock(tweet),
        description: media.length ? undefined : "(No text found)",
        url: permalink || undefined,
        image: heroImageUrl ? { url: heroImageUrl } : undefined,
        fields: mediaFields.length ? mediaFields : undefined,
        footer
      })
    );
    return assembleTweetEmbedGroup(tweet, kind, shareOptions, contentEmbeds, media, heroImageUrl);
  }

  descriptionChunks.forEach((chunk, index) => {
    const isFirst = index === 0;
    const isLast = index === descriptionChunks.length - 1;
    contentEmbeds.push(
      pruneEmbed({
        color,
        author: isFirst ? embedAuthorBlock(tweet) : undefined,
        title:
          descriptionChunks.length > 1 && !isFirst
            ? truncate(`Continued (${index + 1}/${descriptionChunks.length})`, DISCORD_EMBED_LIMITS.title)
            : undefined,
        description: chunk,
        url: isFirst && permalink ? permalink : undefined,
        image: isFirst && heroImageUrl ? { url: heroImageUrl } : undefined,
        fields: isLast && mediaFields.length ? mediaFields : undefined,
        footer: isLast ? footer : undefined
      })
    );
  });

  return assembleTweetEmbedGroup(tweet, kind, shareOptions, contentEmbeds, media, heroImageUrl);
}

function packEmbedsIntoMessages(embeds) {
  const messages = [];
  let current = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const embedChars = countEmbedChars(embed);
    const exceedsCount = current.length > 0 && currentChars + embedChars > DISCORD_EMBED_LIMITS.totalEmbedChars;
    const exceedsSlots = current.length >= DISCORD_EMBED_LIMITS.embedsPerMessage;

    if (exceedsCount || exceedsSlots) {
      messages.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(embed);
    currentChars += embedChars;
  }

  if (current.length) messages.push(current);
  return messages;
}

function collectShareVideoEntries(tweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  const entries = [];

  directPlayableVideoUrls(tweet).forEach((url, index) => {
    entries.push({
      url,
      caption: videoCaption(tweet, index, shareOptions, tweet)
    });
  });

  if (includeQuote && hasQuoteTweet(tweet)) {
    directPlayableVideoUrls(tweet.quote).forEach((url, index) => {
      entries.push({
        url,
        caption: videoCaption(tweet.quote, index, shareOptions, tweet)
      });
    });
  }

  return entries;
}

function buildWebhookPayload(embeds, tweet, options = {}) {
  const payload = {
    username: webhookSenderName(),
    avatar_url: webhookSenderAvatarUrl(),
    allowed_mentions: { parse: [] }
  };
  if (embeds.length) payload.embeds = embeds;
  if (options.content) payload.content = options.content;
  if (options.messageLabel) payload._messageLabel = options.messageLabel;
  return payload;
}

function buildVideoFollowUpContent(entries, context = {}) {
  if (!entries.length) return undefined;

  const { imageSupplementCount = 0 } = context;
  let intro;
  if (imageSupplementCount > 0 && entries.length === 1) {
    intro = "_Video for the posts above (after the extra images):_";
  } else if (imageSupplementCount > 0) {
    intro = "_Videos for the posts above (after the extra images):_";
  } else if (entries.length === 1) {
    intro = "_Video for the post above:_";
  } else {
    intro = "_Videos for the post above:_";
  }

  const blocks = entries.map((entry) => `**${entry.caption}**\n${entry.url}`);
  return truncate([intro, ...blocks].join("\n\n"), DISCORD_LIMITS.content);
}

function buildEmbedDiscordPayloads(tweet, options = {}) {
  const { includeQuote = true } = options;
  const videoEntries = collectShareVideoEntries(tweet, options);
  const shareOptions = { ...options, rootTweet: tweet, videosBelow: videoEntries.length > 0 };
  const embeds = [...buildTweetEmbedGroup(tweet, "main", shareOptions)];

  if (includeQuote && hasQuoteTweet(tweet)) {
    embeds.push(...buildTweetEmbedGroup(tweet.quote, "quote", shareOptions));
  }

  const imageSupplementCount = embeds.filter(isImageSupplementEmbed).length;
  const packed = packEmbedsIntoMessages(embeds);
  if (!packed.length) return [];

  const messages = packed.map((group, index) =>
    buildWebhookPayload(group, tweet, {
      messageLabel: packed.length > 1 ? `Tweet embeds ${index + 1}/${packed.length}` : undefined
    })
  );

  const videoContent = buildVideoFollowUpContent(videoEntries, { imageSupplementCount });
  if (videoContent) {
    // Discord unfurls MP4 links in content, but not when custom embeds are on the same message.
    messages.push(
      buildWebhookPayload([], tweet, {
        content: videoContent,
        messageLabel: "Videos"
      })
    );
  }
  return messages;
}

function formatMediaLinkPlain(item) {
  if (MEDIA_LINK_STYLE === "masked") {
    return `[${item.label}](${item.url})`;
  }

  return `${item.label}: ${item.url}`;
}

function buildCompactPlainBody(tweet, options = {}) {
  const { includeQuote = true } = options;
  const lines = [formatAuthor(tweet)];

  if (tweet.text) lines.push(tweet.text);
  for (const item of mediaLinks(tweet)) lines.push(formatMediaLinkPlain(item));
  if (tweet.url) lines.push(tweet.url);

  if (includeQuote && hasQuoteTweet(tweet)) {
    lines.push("");
    lines.push(`↳ ${formatAuthor(tweet.quote)}`);
    if (tweet.quote.text) lines.push(tweet.quote.text);
    for (const item of mediaLinks(tweet.quote)) lines.push(formatMediaLinkPlain(item));
    if (tweet.quote.url) lines.push(tweet.quote.url);
  }

  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

function buildPlainFallbackPayloads(tweet, options = {}) {
  const body = buildCompactPlainBody(tweet, options);
  const chunks = splitText(body, MESSAGE_CHUNK_LIMIT);
  const parts = chunks.length ? chunks : [body || formatAuthor(tweet)];

  return parts.map((content) => ({
    username: webhookSenderName(),
    avatar_url: webhookSenderAvatarUrl(),
    content: truncate(content, DISCORD_LIMITS.content),
    allowed_mentions: { parse: [] }
  }));
}

function hasQuoteCandidate(tweet) {
  if (!tweet?.quote?.url) return false;
  return tweetIdFromUrl(tweet.quote.url) && tweetIdFromUrl(tweet.quote.url) !== tweetIdFromUrl(tweet.url);
}

function hasQuoteTweet(tweet) {
  if (!tweet?.quote) return false;
  const quote = tweet.quote;
  const distinctUrl = hasQuoteCandidate(tweet);
  return Boolean((distinctUrl || quote.text || mediaLinks(quote).length > 0) && (quote.text || mediaLinks(quote).length > 0));
}

function buildDiscordPayloads(tweet, options = {}) {
  try {
    const embedPayloads = buildEmbedDiscordPayloads(tweet, options);
    if (embedPayloads.length) return embedPayloads;
  } catch (error) {
    console.warn("Tweet Discord Share: embed formatting failed, using plain text", error);
  }

  return buildPlainFallbackPayloads(tweet, options);
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
