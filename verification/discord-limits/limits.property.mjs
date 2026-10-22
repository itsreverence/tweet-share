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

function loadSource() {
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
  const harness = { transport: null };
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
    showToast: () => {}
  });
  runInNewContext(
    `${code}\nthis.exports = { buildPlainFallbackPayloads, sanitizeWebhookPayload, shareToDestination, truncate };`,
    context
  );
  return { ...context.exports, harness };
}

const { buildPlainFallbackPayloads, sanitizeWebhookPayload, shareToDestination, truncate, harness } = loadSource();

// Each distinct media URL the share downloads gets the next outcome in the plan.
// Running out of plan means the download fails, so shrinking leans towards no uploads.
function mediaResponse(details, outcome) {
  if (!outcome) return details.onerror();
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

async function sentWebhookRequests(tweet, shareOptions, fetchPlan) {
  const requests = [];
  const outcomeByUrl = new Map();
  const pending = [];
  harness.transport = (details) => {
    if (details.url !== WEBHOOK_URL) {
      if (!outcomeByUrl.has(details.url)) outcomeByUrl.set(details.url, fetchPlan[outcomeByUrl.size]);
      setImmediate(() => mediaResponse(details, outcomeByUrl.get(details.url)));
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
const shortProse = fc.array(piece, { maxLength: 40 }).map((p) => p.join(""));
const repeatedBlock = fc.oneof(
  fc.array(piece, { minLength: 1, maxLength: 40 }).map((p) => p.join("")),
  fc.constantFrom("a", "a ", " a", "😀", "a\n", "word ")
);
const longText = fc.tuple(repeatedBlock, length).map(([s, n]) => s.repeat(Math.ceil(n / s.length)).slice(0, n));
const text = fc.oneof(shortProse, longText);
const statusId = fc.bigInt({ min: 1n, max: 10n ** 19n }).map(String);
const username = fc.stringMatching(/^[A-Za-z0-9_]{1,15}$/);
const author = fc.record(
  {
    displayName: fc.oneof(fc.string({ maxLength: 50, unit: "grapheme" }), fc.constant("")),
    username: fc.oneof(username, fc.constant("")),
    avatarUrl: fc.constantFrom("https://pbs.twimg.com/profile_images/1/a_normal.jpg", "", "http://insecure/x.jpg")
  },
  { requiredKeys: [] }
);
const twimgImageItem = statusId.map((id) => ({ type: "image", url: `https://pbs.twimg.com/media/${id}?format=jpg&name=orig` }));
const imageItem = fc.oneof(twimgImageItem, fc.constant({ type: "image", url: "https://example.com/not-twimg.jpg" }));
const videoUrl = (id, size) => `https://video.twimg.com/ext_tw_video/${id}/pu/vid/${size}/v${id}.mp4`;
const videoItem = fc
  .record({ id: statusId, hasUrl: fc.boolean(), hasPoster: fc.boolean(), hasVariants: fc.boolean() })
  .map(({ id, hasUrl, hasPoster, hasVariants }) => {
    const url = hasUrl ? videoUrl(id, "1280x720") : "";
    const item = { type: "video", url, posterUrl: hasPoster ? `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/p.jpg` : "" };
    if (url && hasVariants) {
      item.variants = [
        { url, bitrate: 2176000, type: "video/mp4" },
        { url: videoUrl(id, "640x360"), bitrate: 832000, type: "video/mp4" }
      ];
    }
    return item;
  });
const X_MAX_MEDIA_PER_POST = 4;
const mediaOf = (image) => fc.array(fc.oneof(image, videoItem), { maxLength: X_MAX_MEDIA_PER_POST });

function postArb(media) {
  return fc.record({
    url: fc.tuple(username, statusId).map(([u, id]) => `https://x.com/${u}/status/${id}`),
    author,
    text,
    createdAt: fc.constantFrom("2026-06-10T21:06:19.000Z", "Tue May 26 12:00:00 +0000 2026", "", "garbage"),
    media
  });
}
const tweetOf = (media) =>
  fc.tuple(postArb(media), fc.option(postArb(media), { nil: undefined })).map(([main, quote]) => (quote ? { ...main, quote } : main));
const tweet = tweetOf(mediaOf(imageItem));
const tweetWithShareableImages = tweetOf(mediaOf(twimgImageItem));
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
const MAX_DOWNLOAD_URLS = 2 * X_MAX_MEDIA_PER_POST * 2;
const fetchPlan = fc.array(fetchOutcome, { maxLength: MAX_DOWNLOAD_URLS });

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
  if (/discord/i.test(payload.username || "")) out.push(`${where} username contains "discord"`);
  if (len(payload.username) > DISCORD_DOCUMENTED_LIMITS.username) {
    out.push(`${where} username exceeds ${DISCORD_DOCUMENTED_LIMITS.username} chars`);
  }
  return out;
}

const fallbackSentToDiscord = (t, o) => buildPlainFallbackPayloads(t, o).map((p) => sanitizeWebhookPayload(p));

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
      `Replay: FC_SEED=${details.seed} npm run verify:discord-limits  (path ${details.counterexamplePath})`
  );
}

const run = (prop) => fc.assert(prop, { numRuns: NUM_RUNS, seed: SEED, reporter });
const runShare = (tweets, check) =>
  run(fc.asyncProperty(tweets, options, fetchPlan, async (t, o, plan) => check(t, o, await sentWebhookRequests(t, o, plan))));

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

test("plain-text fallback messages respect Discord's per-message limits", () => {
  run(
    fc.property(tweet, options, (t, o) => {
      const violations = fallbackSentToDiscord(t, o).flatMap((payload, m) => messageViolations({ payload }, `fallback message ${m + 1}`));
      return report(violations);
    })
  );
});

test("every sent message disables mention parsing and uses an allowed sender name", async () => {
  await runShare(tweet, (t, o, requests) => {
    const payloads = [...requests.map((request) => request.payload), ...fallbackSentToDiscord(t, o)];
    return report(payloads.flatMap((p, m) => mentionViolations(p, `message ${m + 1}`)));
  });
});

const collapseWhitespace = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const mediaItems = (post) => (post?.media || []).filter((item) => item.url);
const uploadSources = (item) => [item.url, ...(item.variants || []).map((variant) => variant.url)];

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

test("every share carries the main post's text, permalink, and media, and quoted media when included", async () => {
  await runShare(tweetWithShareableImages, (t, o, requests) => {
    const wire = JSON.stringify(requests.map((request) => request.payload));
    const uploaded = new Set(requests.flatMap((request) => request.files.map((file) => file.sourceUrl)));
    const delivered = (item) => wire.includes(item.url) || uploadSources(item).some((url) => uploaded.has(url));
    const descriptions = requests.flatMap(({ payload }) => (payload.embeds || []).map((e) => e.description)).filter(Boolean);
    const missing = [];
    if (!spansChunksAcrossTrimmedCuts(collapseWhitespace(t.text), descriptions.map(collapseWhitespace), 0)) {
      missing.push("main text in its embed descriptions");
    }
    if (!wire.includes(t.url)) missing.push(`main permalink ${t.url}`);
    for (const item of mediaItems(t)) if (!delivered(item)) missing.push(`main media ${item.url}`);
    if (o.includeQuote !== false) {
      for (const item of mediaItems(t.quote)) if (!delivered(item)) missing.push(`quoted media ${item.url}`);
    }
    return report(missing.map((what) => `share is missing ${what}`));
  });
});

test("plain-text fallback carries the main post's text and permalink", () => {
  run(
    fc.property(tweetWithShareableImages, options, (t, o) => {
      const contents = fallbackSentToDiscord(t, o).map((p) => p.content || "");
      const chunks = contents.map(collapseWhitespace);
      const target = collapseWhitespace(t.text);
      const starts = Array.from({ length: (chunks[0]?.length ?? 0) + 1 }, (_, start) => start);
      const missing = [];
      if (!starts.some((start) => spansChunksAcrossTrimmedCuts(target, chunks, start))) missing.push("main text");
      if (!contents.join("").includes(t.url)) missing.push(`main permalink ${t.url}`);
      return report(missing.map((what) => `fallback is missing ${what}`));
    })
  );
});
