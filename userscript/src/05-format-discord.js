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

function uniqueMediaLinks(items) {
  return items.filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index);
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
  const lines = [parts.heading, parts.text, ...parts.media].filter(Boolean);
  return lines.join("\n");
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
