import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");

function loadFormatContext() {
  const files = ["00-config.js", "02-utils.js", "04-video.js", "05-format-discord.js"];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = {
    console,
    URL,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] }
  };
  runInNewContext(`${code}\nthis.exports = { buildDiscordPayloads, buildPlainFallbackPayloads, discordEmbedTimestamp, packEmbedsIntoMessages, hasQuoteTweet, truncate, uploadCandidateUrls };`, context);
  return context.exports;
}

const { buildDiscordPayloads, buildPlainFallbackPayloads, discordEmbedTimestamp, packEmbedsIntoMessages, hasQuoteTweet, truncate, uploadCandidateUrls } = loadFormatContext();

const sampleTweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice", avatarUrl: "https://pbs.twimg.com/profile_images/a_normal.jpg" },
  text: "Hello world",
  media: [{ type: "image", url: "https://pbs.twimg.com/media/photo.jpg" }]
};

const openOnX = (url) => `-# [Open on X](${url})`;
const viewQuotedPost = (url) => `[View quoted post](${url})`;
const embedImageUrls = (payload) => (payload.embeds || []).flatMap((embed) => embed.image?.url ? [embed.image.url] : []);

const jamieQuoteTweet = {
  url: "https://x.com/JamieBonkiewicz/status/2064816452863988103",
  author: {
    displayName: "Jamie Bonkiewicz",
    username: "JamieBonkiewicz",
    avatarUrl: "https://pbs.twimg.com/profile_images/x.jpg"
  },
  text: "Then why isn't the Strait of Hormuz open?",
  media: [],
  quote: {
    url: "https://x.com/atrupar/status/2064811778433818859",
    author: { displayName: "Aaron Rupar", username: "atrupar" },
    text: 'Hegseth: "The United States of America controls the Strait of Hormuz"',
    media: [{ type: "video", url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/q.mp4" }]
  }
};

test("discordEmbedTimestamp parses ISO and Twitter date strings", () => {
  assert.equal(discordEmbedTimestamp("2026-06-10T21:06:19.000Z"), "2026-06-10T21:06:19.000Z");
  assert.equal(discordEmbedTimestamp("Tue May 26 12:00:00 +0000 2026"), "2026-05-26T12:00:00.000Z");
  assert.equal(discordEmbedTimestamp("not a date"), undefined);
  assert.equal(discordEmbedTimestamp(""), undefined);
});

test("truncate never exceeds Discord field and message limits", () => {
  for (const limit of [0, 1, 2, 3, 256, 1024, 2000, 4096]) {
    const result = truncate("x".repeat(limit + 10), limit);
    assert.ok(result.length <= limit, `${result.length} exceeded ${limit}`);
  }
  assert.equal(truncate("abcdef", 5), "ab...");
  assert.equal(truncate("abc", 3), "abc");
});

test("buildDiscordPayloads returns a single embed message for a simple tweet", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 1);
  assert.match(payloads[0].embeds[0].description, /Hello world/);
  assert.equal(payloads[0].embeds[0].url, sampleTweet.url);
  assert.equal(payloads[0].content, openOnX(sampleTweet.url));
});

test("embed shares always include message content permalink", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeContentPermalink: false });
  assert.equal(payloads[0].content, openOnX(sampleTweet.url));
});

test("main embed includes timestamp when createdAt is parseable", () => {
  const payloads = buildDiscordPayloads({
    ...sampleTweet,
    createdAt: "2026-06-10T21:06:19.000Z"
  }, { includeQuote: false });

  assert.equal(payloads[0].embeds[0].timestamp, "2026-06-10T21:06:19.000Z");
});

test("invalid createdAt omits timestamp", () => {
  const payloads = buildDiscordPayloads({
    ...sampleTweet,
    createdAt: "nope"
  }, { includeQuote: false });

  assert.equal(payloads[0].embeds[0].timestamp, undefined);
});

test("the content is one small link to the post, and the quoted post's link ends its field", () => {
  const tweet = {
    ...sampleTweet,
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      media: []
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads[0].content, openOnX(tweet.url));
  const quoteField = payloads[0].embeds[0].fields.find((field) => field.name === "Quoting Bob (@bob)");
  assert.equal(quoteField.value, `> Quoted text\n${viewQuotedPost(tweet.quote.url)}`);
});

test("a quoted post with only a permalink keeps its View quoted post link", () => {
  const tweet = {
    ...sampleTweet,
    quote: { url: "https://x.com/bob/status/2", author: { displayName: "Bob", username: "bob" }, text: "", media: [] }
  };

  assert.equal(hasQuoteTweet(tweet), true);
  const quoteField = buildDiscordPayloads(tweet)[0].embeds[0].fields.find((field) => field.name === "Quoting Bob (@bob)");
  assert.equal(quoteField.value, viewQuotedPost(tweet.quote.url));
  assert.equal(buildDiscordPayloads(tweet, { includeQuote: false })[0].embeds[0].fields, undefined, "excluding the quote drops the link");
});

test("the plain fallback names each author the way the cards do", () => {
  const tweet = {
    ...sampleTweet,
    media: [],
    quote: { url: "https://x.com/bob/status/2", author: { displayName: "Bob", username: "bob" }, text: "Quoted", media: [] }
  };

  const [payload] = buildPlainFallbackPayloads(tweet);
  assert.deepEqual(payload.content.split("\n"), ["Alice (@alice)", "Hello world", tweet.url, "", "↳ Bob (@bob)", "Quoted", tweet.quote.url]);
  assert.equal(buildPlainFallbackPayloads({ ...tweet, author: { username: "alice" } })[0].content.split("\n")[0], "@alice");
});

test("markdown in an author's name is escaped where Discord renders markdown, and kept as written where it does not", () => {
  const evil = "[Open on X](https://evil.example/x)";
  const escapedEvil = "\\[Open on X\\]\\(https\\://evil.example/x\\)";
  const bob = "_Bob_ *bold* `code` ~s~ |x| > q #h \\";
  const escapedBob = "\\_Bob\\_ \\*bold\\* \\`code\\` \\~s\\~ \\|x\\| \\> q \\#h \\\\";
  const mainVideo = "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/main.mp4";
  const quoteVideo = "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4";
  const tweet = {
    ...sampleTweet,
    author: { displayName: evil, username: "a" },
    media: [{ type: "video", url: mainVideo }, { type: "image", url: "https://pbs.twimg.com/media/m.jpg" }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: bob, username: "b_b" },
      text: "q",
      media: [{ type: "video", url: quoteVideo }, { type: "image", url: "https://pbs.twimg.com/media/q.jpg" }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads[0].embeds[0].author.name, `${evil} (@a)`, "the embed author name is plain text in Discord");
  assert.equal(payloads[1].content, `-# ${escapedEvil} (@a) · Video 1\n${mainVideo}\n-# ${escapedBob} (@b\\_b) · Video 1\n${quoteVideo}`);
  assert.equal(payloads[0].embeds[1].author.name, `Quoting ${bob} (@b_b)`, "the quote card's author name is plain text in Discord");
  const inlineQuote = buildDiscordPayloads({ ...tweet, quote: { ...tweet.quote, media: [] } });
  assert.equal(inlineQuote[0].embeds[0].fields[0].name, `Quoting ${escapedBob} (@b\\_b)`, "the inline quote's field name renders markdown, so it escapes the name");
  const [fallback] = buildPlainFallbackPayloads(tweet);
  assert.equal(fallback.content.split("\n")[0], `${escapedEvil} (@a)`, "the plain fallback is message content, so it escapes the name");
  assert.ok(fallback.content.includes(`\n${escapedEvil} (@a) · Image 1: https://pbs.twimg.com/media/m.jpg\n`), "the fallback's photo caption escapes the name");
  assert.ok(![...payloads, fallback].some((payload) => String(payload.content || "").includes(evil)), "no message content carries the name as a live link");
});

test("webhook sender is branded while the embed shows the tweet author once", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads[0].username, "Tweet Share");
  assert.match(payloads[0].avatar_url, /^https:\/\//);
  assert.equal(payloads[0].embeds[0].author.name, "Alice (@alice)");
  assert.equal(payloads[0].embeds[0].author.url, "https://x.com/alice");
  assert.equal(payloads[0].embeds[0].footer.text, "X");
  assert.match(payloads[0].embeds[0].author.icon_url, /profile_images/);
  assert.equal(payloads[0].embeds.filter((embed) => embed.author).length, 1, "one embed names the author");
});

test("a quote with photos gets its own card in the same message, named and linked as the quoted post", () => {
  const tweet = {
    ...sampleTweet,
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      media: [{ type: "image", url: "https://pbs.twimg.com/media/q1.jpg" }]
    }
  };

  assert.equal(hasQuoteTweet(tweet), true);
  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[0].fields, undefined, "the main card has no quote field");
  const quoteCard = payloads[0].embeds[1];
  assert.equal(quoteCard.color, 0x536471);
  assert.equal(quoteCard.footer.text, "X");
  assert.equal(quoteCard.author.name, "Quoting Bob (@bob)");
  assert.equal(quoteCard.author.url, tweet.quote.url, "the quote card's author name opens the quoted post");
  assert.equal(quoteCard.description, "Quoted text");
  assert.equal(quoteCard.image.url, "https://pbs.twimg.com/media/q1.jpg");
});

test("a quote card shows the quoted post's own date", () => {
  const payloads = buildDiscordPayloads({
    ...sampleTweet,
    createdAt: "2026-06-10T21:06:19.000Z",
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      createdAt: "2026-06-11T10:00:00.000Z",
      media: [{ type: "image", url: "https://pbs.twimg.com/media/q1.jpg" }]
    }
  });

  assert.equal(payloads[0].embeds[0].timestamp, "2026-06-10T21:06:19.000Z");
  assert.equal(payloads[0].embeds[1].timestamp, "2026-06-11T10:00:00.000Z");
});

test("a quote without photos stays inline in the main card, and its video follows as a link", () => {
  const payloads = buildDiscordPayloads(jamieQuoteTweet);
  const firstEmbed = payloads[0].embeds[0];
  const quoteField = firstEmbed.fields.find((field) => field.name === "Quoting Aaron Rupar (@atrupar)");

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds.length, 1);
  assert.equal(payloads[0].content, openOnX(jamieQuoteTweet.url));
  assert.ok(quoteField);
  assert.match(quoteField.value, /^> Hegseth:/);
  assert.ok(quoteField.value.endsWith(`\n${viewQuotedPost(jamieQuoteTweet.quote.url)}`), "the field links the quoted post");
  assert.equal(firstEmbed.fields.some((field) => field.name === "Original post"), false);
  assert.match(payloads[1].content, /q\.mp4/);
});

test("inline quote field stays within Discord's 1024-char field limit for long quoted posts", () => {
  const discordFieldValueLimit = 1024;
  const tweet = {
    ...jamieQuoteTweet,
    quote: { ...jamieQuoteTweet.quote, text: "Long quoted sentence. ".repeat(50) }
  };
  assert.ok(tweet.quote.text.length > 1050, "quoted text is longer than one field");

  const payloads = buildDiscordPayloads(tweet);
  const quoteField = payloads[0].embeds[0].fields.find((field) => field.name === "Quoting Aaron Rupar (@atrupar)");
  assert.ok(quoteField, "inline quote field is present");
  assert.ok(
    quoteField.value.length <= discordFieldValueLimit,
    `quote field is ${quoteField.value.length} chars, Discord allows ${discordFieldValueLimit}`
  );
  const [quoted, link] = quoteField.value.split("\n");
  assert.ok(quoted.endsWith("..."), "truncated quote ends with an ellipsis");
  assert.equal(link, viewQuotedPost(tweet.quote.url), "truncation keeps the link to the quoted post whole");
});

test("each post's photos sit in its own card when both posts have photos", () => {
  const tweet = {
    ...sampleTweet,
    media: [{ type: "image", url: "https://pbs.twimg.com/media/main1.jpg" }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "quote",
      media: [{ type: "image", url: "https://pbs.twimg.com/media/q1.jpg" }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[0].image.url, "https://pbs.twimg.com/media/main1.jpg");
  assert.equal(payloads[0].embeds[0].fields, undefined);
  assert.equal(payloads[0].embeds[1].author.name, "Quoting Bob (@bob)");
  assert.equal(payloads[0].embeds[1].url, tweet.quote.url);
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/q1.jpg");
});

test("a photo quote under a text-only post shows its photo in its own card, not the main post's", () => {
  const tweet = {
    ...sampleTweet,
    media: [],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted image",
      media: [{ type: "image", url: "https://pbs.twimg.com/media/q1.jpg" }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[0].image, undefined);
  assert.equal(payloads[0].embeds[1].author.name, "Quoting Bob (@bob)");
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/q1.jpg");
});

test("uploaded photos, matched across size variants, show once inside the card through the file uploaded with that message", () => {
  const quoteImages = ["one", "two", "three"].map((name) => ({
    type: "image",
    url: `https://pbs.twimg.com/media/${name}?format=jpg&name=orig`
  }));
  const attachments = quoteImages.map((item, index) => ({
    filename: `media_${index}.jpg`,
    sourceUrl: item.url.replace("name=orig", "name=small")
  }));
  const tweet = {
    ...sampleTweet,
    media: [],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted post text",
      media: quoteImages
    }
  };

  const payloads = buildDiscordPayloads(tweet, { attachments });

  assert.equal(payloads.length, 1);
  assert.deepEqual(Array.from(embedImageUrls(payloads[0])), ["attachment://media_0.jpg", "attachment://media_1.jpg", "attachment://media_2.jpg"]);
  assert.deepEqual(Array.from(payloads[0]._files), ["media_0.jpg", "media_1.jpg", "media_2.jpg"]);
});

test("a quote whose photos extraction also put on the main post keeps its own card, and shows each photo once", () => {
  const duplicatedImages = ["one", "two", "three"].map((name) => ({
    type: "image",
    url: `https://pbs.twimg.com/media/${name}.jpg`
  }));
  const tweet = {
    ...sampleTweet,
    createdAt: "2026-06-10T21:06:19.000Z",
    media: [{ type: "image", url: "https://pbs.twimg.com/media/main.jpg" }, ...duplicatedImages],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: `${"q".repeat(1500)}QUOTE_END`,
      createdAt: "2026-06-11T10:00:00.000Z",
      media: duplicatedImages
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  const embeds = [...payloads.flatMap((payload) => payload.embeds)];
  const mainCard = embeds[0];
  const quoteCard = embeds.find((embed) => embed.author?.name === "Quoting Bob (@bob)");
  assert.ok(quoteCard, "the quote is a card");
  assert.equal(mainCard.fields, undefined, "the main card has no inline quote field");
  assert.ok(quoteCard.description.endsWith("QUOTE_END"), "the quote card keeps the whole quoted text");
  assert.equal(quoteCard.timestamp, "2026-06-11T10:00:00.000Z", "the quote card keeps the quote's date");
  assert.deepEqual(
    embeds.filter((embed) => embed.url === tweet.url).map((embed) => embed.image?.url),
    ["https://pbs.twimg.com/media/main.jpg"],
    "the main card shows only the photo that is its own"
  );
  assert.deepEqual(
    embeds.filter((embed) => embed.url === tweet.quote.url).map((embed) => embed.image?.url),
    duplicatedImages.map((item) => item.url),
    "the quote card shows the shared photos"
  );
});

test("a video quote stays inline, and both posts' videos follow as links", () => {
  const mainVideo = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/main.mp4";
  const quoteVideo = "https://video.twimg.com/ext_tw_video/2/pu/vid/abc/1280x720/quote.mp4";
  const tweet = {
    ...sampleTweet,
    text: "Main clip",
    media: [{ type: "video", url: mainVideo, posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg" }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted clip",
      media: [{ type: "video", url: quoteVideo }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds.length, 1);
  assert.equal(payloads[0].embeds[0].image, undefined);
  assert.doesNotMatch(JSON.stringify(payloads), /poster\.jpg|Plays below/);
  assert.equal(payloads[0].content, openOnX(tweet.url));
  const quoteField = payloads[0].embeds[0].fields.find((field) => field.name === "Quoting Bob (@bob)");
  assert.ok(quoteField.value.endsWith(viewQuotedPost(tweet.quote.url)));
  assert.match(payloads[1].content, /main\.mp4/);
  assert.match(payloads[1].content, /quote\.mp4/);
});

test("packEmbedsIntoMessages respects the 6000 character budget", () => {
  const embeds = Array.from({ length: 4 }, (_, index) => ({
    description: "x".repeat(1800),
    author: { name: `Part ${index + 1}` }
  }));

  const packed = packEmbedsIntoMessages(embeds.map((embed) => [embed]));
  const embedTextLength = (embed) =>
    [embed.title, embed.description, embed.footer?.text, embed.author?.name, ...(embed.fields || []).flatMap((field) => [field.name, field.value])]
      .reduce((sum, value) => sum + String(value ?? "").length, 0);
  assert.ok(packed.length >= 2, "7224 chars of embeds need at least two messages");
  assert.deepEqual([...packed.flat()], embeds, "packing keeps every embed, in order");
  for (const group of packed) {
    const total = group.reduce((sum, embed) => sum + embedTextLength(embed), 0);
    assert.ok(total <= 6000, `message has ${total} embed chars, Discord allows 6000`);
    assert.ok(group.length <= 10, `message has ${group.length} embeds, Discord allows 10`);
  }
});

test("a card's photos stay in the message that holds its card when short chunks fill the first message", () => {
  const photos = (prefix, count) => Array.from({ length: count }, (_, index) => ({ type: "image", url: `https://pbs.twimg.com/media/${prefix}${index + 1}.jpg` }));
  const tweet = {
    ...sampleTweet,
    text: Array.from({ length: 6 }, (_, index) => `x${index}${" ".repeat(4100)}`).join(""),
    media: photos("main", 4),
    quote: { url: "https://x.com/bob/status/2", author: { displayName: "Bob", username: "bob" }, text: "quote", media: photos("q", 4) }
  };

  const payloads = buildDiscordPayloads(tweet);
  const messagesByUrl = new Map();
  payloads.forEach((payload, index) => {
    for (const embed of payload.embeds || []) {
      if (embed.url) messagesByUrl.set(embed.url, [...(messagesByUrl.get(embed.url) || []), index]);
    }
  });
  assert.deepEqual([...messagesByUrl.keys()], [tweet.url, tweet.quote.url]);
  for (const [url, messages] of messagesByUrl) {
    assert.equal(new Set(messages).size, 1, `embeds with url ${url} sit in one message, not ${JSON.stringify(messages)}`);
  }
  for (const payload of payloads) assert.ok(payload.embeds.length <= 10, `${payload.embeds.length} embeds in one message`);
  assert.equal(payloads.flatMap(embedImageUrls).length, 8, "every photo is shown");
  const quoteHost = payloads.flatMap((payload) => payload.embeds).find((embed) => embed.author?.name === "Quoting Bob (@bob)");
  assert.ok(quoteHost.image, "the quote card keeps its first photo");
});

test("a post's first photo sits on its card and the next on a same-url embed that Discord merges into a grid", () => {
  const photoTweet = {
    ...sampleTweet,
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/one.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/two.jpg" }
    ]
  };
  const payloads = buildDiscordPayloads(photoTweet, { includeQuote: false });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds[0].image.url, "https://pbs.twimg.com/media/one.jpg");
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/two.jpg");
  assert.equal(payloads[0].embeds[1].url, payloads[0].embeds[0].url);
});

test("a single skipped video follows as its bare link, with no label", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/clip.mp4";
  const tweet = {
    ...sampleTweet,
    text: "Clip",
    media: [{ type: "video", url: videoUrl }]
  };

  const payloads = buildDiscordPayloads(tweet, { includeQuote: false });
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].content, openOnX(tweet.url));
  assert.doesNotMatch(String(payloads[1].content || ""), /\/status\/1/);
  assert.equal(payloads[0].embeds[0].image, undefined);
  assert.equal(payloads[1].content, videoUrl);

  const fields = payloads[0].embeds.at(-1)?.fields || [];
  assert.equal(fields.some((field) => /Video|Plays below/.test(`${field.name} ${field.value}`)), false);
});

test("successful video attachment uses one payload without poster, fields, or follow-up", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/clip.mp4";
  const tweet = {
    ...sampleTweet,
    text: "Clip",
    media: [{
      type: "video",
      url: videoUrl,
      posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg"
    }]
  };

  const payloads = buildDiscordPayloads(tweet, {
    includeQuote: false,
    attachments: [{ filename: "media_0.mp4", sourceUrl: videoUrl }],
    fallbackVideoUrls: []
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].content, openOnX(tweet.url));
  assert.deepEqual(Array.from(payloads[0]._files), ["media_0.mp4"], "the video uploads with the message");
  assert.equal(payloads[0].embeds[0].image, undefined);
  assert.equal(payloads[0].embeds[0].fields, undefined);
  assert.doesNotMatch(JSON.stringify(payloads), /poster\.jpg|Plays below|Video 1|clip\.mp4/);
});

test("attached video does not hide an unresolved real tweet image", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/clip.mp4";
  const imageUrl = "https://pbs.twimg.com/media/photo.jpg";
  const tweet = {
    ...sampleTweet,
    media: [
      { type: "video", url: videoUrl, posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/poster.jpg" },
      { type: "image", url: imageUrl }
    ]
  };

  const payloads = buildDiscordPayloads(tweet, {
    includeQuote: false,
    attachments: [{ filename: "media_0.mp4", sourceUrl: videoUrl }],
    fallbackVideoUrls: []
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds[0].image.url, imageUrl);
  assert.doesNotMatch(JSON.stringify(payloads), /poster\.jpg|clip\.mp4|Plays below/);
});

test("main and quoted fallback videos identify ownership once", () => {
  const mainVideo = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/main.mp4";
  const quoteVideo = "https://video.twimg.com/ext_tw_video/2/pu/vid/abc/1280x720/quote.mp4";
  const tweet = {
    ...sampleTweet,
    media: [{ type: "video", url: mainVideo }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted clip",
      media: [{ type: "video", url: quoteVideo }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].content, `-# Alice (@alice) · Video 1\n${mainVideo}\n-# Bob (@bob) · Video 1\n${quoteVideo}`);

  const mainFields = payloads[0].embeds[0]?.fields || [];
  assert.equal(mainFields.some((field) => /Video/.test(field.name)), false);
  assert.ok(mainFields.some((field) => field.name === "Quoting Bob (@bob)"));
});

test("extra photos ride on untitled same-url embeds with no field pointing at them", () => {
  const tweet = {
    ...sampleTweet,
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/one.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/two.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/three.jpg" }
    ]
  };

  const payloads = buildDiscordPayloads(tweet, { includeQuote: false });
  const embeds = payloads[0].embeds;
  assert.equal(embeds.length, 3);
  assert.equal(embeds[0].image.url, "https://pbs.twimg.com/media/one.jpg");
  assert.equal(embeds[1].image.url, "https://pbs.twimg.com/media/two.jpg");
  assert.equal(embeds[2].image.url, "https://pbs.twimg.com/media/three.jpg");
  for (const photo of embeds.slice(1)) {
    assert.deepEqual(Object.keys(photo).sort(), ["color", "image", "url"], "a photo embed carries only what the grid merge reads");
    assert.equal(photo.url, tweet.url);
    assert.equal(photo.color, 0x1da1f2);
  }
  assert.equal(embeds[0].fields, undefined);
});

test("supplemental image embeds reject non-Twitter HTTPS image URLs", () => {
  const tweet = {
    ...sampleTweet,
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/one.jpg" },
      { type: "image", url: "https://evil.example/tracker.png" },
      { type: "image", url: "https://pbs.twimg.com.evil.example/media/two.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/three.jpg" }
    ]
  };

  const embeds = buildDiscordPayloads(tweet, { includeQuote: false })[0].embeds;
  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].image.url, "https://pbs.twimg.com/media/one.jpg");
  assert.equal(embeds[1].image.url, "https://pbs.twimg.com/media/three.jpg");
  assert.equal(embeds[1].title, undefined);
});

test("each card's extra photos share that card's url, so the two grids stay apart", () => {
  const tweet = {
    ...sampleTweet,
    text: "main",
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/main1.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/main2.jpg" }
    ],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "quote",
      media: [
        { type: "image", url: "https://pbs.twimg.com/media/q1.jpg" },
        { type: "image", url: "https://pbs.twimg.com/media/q2.jpg" }
      ]
    }
  };

  const embeds = buildDiscordPayloads(tweet)[0].embeds;
  assert.deepEqual(
    Array.from(embeds, (embed) => [embed.url, embed.image?.url, embed.color, embed.title]),
    [
      [tweet.url, "https://pbs.twimg.com/media/main1.jpg", 0x1da1f2, undefined],
      [tweet.url, "https://pbs.twimg.com/media/main2.jpg", 0x1da1f2, undefined],
      [tweet.quote.url, "https://pbs.twimg.com/media/q1.jpg", 0x536471, undefined],
      [tweet.quote.url, "https://pbs.twimg.com/media/q2.jpg", 0x536471, undefined]
    ]
  );
});

test("a quote card with no url of its own still groups its photos, under a url the main card does not use", () => {
  const quote = {
    url: "",
    author: { displayName: "Bob", username: "bob" },
    text: "quote",
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/q1.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/q2.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/q3.jpg" }
    ]
  };

  for (const [what, url] of [["an empty quote url", ""], ["the main post's own url", sampleTweet.url]]) {
    const embeds = buildDiscordPayloads({ ...sampleTweet, quote: { ...quote, url } })[0].embeds;
    const [main, ...quoteEmbeds] = embeds;
    assert.equal(main.url, sampleTweet.url);
    assert.equal(quoteEmbeds.length, 3, `${what}: the quote host and two photo embeds`);
    assert.ok(quoteEmbeds[0].url, `${what}: the quote card has a url`);
    assert.notEqual(quoteEmbeds[0].url, main.url, `${what}: the quote card's url differs from the main card's`);
    assert.deepEqual(quoteEmbeds.map((embed) => embed.url), Array(3).fill(quoteEmbeds[0].url), `${what}: the quote's photos share its url`);
    assert.deepEqual(quoteEmbeds.map((embed) => embed.image.url), quote.media.map((item) => item.url));
    assert.equal(quoteEmbeds[0].author.url, url || undefined, `${what}: the author link stays the quoted post's own url`);
  }
});

test("photos past a card's first four form further grids of four under urls of their own", () => {
  const photos = Array.from({ length: 9 }, (_, index) => ({ type: "image", url: `https://pbs.twimg.com/media/p${index + 1}.jpg` }));
  const payloads = buildDiscordPayloads({ ...sampleTweet, media: photos }, { includeQuote: false });

  assert.equal(payloads.length, 1);
  const embeds = [...payloads[0].embeds];
  assert.deepEqual(embeds.map((embed) => embed.image.url), photos.map((item) => item.url), "every photo is shown, in order");
  const grids = new Map();
  for (const embed of embeds) grids.set(embed.url, (grids.get(embed.url) || 0) + 1);
  assert.deepEqual([...grids.values()], [4, 4, 1], "grids of four");
  assert.equal([...grids.keys()][0], sampleTweet.url, "the first grid is the card's");
  assert.ok([...grids.keys()].every((url, index) => index === 0 || url.startsWith(`${sampleTweet.url}#`)), "later grids tag the post's url");
  assert.equal(embeds.filter((embed) => embed.author).length, 1, "only the card names the author");
});

test("only the first message's photos and every video are upload candidates, and later messages link their photos", () => {
  const mainPhoto = "https://pbs.twimg.com/media/main1.jpg";
  const quoteVideo = "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4";
  const quotePhotos = ["q1", "q2", "q3"].map((name) => `https://pbs.twimg.com/media/${name}.jpg`);
  const tweet = {
    ...sampleTweet,
    text: `${"Long post. ".repeat(800)}end`,
    media: [{ type: "image", url: mainPhoto }],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted",
      media: [...quotePhotos.map((url) => ({ type: "image", url })), { type: "video", url: quoteVideo }]
    }
  };

  assert.deepEqual(Array.from(uploadCandidateUrls(tweet)), [mainPhoto, quoteVideo], "the quote's photos land in a later message, so they are not downloaded");
  assert.deepEqual(Array.from(uploadCandidateUrls(tweet, { includeQuote: false })), [mainPhoto]);

  const attachments = [{ filename: "media_0.jpg", sourceUrl: mainPhoto }, { filename: "media_1.mp4", sourceUrl: quoteVideo }];
  const payloads = buildDiscordPayloads(tweet, { attachments, fallbackVideoUrls: [] });
  assert.ok(payloads.length >= 2, "the share spans messages");
  assert.deepEqual(Array.from(payloads[0]._files), ["media_0.jpg", "media_1.mp4"], "the first message uploads both files");
  assert.equal(payloads[0].embeds[0].image.url, "attachment://media_0.jpg");
  assert.deepEqual(Array.from(payloads.slice(1).flatMap(embedImageUrls)), quotePhotos, "later messages link the quote's photos from their source");
  assert.ok(payloads.slice(1).every((payload) => payload._files === undefined), "later messages upload nothing");
});

test("video, images, and quote media stay in order with no photo labels", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/1/pu/vid/abc/1280x720/main.mp4";
  const tweet = {
    ...sampleTweet,
    text: "Main post",
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/main1.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/main2.jpg" },
      { type: "video", url: videoUrl, posterUrl: "https://pbs.twimg.com/media/main-poster.jpg" }
    ],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted",
      media: [{ type: "image", url: "https://pbs.twimg.com/media/q1.jpg" }]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds.length, 3);

  const mainFields = payloads[0].embeds[0].fields || [];
  assert.equal(mainFields.some((field) => /Video|Plays below|image/i.test(`${field.name} ${field.value}`)), false);
  assert.deepEqual(Array.from(embedImageUrls(payloads[0])), [
    "https://pbs.twimg.com/media/main1.jpg",
    "https://pbs.twimg.com/media/main2.jpg",
    "https://pbs.twimg.com/media/q1.jpg"
  ]);
  assert.equal(payloads[0].embeds.some((embed) => embed.title), false);
  assert.equal(payloads[1].content, videoUrl);
});

test("long tweet text splits across continuation embeds without duplicate url", () => {
  const longTweet = {
    ...sampleTweet,
    text: `${"Word ".repeat(900)}end`
  };
  const embeds = buildDiscordPayloads(longTweet, { includeQuote: false }).flatMap((payload) => payload.embeds);
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  assert.ok(embeds.length > 1);
  assert.equal(normalize(embeds.map((embed) => embed.description).join(" ")), normalize(longTweet.text), "descriptions rejoin to the full text");
  assert.equal(embeds[0].url, longTweet.url);
  assert.equal(embeds[1].url, undefined);
});

test("both posts' photos keep their order across the two cards", () => {
  const tweet = {
    ...sampleTweet,
    media: [
      { type: "image", url: "https://pbs.twimg.com/media/main1.jpg" },
      { type: "image", url: "https://pbs.twimg.com/media/main2.jpg" }
    ],
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "quote",
      media: [
        { type: "image", url: "https://pbs.twimg.com/media/q1.jpg" },
        { type: "image", url: "https://pbs.twimg.com/media/q2.jpg" }
      ]
    }
  };

  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 4);
  assert.equal(payloads[0].embeds[0].image.url, "https://pbs.twimg.com/media/main1.jpg");
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/main2.jpg");
  assert.equal(payloads[0].embeds[2].image.url, "https://pbs.twimg.com/media/q1.jpg");
  assert.equal(payloads[0].embeds[3].image.url, "https://pbs.twimg.com/media/q2.jpg");
});

test("long text splits at the last paragraph break, else line break, else sentence end, before cutting a word", () => {
  const limit = 4096;
  const words = (count) => Array.from({ length: count }, (_, index) => `w${index % 10}`).join(" ");
  const firstChunk = (text) => buildDiscordPayloads({ ...sampleTweet, media: [], text }, { includeQuote: false })[0].embeds[0].description;
  const paragraph = `${words(1000)}.\nA line.\n\n${words(200)}`;
  const tail = words(600);

  assert.equal(firstChunk(`${paragraph} ${tail}`), paragraph.slice(0, paragraph.indexOf("\n\n")), "paragraph break first");
  const lines = `${words(1000)}. One sentence.\n${words(200)}. Another.`;
  assert.equal(firstChunk(`${lines} ${tail}`), lines.slice(0, lines.lastIndexOf("\n")), "then a line break");
  const sentences = `${words(1000)}. ${words(200)}! ${words(100)}`;
  assert.equal(firstChunk(`${sentences} ${tail}`), sentences.slice(0, sentences.lastIndexOf("!") + 1), "then a sentence end");
  const unbroken = words(1500);
  const cut = firstChunk(unbroken);
  assert.ok(cut.length <= limit && cut.length > limit / 2);
  assert.ok(unbroken.startsWith(`${cut} `), "then the last space, so no word is cut");
  assert.equal(firstChunk("x".repeat(5000)).length, limit, "a hard cut only when nothing else fits");
});


test("all extra photo grids stay with their card when the first message is nearly full", () => {
  const photos = (prefix, count) => Array.from({ length: count }, (_, i) => ({ type: "image", url: `https://pbs.twimg.com/media/${prefix}${i}.jpg` }));
  const tweet = {
    ...sampleTweet,
    text: ["x0", "x1"].join(" ".repeat(4100)),
    media: photos("main", 4),
    quote: { url: "https://x.com/bob/status/2", text: "quote", media: photos("quote", 8) }
  };
  const payloads = buildDiscordPayloads(tweet);
  const quoteMessage = payloads.findIndex((payload) => payload.embeds.some((embed) => embed.url === tweet.quote.url && embed.author));
  const quoteEmbeds = payloads[quoteMessage].embeds.filter((embed) => embed.url === tweet.quote.url || embed.url?.startsWith(`${tweet.quote.url}#`));
  assert.equal(quoteEmbeds.length, 8, "all eight quote photos share the host's message");
  assert.equal(payloads.flatMap(embedImageUrls).length, 12);
  assert.ok(payloads.every((payload) => payload.embeds.length <= 10));
});
