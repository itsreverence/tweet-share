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
  return items.filter((item, index, all) => {
    if (!item.url) return false;
    const key = item.kind === "image" ? (tweetImageMediaKey(item.url) || item.url) : item.url;
    return all.findIndex((candidate) => {
      const candidateKey = candidate.kind === "image" ? (tweetImageMediaKey(candidate.url) || candidate.url) : candidate.url;
      return candidateKey === key;
    }) === index;
  });
}

function tweetHasEmbedImageMedia(tweet) {
  return imageMedia(tweet).length > 0;
}

function needsMediaPostPrefix(rootTweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return false;
  return tweetHasEmbedImageMedia(rootTweet) && tweetHasEmbedImageMedia(rootTweet.quote);
}

function resolveQuoteLayout(tweet, shareOptions = {}) {
  const mode = shareOptions.quoteLayout || "auto";
  if (shareOptions.includeQuote === false || !hasQuoteTweet(tweet)) return "none";
  if (mode === "card") return "card";
  if (mode === "inline") return "inline";
  return "inline";
}

function mediaCaption(kind, postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  const label = kind === "video" ? `Video ${index + 1}` : `Image ${index + 1}`;
  if (!needsMediaPostPrefix(rootTweet, shareOptions)) return label;
  return `${embedAuthorDisplayName(postTweet)} · ${label}`;
}

function videoCaption(postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  const includeQuote = shareOptions.includeQuote !== false;
  const label = `Video ${index + 1}`;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return label;
  const bothPostsHaveVideo = directPlayableVideoUrls(rootTweet).length > 0 && directPlayableVideoUrls(rootTweet.quote).length > 0;
  return bothPostsHaveVideo || needsMediaPostPrefix(rootTweet, shareOptions) ? `${embedAuthorDisplayName(postTweet)} · ${label}` : label;
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

function collectMediaAttachmentUrls(tweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  const posts = [tweet];
  if (includeQuote && hasQuoteTweet(tweet)) posts.push(tweet.quote);
  const urls = [];

  for (const post of posts) {
    for (const item of post.media || []) {
      if (item.type === "video") {
        const url = normalizeTweetVideoUrl(item.url);
        if (isPlayableTweetVideoUrl(url)) urls.push(url);
      } else if (item.type === "image" && isTweetImageMediaUrl(item.url) && !isTweetVideoThumbnailUrl(item.url)) {
        urls.push(item.url);
      }
    }
  }

  return urls.filter((url, index, all) => {
    const key = isTweetImageMediaUrl(url) ? (tweetImageMediaKey(url) || url) : url;
    return all.findIndex((candidate) => {
      const candidateKey = isTweetImageMediaUrl(candidate) ? (tweetImageMediaKey(candidate) || candidate) : candidate;
      return candidateKey === key;
    }) === index;
  });
}

function isHttpsUrl(url) {
  return /^https:\/\//i.test(String(url || ""));
}

function isValidEmbedImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "pbs.twimg.com";
  } catch {
    return false;
  }
}

function embedAuthorBlock(tweet) {
  const block = { name: embedAuthorDisplayName(tweet) };
  const iconUrl = tweetAuthorAvatarUrl(tweet);
  if (isHttpsUrl(iconUrl)) block.icon_url = iconUrl;
  if (tweet.author?.username) block.url = `https://x.com/${tweet.author.username}`;
  return block;
}

function tweetSourceLabel(tweet, kind = "main") {
  const parts = [];
  if (kind === "quote") parts.push("Quoted post");

  const url = String(tweet.url || "").trim();
  const hostMatch = /^https?:\/\/([^/]+)/i.exec(url);
  if (hostMatch) parts.push(hostMatch[1].replace(/^www\./, ""));

  return parts.length ? parts.join(" · ") : "x.com";
}

function embedFooterForTweet(tweet, kind = "main") {
  return { text: truncate(tweetSourceLabel(tweet, kind), DISCORD_EMBED_LIMITS.footer) };
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

function rebalanceEmbedFields(embed, maxChars = DISCORD_EMBED_LIMITS.totalEmbedChars) {
  if (countEmbedChars(embed) <= maxChars) return [embed];

  const fields = [...(embed.fields || [])];
  if (!fields.length) return [embed];

  const base = { ...embed };
  delete base.fields;
  const kept = [];
  const spilled = [];

  for (const field of fields) {
    const trial = pruneEmbed({ ...base, fields: [...kept, field] });
    if (countEmbedChars(trial) <= maxChars) {
      kept.push(field);
    } else {
      spilled.push(field);
    }
  }

  const primary = pruneEmbed(kept.length ? { ...embed, fields: kept } : base);
  if (!spilled.length) return [primary];

  const spillEmbeds = [];
  let batch = [];
  for (const field of spilled) {
    const trial = pruneEmbed({ color: embed.color, fields: [...batch, field] });
    if (countEmbedChars(trial) <= maxChars || !batch.length) {
      batch.push(field);
    } else {
      spillEmbeds.push(pruneEmbed({ color: embed.color, fields: batch }));
      batch = [field];
    }
  }
  if (batch.length) spillEmbeds.push(pruneEmbed({ color: embed.color, fields: batch }));

  const parts = [primary, ...spillEmbeds].filter((part) => countEmbedChars(part) > 0);
  return parts.map((part, index) => {
    if (index === 0) return part;
    return pruneEmbed({
      ...part,
      title: truncate(`Continued (${index + 1}/${parts.length})`, DISCORD_EMBED_LIMITS.title)
    });
  });
}

function rebalanceEmbedsForCharBudget(embeds, maxChars = DISCORD_EMBED_LIMITS.totalEmbedChars) {
  return embeds.flatMap((embed) => rebalanceEmbedFields(embed, maxChars));
}

function pruneEmbed(embed) {
  const next = { ...embed };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  }
  if (next.fields?.length === 0) delete next.fields;
  return next;
}

function formatQuoteFieldValue(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return truncate(trimmed.split("\n").map((line) => `> ${line}`).join("\n"), DISCORD_EMBED_LIMITS.fieldValue);
}

function permalinkField(name, url) {
  if (!url) return null;
  return {
    name: truncate(name, DISCORD_EMBED_LIMITS.fieldName),
    value: truncate(url, DISCORD_EMBED_LIMITS.fieldValue),
    inline: false
  };
}

function buildInlineQuoteFields(tweet) {
  const quote = tweet.quote;
  if (!quote) return [];

  const username = quote.author?.username ? `@${quote.author.username}` : "unknown";
  const fields = [];
  const quoteBody = formatQuoteFieldValue(quote.text);
  if (quoteBody) {
    fields.push({
      name: truncate(`Quoted post from ${username}`, DISCORD_EMBED_LIMITS.fieldName),
      value: quoteBody,
      inline: false
    });
  }
  const originalField = permalinkField("Original post", tweet.url);
  if (originalField) fields.push(originalField);
  return fields;
}

function buildShareContentLines(tweet, shareOptions = {}) {
  const lines = [];
  if (tweet.url) lines.push(tweet.url);
  if (resolveQuoteLayout(tweet, shareOptions) !== "none" && tweet.quote?.url) {
    lines.push(`↳ 📑 Quoted post: ${tweet.quote.url}`);
  }
  return lines.length ? truncate(lines.join("\n"), DISCORD_LIMITS.content) : undefined;
}

function pickEmbedImageUrl(mediaItems) {
  const image = mediaItems.find((item) => isValidEmbedImageUrl(item.url));
  return image?.url || "";
}

function pickEmbedHeroUrl(mediaItems) {
  return pickEmbedImageUrl(mediaItems);
}

function buildMediaHintField(imageSupplementCount) {
  if (imageSupplementCount <= 0) return null;

  const text = imageSupplementCount === 1 ? "1 more image below" : `${imageSupplementCount} more images below`;

  return {
    name: "More images",
    value: truncate(`${text} ↓`, DISCORD_EMBED_LIMITS.fieldValue),
    inline: false
  };
}

function appendMediaHintToLastContentEmbed(embeds, imageSupplementCount) {
  const hintField = buildMediaHintField(imageSupplementCount);
  if (!hintField || !embeds.length) return embeds;

  const lastContentEmbed = [...embeds].reverse().find((embed) => embed.author || embed.description);
  if (!lastContentEmbed) return embeds;

  lastContentEmbed.fields = [...(lastContentEmbed.fields || []), hintField];
  return embeds;
}

function buildImageSupplementEmbeds(tweet, mediaItems, heroUrl, kind, shareOptions = {}) {
  const color = kind === "quote" ? EMBED_COLOR_QUOTE : EMBED_COLOR_MAIN;
  const permalink = tweet.url || "";
  const attachmentUrls = shareOptions.attachmentUrls || [];

  return mediaItems
    .filter((item) =>
      item.kind === "image"
      && item.url
      && item.url !== heroUrl
      && !attachmentUrls.includes(item.url)
      && isValidEmbedImageUrl(item.url)
    )
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
  const supplements = buildImageSupplementEmbeds(tweet, media, heroImageUrl, kind, shareOptions);
  const withHints = appendMediaHintToLastContentEmbed(contentEmbeds, supplements.length);
  return [...withHints, ...supplements];
}

function buildTweetEmbedGroup(tweet, kind, shareOptions = {}) {
  const color = kind === "quote" ? EMBED_COLOR_QUOTE : EMBED_COLOR_MAIN;
  const permalink = tweet.url || "";
  const text = String(tweet.text || "").trim();
  const inlineQuote = kind === "main" && shareOptions.quoteLayout === "inline" ? shareOptions.rootTweet?.quote : null;
  const inlineQuoteMedia = inlineQuote ? mediaLinks(inlineQuote, shareOptions).filter((item) => item.kind === "image") : [];
  const media = uniqueMediaLinks([...mediaLinks(tweet, shareOptions), ...inlineQuoteMedia]);
  const attachmentUrls = shareOptions.attachmentUrls || [];
  const visibleMedia = media.filter((item) => !attachmentUrls.includes(item.url));
  const visibleInlineQuoteMedia = inlineQuoteMedia.filter((item) => !attachmentUrls.includes(item.url));
  const heroImageUrl = pickEmbedHeroUrl(visibleMedia)
    || (inlineQuote ? pickEmbedHeroUrl(visibleInlineQuoteMedia) : "");
  const mediaFields = [];
  const inlineQuoteFields = kind === "main" ? (shareOptions.inlineQuoteFields || []) : [];
  const permalinkFields = kind === "quote" ? [permalinkField("Quoted post", permalink)].filter(Boolean) : [];
  const footer = embedFooterForTweet(tweet, kind);
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
        fields: [...mediaFields, ...inlineQuoteFields, ...permalinkFields].length ? [...mediaFields, ...inlineQuoteFields, ...permalinkFields] : undefined,
        timestamp: kind === "main" ? discordEmbedTimestamp(tweet.createdAt) : undefined,
        footer
      })
    );
    return assembleTweetEmbedGroup(
      tweet,
      kind,
      shareOptions,
      rebalanceEmbedsForCharBudget(contentEmbeds),
      media,
      heroImageUrl
    );
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
        fields: isLast && [...mediaFields, ...inlineQuoteFields, ...permalinkFields].length ? [...mediaFields, ...inlineQuoteFields, ...permalinkFields] : undefined,
        timestamp: kind === "main" && isFirst ? discordEmbedTimestamp(tweet.createdAt) : undefined,
        footer: isLast ? footer : undefined
      })
    );
  });

  return assembleTweetEmbedGroup(
    tweet,
    kind,
    shareOptions,
    rebalanceEmbedsForCharBudget(contentEmbeds),
    media,
    heroImageUrl
  );
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

function buildVideoFollowUpContent(entries) {
  if (!entries.length) return undefined;
  if (entries.length === 1) return truncate(`_Video:_\n${entries[0].url}`, DISCORD_LIMITS.content);

  const blocks = entries.map((entry) => `_${entry.caption}:_\n${entry.url}`);
  return truncate(blocks.join("\n\n"), DISCORD_LIMITS.content);
}

function buildEmbedDiscordPayloads(tweet, options = {}) {
  const { includeQuote = true } = options;
  const allVideoEntries = collectShareVideoEntries(tweet, options);
  const attachmentUrls = options.attachmentUrls || [];
  const fallbackVideoUrls = Array.isArray(options.fallbackVideoUrls)
    ? options.fallbackVideoUrls
    : (options.attachMedia === true
      ? allVideoEntries.filter((entry) => !attachmentUrls.includes(entry.url)).map((entry) => entry.url)
      : allVideoEntries.map((entry) => entry.url));
  const fallbackVideoUrlSet = new Set(fallbackVideoUrls);
  const videoEntries = allVideoEntries.filter((entry) => fallbackVideoUrlSet.has(entry.url));
  const quoteLayout = resolveQuoteLayout(tweet, options);
  const shareOptions = {
    ...options,
    attachmentUrls,
    quoteLayout,
    inlineQuoteFields: quoteLayout === "inline" ? buildInlineQuoteFields(tweet) : [],
    rootTweet: tweet
  };
  const embeds = [...buildTweetEmbedGroup(tweet, "main", shareOptions)];

  if (includeQuote && hasQuoteTweet(tweet) && quoteLayout === "card") {
    embeds.push(...buildTweetEmbedGroup(tweet.quote, "quote", shareOptions));
  }

  const packed = packEmbedsIntoMessages(embeds);
  if (!packed.length) return [];

  const messages = packed.map((group, index) =>
    buildWebhookPayload(group, tweet, {
      content: index === 0 ? buildShareContentLines(tweet, shareOptions) : undefined,
      messageLabel: packed.length > 1 ? `Tweet embeds ${index + 1}/${packed.length}` : undefined
    })
  );

  const videoContent = buildVideoFollowUpContent(videoEntries);
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
