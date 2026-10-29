function tweetAuthorAvatarUrl(tweet) {
  const url = highResolutionProfileImageUrl(tweet.author?.avatarUrl);
  return isHttpsUrl(url) ? url : undefined;
}

function webhookSenderName() {
  return WEBHOOK_SENDER_NAME;
}

// Discord renders markdown in message content and field names, so a name placed there must not pass as a link,
// subtext, or emphasis, and a bare URL in it must not autolink, which escaping its colon prevents. Embed author names
// and titles render no markdown, so they keep the name as written.
function escapeMarkdown(value) {
  return value.replace(/[\\*_~|`[\]()>#:]/g, "\\$&");
}

function authorLabel(post, format = (value) => value) {
  const displayName = format(String(post.author?.displayName || "").trim());
  const username = String(post.author?.username || "").trim();
  const handle = username ? format(`@${username}`) : "";
  if (displayName && handle) return `${displayName} (${handle})`;
  return displayName || handle || "Unknown author";
}

function webhookSenderAvatarUrl() {
  return WEBHOOK_SENDER_AVATAR_URL;
}

// Size variants of one photo share its twimg media ID, so they count as one item.
function mediaUrlIdentity(url) {
  return isTweetImageMediaUrl(url) ? (tweetImageMediaKey(url) || url) : url;
}

function distinctMedia(items, urlOf) {
  const seen = new Set();
  return items.filter((item) => {
    const url = urlOf(item);
    const identity = mediaUrlIdentity(url);
    if (!url || seen.has(identity)) return false;
    seen.add(identity);
    return true;
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

function mediaCaption(kind, postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  const label = kind === "video" ? `Video ${index + 1}` : `Image ${index + 1}`;
  if (!needsMediaPostPrefix(rootTweet, shareOptions)) return label;
  return `${authorLabel(postTweet, escapeMarkdown)} · ${label}`;
}

function videoCaption(postTweet, index, shareOptions = {}, rootTweet = postTweet) {
  const includeQuote = shareOptions.includeQuote !== false;
  const label = `Video ${index + 1}`;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return label;
  const bothPostsHaveVideo = directPlayableVideoUrls(rootTweet).length > 0 && directPlayableVideoUrls(rootTweet.quote).length > 0;
  return bothPostsHaveVideo || needsMediaPostPrefix(rootTweet, shareOptions) ? `${authorLabel(postTweet, escapeMarkdown)} · ${label}` : label;
}

function mediaLinks(tweet, shareOptions = {}) {
  const videos = directPlayableVideoUrls(tweet).map((url, index) => ({
    kind: "video",
    label: videoCaption(tweet, index, shareOptions),
    url
  }));
  const images = imageMedia(tweet).map((item, index) => ({
    kind: "image",
    label: mediaCaption("image", tweet, index, shareOptions),
    url: item.url
  }));

  return distinctMedia([...videos, ...images], (item) => item.url);
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

  return distinctMedia(urls, (url) => url);
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
    name: truncate(`Quoting ${authorLabel(quote, escapeMarkdown)}`, DISCORD_EMBED_LIMITS.fieldName),
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

const GRID_PHOTOS = 4;

// Discord merges the embeds of a message that share a url into one grid of up to four images, so every grid in a
// share needs a url of its own. A tag turns one url into another that opens the same post.
function gridUrl(base, tag) {
  return base ? `${base}${base.includes("#") ? "-" : "#"}${tag}` : "";
}

function postCard(post, kind, { images, fields = [], url }) {
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
    url
  };
}

function shareCards(tweet, shareOptions = {}) {
  const url = tweet.url || "";
  if (shareOptions.includeQuote === false || !hasQuoteTweet(tweet)) return [postCard(tweet, "main", { images: cardPhotoUrls(tweet), url })];

  // Extraction can give the main post a photo that belongs to its quote, so the quote keeps every photo of its own and
  // the main card shows the rest. In one card a quote's photos would read as the main post's, so a quote with photos
  // gets its own.
  const quoteImages = cardPhotoUrls(tweet.quote);
  const images = cardPhotoUrls(tweet, quoteImages);
  if (quoteImages.length) {
    const quoteUrl = tweet.quote.url && tweet.quote.url !== url ? tweet.quote.url : gridUrl(url, "quote");
    return [postCard(tweet, "main", { images, url }), postCard(tweet.quote, "quote", { images: quoteImages, url: quoteUrl })];
  }
  return [postCard(tweet, "main", { images, fields: buildInlineQuoteFields(tweet.quote), url })];
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
  const photoEmbed = (url, grid) => pruneEmbed({ color: card.color, url: grid, image: { url } });
  const firstGrid = gallery.slice(0, GRID_PHOTOS - 1).map((url) => photoEmbed(url, card.url));
  const moreGrids = [];
  for (let start = GRID_PHOTOS - 1; start < gallery.length; start += GRID_PHOTOS) {
    const grid = gridUrl(card.url, moreGrids.length + 2);
    moreGrids.push(gallery.slice(start, start + GRID_PHOTOS).map((url) => photoEmbed(url, grid)));
  }
  return [[first, ...firstGrid, ...moreGrids.flat()], ...rest.map((embed) => [embed])];
}

function shareMessages(tweet, options) {
  return packEmbedsIntoMessages(shareCards(tweet, options).flatMap(cardEmbeds));
}

// Files upload with the first message, so only the photos it shows, and every video, are worth downloading. A photo
// packed into a later message links its source instead.
function uploadCandidateUrls(tweet, options = {}) {
  const [first] = shareMessages(tweet, options);
  const shown = new Set(first.map((embed) => embed.image?.url).filter(Boolean).map(mediaUrlIdentity));
  return collectMediaAttachmentUrls(tweet, options).filter((url) => isPlayableTweetVideoUrl(url) || shown.has(mediaUrlIdentity(url)));
}

function assignUploads(messages, attachments) {
  const fileFor = (url) => url && attachments.find((file) => mediaUrlIdentity(file.sourceUrl) === mediaUrlIdentity(url));
  const [first, ...later] = messages;
  const firstWithUploads = first.map((embed) => {
    const file = fileFor(embed.image?.url);
    return file ? { ...embed, image: { url: `attachment://${file.filename}` } } : embed;
  });
  return { messages: [firstWithUploads, ...later], files: attachments.map((file) => file.filename) };
}

// Same-url embeds only merge within one message, so each group of embeds moves to the next message whole.
function packEmbedsIntoMessages(groups) {
  const messages = [];
  let current = [];
  let currentChars = 0;

  for (const group of groups) {
    const groupChars = group.reduce((sum, embed) => sum + countEmbedChars(embed), 0);
    const fitsSlots = current.length + group.length <= DISCORD_EMBED_LIMITS.embedsPerMessage;
    const fitsChars = currentChars + groupChars <= DISCORD_EMBED_LIMITS.totalEmbedChars;

    if (current.length && !(fitsSlots && fitsChars)) {
      messages.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(...group);
    currentChars += groupChars;
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
  const packed = shareMessages(tweet, options);
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
  const lines = [authorLabel(tweet, escapeMarkdown)];

  if (tweet.text) lines.push(tweet.text);
  for (const item of mediaLinks(tweet, options)) lines.push(formatMediaLinkPlain(item));
  if (tweet.url) lines.push(tweet.url);

  if (includeQuote && hasQuoteTweet(tweet)) {
    lines.push("");
    lines.push(`↳ ${authorLabel(tweet.quote, escapeMarkdown)}`);
    if (tweet.quote.text) lines.push(tweet.quote.text);
    for (const item of mediaLinks(tweet.quote)) lines.push(formatMediaLinkPlain(item));
    if (tweet.quote.url) lines.push(tweet.quote.url);
  }

  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n");
}

function buildPlainFallbackPayloads(tweet, options = {}) {
  const body = buildCompactPlainBody(tweet, options);
  const chunks = splitText(body, MESSAGE_CHUNK_LIMIT);
  const parts = chunks.length ? chunks : [body || authorLabel(tweet, escapeMarkdown)];
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
  const quote = tweet?.quote;
  if (!quote) return false;
  return Boolean(hasQuoteCandidate(tweet) || quote.text || mediaLinks(quote).length > 0);
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
