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
  runInNewContext(`${code}\nthis.exports = {\n  buildDiscordPayloads,\n  countEmbedChars,\n  discordEmbedTimestamp,\n  packEmbedsIntoMessages,\n  hasQuoteTweet,\n  rebalanceEmbedsForCharBudget,\n  truncate\n};`, context);
  return context.exports;
}

const {
  buildDiscordPayloads,
  countEmbedChars,
  discordEmbedTimestamp,
  packEmbedsIntoMessages,
  hasQuoteTweet,
  rebalanceEmbedsForCharBudget,
  truncate
} = loadFormatContext();

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

test("webhook sender is branded while the embed shows the tweet author once", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads[0].username, "Tweet Share");
  assert.match(payloads[0].avatar_url, /^https:\/\//);
  assert.equal(payloads[0].embeds[0].author.name, "Alice (@alice)");
  assert.equal(payloads[0].embeds[0].author.url, "https://x.com/alice");
  assert.equal(payloads[0].embeds[0].footer.text, "x.com");
  assert.match(payloads[0].embeds[0].author.icon_url, /profile_images/);
  assert.equal(payloads[0].embeds.filter((embed) => embed.author).length, 1, "one embed names the author");
});

test("quoteLayout card adds a second embed in the same message", () => {
  const tweet = {
    ...sampleTweet,
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      media: []
    }
  };

  assert.equal(hasQuoteTweet(tweet), true);
  const payloads = buildDiscordPayloads(tweet, { quoteLayout: "card" });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[1].color, 0x536471);
  assert.equal(payloads[0].embeds[1].footer.text, "Quoted post · x.com");
  assert.equal(payloads[0].embeds[1].author.name, "Quoting Bob (@bob)");
  assert.equal(payloads[0].embeds[1].author.url, tweet.quote.url, "the quote card's author name opens the quoted post");
});

test("quote card embed does not use quote timestamp", () => {
  const payloads = buildDiscordPayloads({
    ...sampleTweet,
    createdAt: "2026-06-10T21:06:19.000Z",
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      createdAt: "2026-06-11T10:00:00.000Z",
      media: []
    }
  }, { quoteLayout: "card" });

  assert.equal(payloads[0].embeds[0].timestamp, "2026-06-10T21:06:19.000Z");
  assert.equal(payloads[0].embeds[1].timestamp, undefined);
});

test("auto quote layout inlines text-only main with quoted video", () => {
  const payloads = buildDiscordPayloads(jamieQuoteTweet, { quoteLayout: "auto" });
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

  const payloads = buildDiscordPayloads(tweet, { quoteLayout: "inline" });
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

test("auto quote layout groups main and quoted images in one contextual card", () => {
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

  const payloads = buildDiscordPayloads(tweet, { quoteLayout: "auto" });
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[0].image.url, "https://pbs.twimg.com/media/main1.jpg");
  assert.equal(payloads[0].embeds[1].title, undefined);
  assert.equal(payloads[0].embeds[1].url, tweet.url);
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/q1.jpg");
  assert.ok(payloads[0].embeds[0].fields.some((field) => field.name === "Quoting Bob (@bob)"));
});

test("auto inline quote uses quoted image as the embed hero when main has no media", () => {
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

  const payloads = buildDiscordPayloads(tweet, { quoteLayout: "auto" });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 1);
  assert.equal(payloads[0].embeds[0].image.url, "https://pbs.twimg.com/media/q1.jpg");
  assert.ok(payloads[0].embeds[0].fields.some((field) => field.name === "Quoting Bob (@bob)"));
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

test("inline quote images are deduplicated when extraction also assigns them to the main post", () => {
  const duplicatedImages = ["one", "two", "three"].map((name) => ({
    type: "image",
    url: `https://pbs.twimg.com/media/${name}.jpg`
  }));
  const tweet = {
    ...sampleTweet,
    media: duplicatedImages,
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Distinct quoted post text",
      media: duplicatedImages
    }
  };

  const embeds = buildDiscordPayloads(tweet, { quoteLayout: "auto" })[0].embeds;
  const imageUrls = embeds.flatMap((embed) => embed.image?.url ? [embed.image.url] : []);

  assert.deepEqual(Array.from(imageUrls), [
    "https://pbs.twimg.com/media/one.jpg",
    "https://pbs.twimg.com/media/two.jpg",
    "https://pbs.twimg.com/media/three.jpg"
  ]);
});

test("auto quote layout inlines main and quoted videos as follow-up links", () => {
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

  const packed = packEmbedsIntoMessages(embeds);
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

test("rebalanceEmbedsForCharBudget splits fields when one embed exceeds 6000 chars", () => {
  const embed = {
    color: 1942002,
    author: { name: "Alice" },
    description: "Main tweet with a quoted post attached inline.",
    fields: Array.from({ length: 8 }, (_, index) => ({
      name: `Field ${index + 1}`,
      value: "x".repeat(900),
      inline: false
    }))
  };

  const expectedFields = structuredClone(embed.fields);
  const rebalanced = rebalanceEmbedsForCharBudget([embed]);
  assert.ok(rebalanced.length >= 2);
  for (const part of rebalanced) {
    assert.ok(countEmbedChars(part) <= 6000);
  }
  assert.deepEqual(
    rebalanced.flatMap((part) => part.fields || []),
    expectedFields,
    "every field survives the split, in order"
  );
});

test("rebalanceEmbedsForCharBudget keeps field order when a later field would still fit", () => {
  const embed = {
    color: 1942002,
    author: { name: "Alice" },
    description: "d".repeat(4096),
    fields: [
      { name: "Quoted post", value: "q".repeat(900), inline: false },
      { name: "Original post", value: "o".repeat(1024), inline: false },
      { name: "More images", value: "m".repeat(100), inline: false }
    ]
  };

  const expectedFields = structuredClone(embed.fields);
  const rebalanced = rebalanceEmbedsForCharBudget([embed]);
  for (const part of rebalanced) {
    assert.ok(countEmbedChars(part) <= 6000, `part has ${countEmbedChars(part)} embed chars, Discord allows 6000`);
  }
  assert.deepEqual(
    rebalanced.flatMap((part) => part.fields || []),
    expectedFields,
    "every field survives the split unchanged, in its original order across the primary and continued embeds"
  );
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

test("single skipped video uses one playable URL and a minimal label", () => {
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
  assert.equal(payloads[1].content, `_Video:_\n${videoUrl}`);
  assert.equal(payloads[1].content.split(videoUrl).length - 1, 1);
  assert.doesNotMatch(payloads[1].content, /Video 1|post above/);

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
  assert.match(payloads[1].content, /_Alice · Video 1:_/);
  assert.match(payloads[1].content, /_Bob · Video 1:_/);
  assert.equal(payloads[1].content.split(mainVideo).length - 1, 1);
  assert.equal(payloads[1].content.split(quoteVideo).length - 1, 1);

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

test("an inline quote's photos join the main card's grid, untitled", () => {
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
  assert.equal(embeds.length, 4);
  assert.equal(embeds[0].color, 0x1da1f2);
  for (const photo of embeds.slice(1)) {
    assert.equal(photo.title, undefined);
    assert.equal(photo.url, tweet.url);
    assert.equal(photo.color, 0x1da1f2);
  }
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
  assert.equal(payloads[1].content, `_Video:_\n${videoUrl}`);
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

test("quote images stay as supplemental embeds in link mode", () => {
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
