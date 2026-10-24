import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fc from "fast-check";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = process.env.DISCORD_LIMITS_SRC_DIR || path.join(root, "userscript", "src");
const NUM_RUNS = Number(process.env.FC_NUM_RUNS || 1000);
const SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
const WEBHOOK_URL = "https://discord.com/api/webhooks/1234567890/limits-check";
const MiB = 1024 * 1024;

const DISCORD_DOCUMENTED_LIMITS = {
  content: 2000,
  embedsPerMessage: 10,
  totalEmbedChars: 6000,
  title: 256,
  description: 4096,
  fieldsPerEmbed: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  authorName: 256,
  username: 80,
  attachmentsPerMessage: 10
};

function loadSource({ replaceEmbedBuilder = false } = {}) {
  const files = [
    "00-config.js",
    "01-http.js",
    "02-utils.js",
    "04-video.js",
    "05-format-discord.js",
    "13-media-fetch.js",
    "08-deliver.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const harness = { transport: null, embedFormatting: null };
  const context = createContext({
    console: { ...console, warn: () => {} },
    URL,
    Blob,
    FormData,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] },
    window: { setTimeout: (callback) => setImmediate(callback) },
    GM: { xmlHttpRequest: (details) => harness.transport(details) },
    getDestinationById: async () => ({ webhookUrl: WEBHOOK_URL }),
    showToast: () => {},
    __harness: harness
  });
  const embedBuilder = replaceEmbedBuilder ? "\nbuildEmbedDiscordPayloads = (...args) => __harness.embedFormatting(...args);" : "";
  runInNewContext(`${code}${embedBuilder}\nthis.exports = { shareToDestination, truncate };`, context);
  return { ...context.exports, harness };
}

const formatter = loadSource();
const failingFormatter = loadSource({ replaceEmbedBuilder: true });
const { truncate } = formatter;
const EMBED_FAILURES = {
  throws: () => {
    throw new Error("embed formatting failed");
  },
  "returns no payloads": () => []
};
const PLAN_EXHAUSTED = { get: "error", head: "error", size: 0 };

function mediaResponse(details, outcome) {
  if (details.method === "HEAD") {
    if (outcome.head === "error") return details.onerror();
    if (outcome.head === "status405") return details.onload({ status: 405, responseHeaders: "" });
    const headers = outcome.head === "length" ? `content-length: ${outcome.size}\r\n` : "";
    return details.onload({ status: 200, responseHeaders: headers });
  }
  if (outcome.get === "error") return details.onerror();
  if (outcome.get === "timeout") return details.ontimeout();
  if (outcome.get === "status404") return details.onload({ status: 404 });
  const bytes = { byteLength: outcome.size, toString: () => details.url };
  return details.onload({ status: 200, response: bytes });
}

async function webhookRequest(details) {
  if (typeof details.data === "string") return { payload: JSON.parse(details.data), files: [] };
  const files = [];
  let payload = {};
  for (const [name, value] of details.data.entries()) {
    if (name === "payload_json") payload = JSON.parse(value);
    else files.push({ name, filename: value.name, sourceUrl: await value.text() });
  }
  return { payload, files };
}

async function sentWebhookRequests(tweet, shareOptions, fetchPlan, embedFailure) {
  const { shareToDestination, harness } = embedFailure ? failingFormatter : formatter;
  harness.embedFormatting = EMBED_FAILURES[embedFailure];
  const requests = [];
  const outcomeByUrl = new Map();
  const nextPlannedOutcome = (url) => {
    if (!outcomeByUrl.has(url)) outcomeByUrl.set(url, fetchPlan[outcomeByUrl.size] ?? PLAN_EXHAUSTED);
    return outcomeByUrl.get(url);
  };
  const pending = [];
  harness.transport = (details) => {
    if (details.url !== WEBHOOK_URL) {
      const outcome = nextPlannedOutcome(details.url);
      setImmediate(() => mediaResponse(details, outcome));
      return;
    }
    const parsed = webhookRequest(details).then((request) => {
      requests.push(request);
      details.onload({ status: 204, responseText: "" });
    });
    pending.push(parsed);
  };
  await shareToDestination("destination", tweet, shareOptions);
  await Promise.all(pending);
  return requests;
}

const boundaries = [256, 1024, 1900, 2000, 4096, 6000];
const length = fc.oneof(
  fc.integer({ min: 0, max: 25000 }),
  fc.constantFrom(...boundaries).chain((b) => fc.integer({ min: b - 6, max: b + 6 }))
);
const piece = fc.oneof(
  { weight: 6, arbitrary: fc.stringMatching(/^[A-Za-z0-9@#.,'"!?]{1,12}$/) },
  { weight: 4, arbitrary: fc.constant(" ") },
  { weight: 1, arbitrary: fc.constantFrom("\n", "\n\n", "   ") },
  { weight: 1, arbitrary: fc.constantFrom("😀", "🇺🇸", "é", "中文", "@everyone", "<@123>", "**", "> ") }
);
const shortProse = fc.array(piece, { maxLength: 40, size: "max" }).map((p) => p.join(""));
const repeatedBlock = fc.oneof(
  fc.array(piece, { minLength: 1, maxLength: 40, size: "max" }).map((p) => p.join("")),
  fc.constantFrom("a", "a ", " a", "😀", "a\n", "word ")
);
const longText = fc.tuple(repeatedBlock, length).map(([s, n]) => s.repeat(Math.ceil(n / s.length)).slice(0, n));
const text = fc.oneof(shortProse, longText);
const statusId = fc.bigInt({ min: 1n, max: 10n ** 19n }).map(String);
const username = fc.stringMatching(/^[A-Za-z0-9_]{1,15}$/, { size: "max" });
const author = fc.record(
  {
    displayName: fc.oneof(fc.string({ maxLength: 50, unit: "grapheme", size: "max" }), fc.constant("")),
    username: fc.oneof(username, fc.constant("")),
    avatarUrl: fc.constantFrom("https://pbs.twimg.com/profile_images/1/a_normal.jpg", "", "http://insecure/x.jpg")
  },
  { requiredKeys: [] }
);
const twimgImageItem = statusId.map((id) => ({ type: "image", url: `https://pbs.twimg.com/media/${id}?format=jpg&name=orig` }));
const imageItem = fc.oneof(twimgImageItem, fc.constant({ type: "image", url: "https://example.com/not-twimg.jpg" }));
const VIDEO_SHAPES = {
  ext_tw_video: (id, size, tag) => `https://video.twimg.com/ext_tw_video/${id}/pu/vid/${size}/v${id}.mp4${tag}`,
  amplify_video: (id, size, tag) => `https://video.twimg.com/amplify_video/${id}/vid/avc1/${size}/v${id}.mp4${tag}`,
  amplify_video_0_0: (id, size, tag) => `https://video.twimg.com/amplify_video/${id}/vid/avc1/0/0/${size}/v${id}.mp4${tag}`
};
const POSTER_DIRS = {
  ext_tw_video: "ext_tw_video_thumb",
  amplify_video: "amplify_video_thumb",
  amplify_video_0_0: "amplify_video_thumb",
  tweet_video: "tweet_video_thumb"
};
const videoItem = fc
  .record({
    id: statusId,
    shape: fc.constantFrom(...Object.keys(POSTER_DIRS)),
    tag: fc.constantFrom("", "?tag=12", "?tag=14"),
    hasUrl: fc.boolean(),
    hasPoster: fc.boolean(),
    hasVariants: fc.boolean()
  })
  .map(({ id, shape, tag, hasUrl, hasPoster, hasVariants }) => {
    const gif = shape === "tweet_video";
    const url = !hasUrl ? "" : gif ? `https://video.twimg.com/tweet_video/G${id}.mp4` : VIDEO_SHAPES[shape](id, "1280x720", tag);
    const item = { type: "video", url, posterUrl: hasPoster ? `https://pbs.twimg.com/${POSTER_DIRS[shape]}/${id}/pu/img/p.jpg` : "" };
    if (url && hasVariants) {
      item.variants = gif
        ? [{ url, bitrate: 0, type: "video/mp4" }]
        : [
            { url, bitrate: 2176000, type: "video/mp4" },
            { url: VIDEO_SHAPES[shape](id, "640x360", tag), bitrate: 832000, type: "video/mp4" }
          ];
    }
    return item;
  });
const X_MAX_MEDIA_PER_POST = 4;
const mediaOf = (image) => fc.array(fc.oneof(image, videoItem), { maxLength: X_MAX_MEDIA_PER_POST });
const fullMediaOf = (...items) => fc.array(fc.oneof(...items), { minLength: X_MAX_MEDIA_PER_POST, maxLength: X_MAX_MEDIA_PER_POST });
const fullMedia = fc.oneof(
  { weight: 2, arbitrary: fullMediaOf(twimgImageItem) },
  { weight: 1, arbitrary: fullMediaOf(videoItem) },
  { weight: 1, arbitrary: fullMediaOf(twimgImageItem, videoItem) }
);

function postArb(media) {
  return fc.record({
    url: fc.tuple(username, statusId).map(([u, id]) => `https://x.com/${u}/status/${id}`),
    author,
    text,
    createdAt: fc.constantFrom("2026-06-10T21:06:19.000Z", "Tue May 26 12:00:00 +0000 2026", "", "garbage"),
    media
  });
}
const mediaIdOf = (url) => /\/(?:media|ext_tw_video|amplify_video|tweet_video)\/([^/?.]+)/.exec(url)?.[1];

function withDistinctMediaIds(t) {
  const seen = new Set();
  const firstUse = (item) => {
    const id = mediaIdOf(item.url);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  const main = { ...t, media: t.media.filter(firstUse) };
  return t.quote ? { ...main, quote: { ...t.quote, media: t.quote.media.filter(firstUse) } } : main;
}

const tweetOf = (image) =>
  fc.oneof(
    {
      weight: 3,
      arbitrary: fc
        .tuple(postArb(mediaOf(image)), fc.option(postArb(mediaOf(image)), { nil: undefined }))
        .map(([main, quote]) => (quote ? { ...main, quote } : main))
    },
    { weight: 1, arbitrary: fc.tuple(postArb(fullMedia), postArb(fullMedia)).map(([main, quote]) => ({ ...main, quote })) }
  ).map(withDistinctMediaIds);
const tweet = tweetOf(imageItem);
const QUOTE_MARK = "‡quoted‡";
const quoteText = fc.oneof(text.map((value) => `${QUOTE_MARK} ${value}`), fc.constant(""));
const tweetWithMarkedQuote = fc
  .oneof(fc.tuple(postArb(mediaOf(imageItem)), postArb(mediaOf(imageItem))), fc.tuple(postArb(fullMedia), postArb(fullMedia)))
  .chain(([main, quote]) =>
    quoteText.map((value) => ({
      ...main,
      quote: { ...quote, url: quote.url.replace("https://x.com/", "https://twitter.com/"), text: value }
    }))
  )
  .map(withDistinctMediaIds)
  .filter((t) => t.quote.text || mediaItems(t.quote).length > 0);
const tweetWithShareableImages = tweetOf(twimgImageItem);
const options = fc.record(
  {
    includeQuote: fc.boolean(),
    quoteLayout: fc.constantFrom("auto", "card", "inline")
  },
  { requiredKeys: [] }
);
const mediaSize = fc.oneof(
  fc.integer({ min: 1, max: 6 * MiB }),
  fc.constantFrom(10 * MiB - 1, 10 * MiB, 10 * MiB + 1),
  fc.integer({ min: 10 * MiB + 2, max: 40 * MiB })
);
const fetchOutcome = fc.record({
  get: fc.constantFrom("ok", "ok", "ok", "status404", "error", "timeout"),
  head: fc.constantFrom("length", "length", "no-length", "status405", "error"),
  size: mediaSize
});
const smallDownload = fc.record({
  get: fc.constant("ok"),
  head: fc.constantFrom("length", "no-length"),
  size: fc.integer({ min: 1, max: 3 * MiB })
});
const MAX_DOWNLOAD_URLS = 2 * X_MAX_MEDIA_PER_POST * 2;
const fetchPlan = fc.oneof(
  { weight: 4, arbitrary: fc.array(fetchOutcome, { maxLength: MAX_DOWNLOAD_URLS, size: "max" }) },
  { weight: 1, arbitrary: fc.array(smallDownload, { minLength: MAX_DOWNLOAD_URLS, maxLength: MAX_DOWNLOAD_URLS }) },
  { weight: 2, arbitrary: fc.constant([]) }
);
const embedFailure = fc.constantFrom(...Object.keys(EMBED_FAILURES));

const len = (value) => String(value ?? "").length;

function embedChars(embed) {
  let total = len(embed.title) + len(embed.description) + len(embed.footer?.text) + len(embed.author?.name);
  for (const field of embed.fields || []) total += len(field.name) + len(field.value);
  return total;
}

function embedViolations(embed, where) {
  const out = [];
  const over = (what, value, limit) => {
    if (len(value) > limit) out.push(`${where} ${what} is ${len(value)} chars (limit ${limit})`);
  };
  over("title", embed.title, DISCORD_DOCUMENTED_LIMITS.title);
  over("description", embed.description, DISCORD_DOCUMENTED_LIMITS.description);
  over("footer.text", embed.footer?.text, DISCORD_DOCUMENTED_LIMITS.footer);
  over("author.name", embed.author?.name, DISCORD_DOCUMENTED_LIMITS.authorName);
  const fields = embed.fields || [];
  if (fields.length > DISCORD_DOCUMENTED_LIMITS.fieldsPerEmbed) {
    out.push(`${where} has ${fields.length} fields (limit ${DISCORD_DOCUMENTED_LIMITS.fieldsPerEmbed})`);
  }
  fields.forEach((field, i) => {
    over(`fields[${i}].name "${String(field.name).slice(0, 30)}"`, field.name, DISCORD_DOCUMENTED_LIMITS.fieldName);
    over(`fields[${i}].value`, field.value, DISCORD_DOCUMENTED_LIMITS.fieldValue);
    if (!String(field.name ?? "").trim()) out.push(`${where} fields[${i}].name is empty`);
    if (!String(field.value ?? "").trim()) out.push(`${where} fields[${i}].value is empty`);
  });
  if (embedChars(embed) === 0 && !embed.image?.url) out.push(`${where} is an empty embed`);
  return out;
}

function messageViolations({ payload, files = [] }, where) {
  const out = [];
  const embeds = payload.embeds || [];
  if (len(payload.content) > DISCORD_DOCUMENTED_LIMITS.content) {
    out.push(`${where} content is ${len(payload.content)} chars (limit ${DISCORD_DOCUMENTED_LIMITS.content})`);
  }
  if (!String(payload.content ?? "").trim() && embeds.length === 0 && files.length === 0) {
    out.push(`${where} has no content, embeds, or files`);
  }
  if (embeds.length > DISCORD_DOCUMENTED_LIMITS.embedsPerMessage) {
    out.push(`${where} has ${embeds.length} embeds (limit ${DISCORD_DOCUMENTED_LIMITS.embedsPerMessage})`);
  }
  if (files.length > DISCORD_DOCUMENTED_LIMITS.attachmentsPerMessage) {
    out.push(`${where} has ${files.length} attachments (limit ${DISCORD_DOCUMENTED_LIMITS.attachmentsPerMessage})`);
  }
  const total = embeds.reduce((sum, embed) => sum + embedChars(embed), 0);
  if (total > DISCORD_DOCUMENTED_LIMITS.totalEmbedChars) {
    out.push(`${where} embeds total ${total} chars (limit ${DISCORD_DOCUMENTED_LIMITS.totalEmbedChars})`);
  }
  return out;
}

function mentionViolations(payload, where) {
  const out = [];
  const parse = payload.allowed_mentions?.parse;
  if (!Array.isArray(parse) || parse.length !== 0) out.push(`${where} allowed_mentions.parse is ${JSON.stringify(parse)}, expected []`);
  for (const key of ["users", "roles"]) {
    const ids = payload.allowed_mentions?.[key];
    if (ids !== undefined && (!Array.isArray(ids) || ids.length !== 0)) {
      out.push(`${where} allowed_mentions.${key} is ${JSON.stringify(ids)}, expected none`);
    }
  }
  if (payload.allowed_mentions?.replied_user === true) out.push(`${where} allowed_mentions.replied_user is true`);
  if (/discord/i.test(payload.username || "")) out.push(`${where} username contains "discord"`);
  if (len(payload.username) > DISCORD_DOCUMENTED_LIMITS.username) {
    out.push(`${where} username exceeds ${DISCORD_DOCUMENTED_LIMITS.username} chars`);
  }
  return out;
}

function report(violations) {
  return violations.length === 0 || assert.fail(violations.slice(0, 8).join("\n"));
}

function elideLongStrings(value) {
  return JSON.stringify(
    value,
    (key, v) => (typeof v === "string" && v.length > 60 ? `${JSON.stringify(v.slice(0, 24)).slice(1, -1)}… (${v.length} chars)` : v),
    2
  );
}

function reporter(details) {
  if (!details.failed) return;
  const cause = details.errorInstance?.message || String(details.errorInstance);
  throw new Error(
    `${cause}\n\nCounterexample (shrunk):\n${elideLongStrings(details.counterexample)}\n\n` +
      `Replay: FC_SEED=${details.seed} FC_NUM_RUNS=${NUM_RUNS} npm run verify:discord-limits\n` +
      `(counterexample path ${details.counterexamplePath} is informational; the replay does not read it)`
  );
}

const run = (prop) => fc.assert(prop, { numRuns: NUM_RUNS, seed: SEED, reporter });
const runShare = (tweets, check, formatting = fc.constant(undefined)) =>
  run(
    fc.asyncProperty(tweets, options, fetchPlan, formatting, async (t, o, plan, failure) =>
      check(t, o, await sentWebhookRequests(t, o, plan, failure), (other) => sentWebhookRequests(other, o, plan, failure))
    )
  );

test("truncate(value, limit) returns at most limit characters for limits from 3 to 4096", () => {
  run(
    fc.property(text, fc.integer({ min: 3, max: 4096 }), (value, limit) => {
      const out = truncate(value, limit);
      assert.ok(out.length <= limit, `truncate(<${value.length} chars>, ${limit}) returned ${out.length} chars`);
    })
  );
});

test("every embed in every sent message respects Discord's per-embed limits", async () => {
  await runShare(tweet, (t, o, requests) =>
    report(
      requests.flatMap(({ payload }, m) => (payload.embeds || []).flatMap((e, i) => embedViolations(e, `message ${m + 1} embed ${i + 1}`)))
    )
  );
});

test("every sent message respects Discord's per-message limits", async () => {
  await runShare(tweet, (t, o, requests) => report(requests.flatMap((request, m) => messageViolations(request, `message ${m + 1}`))));
});

test("plain-text fallback messages respect Discord's per-message limits", async () => {
  await runShare(
    tweet,
    (t, o, requests) => report(requests.flatMap((request, m) => messageViolations(request, `fallback message ${m + 1}`))),
    embedFailure
  );
});

test("every sent message disables mention parsing and uses an allowed sender name", async () => {
  await runShare(
    tweet,
    (t, o, requests) => report(requests.flatMap(({ payload }, m) => mentionViolations(payload, `message ${m + 1}`))),
    fc.oneof(fc.constant(undefined), embedFailure)
  );
});

const collapseWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const mediaItems = (post) => (post?.media || []).filter((item) => item.url);
const collapseZeroVideoDirs = (url) => url.replace(/\/vid\/([^/]+)\/0\/0\/(\d+x\d+)\//, "/vid/$1/$2/");
const asSent = (url) => [url, collapseZeroVideoDirs(url)];
const uploadSources = (item) => [item.url, ...(item.variants || []).map((variant) => variant.url)].flatMap(asSent);
const contentOf = ({ payload }) => String(payload.content ?? "");
const SUPPRESS_EMBEDS = 1 << 2;
const rendersEmbeds = ({ payload }) => !(payload.flags & SUPPRESS_EMBEDS);
const unfencedContentLines = (request) => contentOf(request).replace(/```[\s\S]*?```/g, "").split("\n");

function spansChunksAcrossTrimmedCuts(target, chunks, start) {
  let matched = 0;
  for (const [index, chunk] of chunks.entries()) {
    if (matched === target.length) break;
    if (index > 0 && target[matched] === " ") matched += 1;
    for (let i = index === 0 ? start : 0; i < chunk.length && matched < target.length; i += 1, matched += 1) {
      if (chunk[i] !== target[matched]) return false;
    }
  }
  return matched === target.length;
}

function renderedMedia(requests) {
  const uploaded = new Set(requests.flatMap((request) => request.files.map((file) => file.sourceUrl)));
  const rendering = requests.filter(rendersEmbeds);
  const embedImages = new Set(rendering.flatMap(({ payload }) => (payload.embeds || []).map((embed) => embed.image?.url)));
  const unfurledLines = new Set(rendering.filter(({ payload }) => !payload.embeds?.length).flatMap(unfencedContentLines));
  return (item) =>
    item.type === "image"
      ? embedImages.has(item.url) || uploaded.has(item.url)
      : asSent(item.url).some((url) => unfurledLines.has(url)) || uploadSources(item).some((url) => uploaded.has(url));
}

test("every share carries the main post's text, permalink, and media, and quoted media when included", async () => {
  await runShare(tweetWithShareableImages, (t, o, requests) => {
    const rendered = renderedMedia(requests);
    const descriptions = requests.filter(rendersEmbeds).flatMap(({ payload }) => (payload.embeds || []).map((e) => e.description)).filter(Boolean);
    const missing = [];
    if (!spansChunksAcrossTrimmedCuts(collapseWhitespace(t.text), descriptions.map(collapseWhitespace), 0)) {
      missing.push("main text in its embed descriptions");
    }
    if (!requests.some((request) => contentOf(request).includes(t.url))) missing.push(`main permalink ${t.url} in one message`);
    for (const item of mediaItems(t)) if (!rendered(item)) missing.push(`main media ${item.url}`);
    if (o.includeQuote !== false) {
      for (const item of mediaItems(t.quote)) if (!rendered(item)) missing.push(`quoted media ${item.url}`);
    }
    return report(missing.map((what) => `share is missing ${what}`));
  });
});

test("plain-text fallback carries the main post's text and permalink", async () => {
  await runShare(
    tweetWithShareableImages,
    (t, o, requests) => {
      const contents = requests.map(contentOf);
      const chunks = contents.map(collapseWhitespace);
      const target = collapseWhitespace(t.text);
      const starts = Array.from({ length: (chunks[0]?.length ?? 0) + 1 }, (_, start) => start);
      const missing = [];
      if (!starts.some((start) => spansChunksAcrossTrimmedCuts(target, chunks, start))) missing.push("main text");
      if (!contents.some((content) => content.includes(t.url))) missing.push(`main permalink ${t.url} in one message`);
      return report(missing.map((what) => `fallback is missing ${what}`));
    },
    embedFailure
  );
});

const visibleText = (request) => [contentOf(request), ...(rendersEmbeds(request) ? [JSON.stringify(request.payload.embeds ?? [])] : [])];

test("a share carries the quoted post's text and permalink when included, and sends what it would without the quote when excluded", async () => {
  await runShare(
    tweetWithMarkedQuote,
    async (t, o, requests, share) => {
      const problems = [];
      if (o.includeQuote === false) {
        const { quote, ...withoutQuote } = t;
        const sent = JSON.stringify(requests);
        const baseline = JSON.stringify(await share(withoutQuote));
        if (sent !== baseline) {
          let at = 0;
          while (sent[at] === baseline[at]) at += 1;
          const around = (value) => JSON.stringify(value.slice(Math.max(0, at - 20), at + 60));
          problems.push(`differs from the same share without the excluded quote: sends ${around(sent)} where it would send ${around(baseline)}`);
        }
      } else {
        const visible = requests.flatMap(visibleText).join("\n");
        if (t.quote.text && !visible.includes(QUOTE_MARK)) problems.push("is missing the included quote's text");
        if (!visible.includes(t.quote.url)) problems.push(`is missing the included quote's permalink ${t.quote.url}`);
      }
      return report(problems.map((what) => `share ${what}`));
    },
    fc.oneof(fc.constant(undefined), embedFailure)
  );
});
