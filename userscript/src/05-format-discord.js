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

function authorLabel(tweet) {
  const displayName = String(tweet.author?.displayName || "").trim();
  const username = String(tweet.author?.username || "").trim();
  const handle = username ? `@${username}` : "";
  if (displayName && handle) return `${displayName} (${handle})`;
  return displayName || handle || "Unknown author";
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

function mediaUrlIdentity(url) {
  return isTweetImageMediaUrl(url) ? (tweetImageMediaKey(url) || url) : url;
}

function tweetHasEmbedImageMedia(tweet) {
  return imageMedia(tweet).length > 0;
}

function needsMediaPostPrefix(rootTweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return false;
  return tweetHasEmbedImageMedia(rootTweet) && tweetHasEmbedImageMedia(rootTweet.quote);
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

function embedAuthorBlock(tweet, name, url) {
  const block = { name: truncate(name, DISCORD_EMBED_LIMITS.authorName) };
  const iconUrl = tweetAuthorAvatarUrl(tweet);
  if (iconUrl) block.icon_url = iconUrl;
  if (url) block.url = url;
  return block;
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

function formatQuoteFieldValue(text, limit) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return truncate(trimmed.split("\n").map((line) => `> ${line}`).join("\n"), limit);
}

function buildInlineQuoteFields(quote) {
  const link = quote.url ? `[View quoted post](${quote.url})` : "";
  const room = DISCORD_EMBED_LIMITS.fieldValue - (link ? link.length + 1 : 0);
  const value = [formatQuoteFieldValue(quote.text, room), link].filter(Boolean).join("\n");
  if (!value) return [];

  return [{
    name: truncate(`Quoting ${authorLabel(quote)}`, DISCORD_EMBED_LIMITS.fieldName),
    value,
    inline: false
  }];
}

function shareContentLine(tweet) {
  return tweet.url ? truncate(`-# [Open on X](${tweet.url})`, DISCORD_LIMITS.content) : undefined;
}

function cardPhotoUrls(post, alreadyShown = []) {
  const seen = new Set(alreadyShown.map(mediaUrlIdentity));
  const urls = [];
  for (const { url } of imageMedia(post)) {
    const identity = mediaUrlIdentity(url);
    if (!isValidEmbedImageUrl(url) || seen.has(identity)) continue;
    seen.add(identity);
    urls.push(url);
  }
  return urls;
}

function postCard(post, kind, { images, fields = [] }) {
  const isQuote = kind === "quote";
  const label = authorLabel(post);
  const profileUrl = post.author?.username ? `https://x.com/${post.author.username}` : undefined;
  const text = String(post.text || "").trim();
  return {
    color: isQuote ? EMBED_COLOR_QUOTE : EMBED_COLOR_MAIN,
    // A quote card has no other visible link to the quoted post, so its author name opens it.
    author: isQuote ? embedAuthorBlock(post, `Quoting ${label}`, post.url) : embedAuthorBlock(post, label, profileUrl),
    text: text || (images.length || mediaLinks(post).length ? "" : "(No text found)"),
    fields,
    images,
    date: discordEmbedTimestamp(post.createdAt),
    footer: { text: "X" },
    url: post.url || ""
  };
}

function shareCards(tweet, shareOptions = {}) {
  const images = cardPhotoUrls(tweet);
  if (shareOptions.includeQuote === false || !hasQuoteTweet(tweet)) return [postCard(tweet, "main", { images })];

  const quoteImages = cardPhotoUrls(tweet.quote, images);
  // In one card a quote's photos would read as the main post's, so a quote with photos gets its own.
  if (quoteImages.length) {
    return [postCard(tweet, "main", { images }), postCard(tweet.quote, "quote", { images: quoteImages })];
  }
  return [postCard(tweet, "main", { images, fields: buildInlineQuoteFields(tweet.quote) })];
}

function cardEmbeds(card) {
  const chunks = splitText(card.text, DISCORD_EMBED_LIMITS.description);
  const descriptions = chunks.length ? chunks : [undefined];
  const last = descriptions.length - 1;
  const [hero, ...gallery] = card.images;
  const textEmbeds = descriptions.map((description, index) =>
    pruneEmbed({
      color: card.color,
      author: index === 0 ? card.author : undefined,
      title: index === 0 ? undefined : truncate(`Continued (${index + 1}/${descriptions.length})`, DISCORD_EMBED_LIMITS.title),
      description,
      url: index === 0 ? card.url : undefined,
      image: index === 0 && hero ? { url: hero } : undefined,
      fields: index === last && card.fields.length ? card.fields : undefined,
      timestamp: index === last ? card.date : undefined,
      footer: index === last ? card.footer : undefined
    })
  );
  const [first, ...rest] = textEmbeds;
  // Discord merges embeds that share the first one's url into a grid of up to four images inside it.
  const photos = gallery.map((url) => pruneEmbed({ color: card.color, url: card.url, image: { url } }));
  return [first, ...photos, ...rest];
}

// Files upload with the first message, so only its embeds can show them. A photo packed into a
// later message links its source instead, and its file stays off the first message so Discord
// does not show it there as well.
function assignUploads(messages, attachments) {
  const fileFor = (url) => url && attachments.find((file) => mediaUrlIdentity(file.sourceUrl) === mediaUrlIdentity(url));
  const [first, ...later] = messages;
  const linkedLater = new Set(later.flat().map((embed) => fileFor(embed.image?.url)).filter(Boolean));
  const firstWithUploads = first.map((embed) => {
    const file = fileFor(embed.image?.url);
    return file ? { ...embed, image: { url: `attachment://${file.filename}` } } : embed;
  });
  return {
    messages: [firstWithUploads, ...later],
    files: attachments.filter((file) => !linkedLater.has(file)).map((file) => file.filename)
  };
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
  if (options.files?.length) payload._files = options.files;
  return payload;
}

function buildVideoFollowUpContent(entries) {
  if (!entries.length) return undefined;
  if (entries.length === 1) return truncate(entries[0].url, DISCORD_LIMITS.content);

  const blocks = entries.map((entry) => `-# ${entry.caption}\n${entry.url}`);
  return truncate(blocks.join("\n"), DISCORD_LIMITS.content);
}

function buildEmbedDiscordPayloads(tweet, options = {}) {
  const allVideoEntries = collectShareVideoEntries(tweet, options);
  const fallbackVideoUrlSet = new Set(options.fallbackVideoUrls ?? allVideoEntries.map((entry) => entry.url));
  const videoEntries = allVideoEntries.filter((entry) => fallbackVideoUrlSet.has(entry.url));
  const packed = packEmbedsIntoMessages(shareCards(tweet, options).flatMap(cardEmbeds));
  const { messages: groups, files } = assignUploads(packed, options.attachments || []);

  const messages = groups.map((group, index) =>
    buildWebhookPayload(group, tweet, {
      content: index === 0 ? shareContentLine(tweet) : undefined,
      messageLabel: groups.length > 1 ? `Tweet embeds ${index + 1}/${groups.length}` : undefined,
      files: index === 0 ? files : undefined
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
  for (const item of mediaLinks(tweet, options)) lines.push(formatMediaLinkPlain(item));
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
  const files = (options.attachments || []).map((file) => file.filename);

  return parts.map((content, index) => ({
    username: webhookSenderName(),
    avatar_url: webhookSenderAvatarUrl(),
    content: truncate(content, DISCORD_LIMITS.content),
    allowed_mentions: { parse: [] },
    ...(index === 0 && files.length ? { _files: files } : {})
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
    const splitAt = textBreakBefore(remaining, limit);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// A break in the first half would leave a short chunk, so only breaks past the middle count.
function textBreakBefore(text, limit) {
  const sentenceEnds = [...text.slice(0, limit + 1).matchAll(/[.!?](?=\s)/g)].map((match) => match.index + 1);
  const breaks = [text.lastIndexOf("\n\n", limit), text.lastIndexOf("\n", limit), sentenceEnds.at(-1) ?? -1, text.lastIndexOf(" ", limit)];
  return breaks.find((index) => index >= Math.floor(limit * 0.5)) ?? limit;
}
