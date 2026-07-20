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
  runInNewContext(`${code}\nthis.exports = {\n  buildDiscordPayloads,\n  countEmbedChars,\n  discordEmbedTimestamp,\n  packEmbedsIntoMessages,\n  buildTweetEmbedGroup,\n  hasQuoteTweet,\n  rebalanceEmbedsForCharBudget\n};`, context);
  return context.exports;
}

const {
  buildDiscordPayloads,
  countEmbedChars,
  discordEmbedTimestamp,
  packEmbedsIntoMessages,
  buildTweetEmbedGroup,
  hasQuoteTweet,
  rebalanceEmbedsForCharBudget
} = loadFormatContext();

const sampleTweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice", avatarUrl: "https://pbs.twimg.com/profile_images/a_normal.jpg" },
  text: "Hello world",
  media: [{ type: "image", url: "https://pbs.twimg.com/media/photo.jpg" }]
};

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

test("buildDiscordPayloads returns a single embed message for a simple tweet", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 1);
  assert.match(payloads[0].embeds[0].description, /Hello world/);
  assert.equal(payloads[0].embeds[0].url, sampleTweet.url);
  assert.equal(payloads[0].content, sampleTweet.url);
});

test("embed shares always include message content permalink", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeContentPermalink: false });
  assert.equal(payloads[0].content, sampleTweet.url);
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

test("card quote layout includes main and quoted URLs in content", () => {
  const tweet = {
    ...sampleTweet,
    quote: {
      url: "https://x.com/bob/status/2",
      author: { displayName: "Bob", username: "bob" },
      text: "Quoted text",
      media: []
    }
  };

  const payloads = buildDiscordPayloads(tweet, { quoteLayout: "card" });
  assert.match(payloads[0].content, /https:\/\/x\.com\/alice\/status\/1/);
  assert.match(payloads[0].content, /↳ 📑 Quoted post: https:\/\/x\.com\/bob\/status\/2/);
});

test("webhook sender is branded while the embed shows the tweet author once", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads[0].username, "Tweet Share");
  assert.match(payloads[0].avatar_url, /^https:\/\//);
  assert.equal(payloads[0].embeds[0].author.name, "Alice");
  assert.equal(payloads[0].embeds[0].author.url, "https://x.com/alice");
  assert.equal(payloads[0].embeds[0].footer.text, "x.com");
  assert.match(payloads[0].embeds[0].author.icon_url, /profile_images/);
  assert.doesNotMatch(payloads[0].embeds[0].author.name, /@alice/);
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
  assert.ok(payloads[0].embeds[1].fields.some((field) => field.name === "Quoted post" && field.value === tweet.quote.url));
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
  const quoteField = firstEmbed.fields.find((field) => field.name === "Quoted post from @atrupar");

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds.length, 1);
  assert.match(payloads[0].content, /JamieBonkiewicz\/status\/2064816452863988103/);
  assert.match(payloads[0].content, /↳ 📑 Quoted post: https:\/\/x\.com\/atrupar\/status\/2064811778433818859/);
  assert.ok(quoteField);
  assert.match(quoteField.value, /^> Hegseth:/);
  assert.ok(firstEmbed.fields.some((field) => field.name === "Original post" && field.value === jamieQuoteTweet.url));
  assert.match(payloads[1].content, /q\.mp4/);
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
  assert.equal(payloads[0].embeds[1].title, "Bob · Image 1");
  assert.equal(payloads[0].embeds[1].url, tweet.url);
  assert.equal(payloads[0].embeds[1].image.url, "https://pbs.twimg.com/media/q1.jpg");
  assert.ok(payloads[0].embeds[0].fields.some((field) => field.name === "Quoted post from @bob"));
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
  assert.ok(payloads[0].embeds[0].fields.some((field) => field.name === "Quoted post from @bob"));
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
  assert.match(payloads[0].content, /↳ 📑 Quoted post: https:\/\/x\.com\/bob\/status\/2/);
  assert.ok(payloads[0].embeds[0].fields.some((field) => field.name === "Quoted post from @bob"));
  assert.match(payloads[1].content, /main\.mp4/);
  assert.match(payloads[1].content, /quote\.mp4/);
});

test("packEmbedsIntoMessages respects the 6000 character budget", () => {
  const embeds = Array.from({ length: 4 }, (_, index) => ({
    description: "x".repeat(1800),
    author: { name: `Part ${index + 1}` }
  }));

  const packed = packEmbedsIntoMessages(embeds);
  assert.ok(packed.length >= 2);
  for (const group of packed) {
    const total = group.reduce((sum, embed) => sum + countEmbedChars(embed), 0);
    assert.ok(total <= 6000);
    assert.ok(group.length <= 10);
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

  const rebalanced = rebalanceEmbedsForCharBudget([embed]);
  assert.ok(rebalanced.length >= 2);
  for (const part of rebalanced) {
    assert.ok(countEmbedChars(part) <= 6000);
  }
});

test("image-only posts use embed heroes and supplemental image embeds", () => {
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
  assert.equal(payloads[0].content, tweet.url);
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
    attachMedia: true,
    attachmentUrls: [videoUrl],
    fallbackVideoUrls: []
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].content, tweet.url);
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
    attachMedia: true,
    attachmentUrls: [videoUrl],
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
  assert.ok(mainFields.some((field) => field.name === "Quoted post from @bob"));
});

test("extra images become supplemental embeds instead of link fields", () => {
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
  assert.equal(embeds[1].title, "Image 2");
  assert.equal(embeds[1].image.url, "https://pbs.twimg.com/media/two.jpg");
  assert.equal(embeds[2].title, "Image 3");
  assert.ok(embeds[0].fields?.some((field) => field.name === "More images"));
  assert.equal(embeds[0].color, 0x1da1f2);
  assert.equal(embeds[1].color, 0x1da1f2);
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
  assert.equal(embeds[1].title, "Image 4");
});

test("supplemental images use author prefixes and shared URL grouping when both posts have media", () => {
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
  assert.equal(embeds[1].title, "Alice · Image 2");
  assert.equal(embeds[1].color, 0x1da1f2);
  assert.equal(embeds[2].title, "Bob · Image 1");
  assert.equal(embeds[2].url, tweet.url);
  assert.equal(embeds[2].color, 0x1da1f2);
  assert.equal(embeds[3].title, "Bob · Image 2");
  assert.equal(embeds[3].url, tweet.url);
  assert.equal(embeds[3].color, 0x1da1f2);
});

test("video, images, and quote media share labels and stay in order", () => {
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
  assert.equal(mainFields.some((field) => /Video|Plays below/.test(`${field.name} ${field.value}`)), false);
  assert.ok(mainFields.some((field) => field.name === "More images" && /2 more images below/.test(field.value)));

  assert.equal(payloads[0].embeds[1].title, "Alice · Image 2");
  assert.equal(payloads[0].embeds[2].title, "Bob · Image 1");
  assert.equal(payloads[0].embeds[2].color, 0x1da1f2);
  assert.equal(payloads[0].embeds[2].url, tweet.url);
  assert.equal(payloads[1].content, `_Video:_\n${videoUrl}`);
});

test("long tweet text splits across continuation embeds without duplicate url", () => {
  const longTweet = {
    ...sampleTweet,
    text: `${"Word ".repeat(900)}end`
  };
  const embeds = buildTweetEmbedGroup(longTweet, "main");
  assert.ok(embeds.length > 1);
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
