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
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] }
  };
  runInNewContext(`${code}\nthis.exports = {\n  buildDiscordPayloads,\n  countEmbedChars,\n  packEmbedsIntoMessages,\n  buildTweetEmbedGroup,\n  hasQuoteTweet\n};`, context);
  return context.exports;
}

const {
  buildDiscordPayloads,
  countEmbedChars,
  packEmbedsIntoMessages,
  buildTweetEmbedGroup,
  hasQuoteTweet
} = loadFormatContext();

const sampleTweet = {
  url: "https://x.com/alice/status/1",
  author: { displayName: "Alice", username: "alice", avatarUrl: "https://pbs.twimg.com/profile_images/a_normal.jpg" },
  text: "Hello world",
  media: [{ type: "image", url: "https://pbs.twimg.com/media/photo.jpg" }]
};

test("buildDiscordPayloads returns a single embed message for a simple tweet", () => {
  const payloads = buildDiscordPayloads(sampleTweet, { includeQuote: false });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 1);
  assert.match(payloads[0].embeds[0].description, /Hello world/);
  assert.equal(payloads[0].embeds[0].url, sampleTweet.url);
  assert.equal(payloads[0].content, undefined);
});

test("quote tweet adds a second embed in the same message", () => {
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
  const payloads = buildDiscordPayloads(tweet);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].embeds.length, 2);
  assert.equal(payloads[0].embeds[1].color, 0x536471);
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
