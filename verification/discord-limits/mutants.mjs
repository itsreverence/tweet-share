import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { availableParallelism, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "..", "userscript", "src");
const check = path.join(here, "limits.property.mjs");

const PER_EMBED = "every embed in every sent message respects Discord's per-embed limits";
const PER_MESSAGE = "every sent message respects Discord's per-message limits";
const FALLBACK = "plain-text fallback messages respect Discord's per-message limits";
const MENTIONS = "every sent message disables mention parsing and uses an allowed sender name";
const PRESERVES = "every share carries the main post's text, permalink, and media, and quoted media when included";
const FALLBACK_PRESERVES = "plain-text fallback carries the main post's text and permalink";
const QUOTE_ONLY_WHEN_INCLUDED = "a share carries the quoted post's text and permalink when included, and sends what it would without the quote when excluded";
const TRUNCATE = "truncate(value, limit) returns at most limit characters for limits from 3 to 4096";

const mutants = [
  {
    name: "truncate keeps limit - 1 characters before the ellipsis",
    file: "02-utils.js",
    find: "textValue.slice(0, limit - suffix.length)",
    replace: "textValue.slice(0, limit - suffix.length + 2)",
    expect: TRUNCATE
  },
  {
    name: "description chunks larger than Discord allows",
    file: "05-format-discord.js",
    find: "splitText(text, DISCORD_EMBED_LIMITS.description)",
    replace: "splitText(text, 4200)",
    expect: PER_EMBED
  },
  {
    name: "ignore the 6000-char total when packing embeds",
    file: "05-format-discord.js",
    find: "const exceedsCount = current.length > 0 &&",
    replace: "const exceedsCount = false &&",
    expect: PER_MESSAGE
  },
  {
    name: "fallback chunks larger than message content limit",
    file: "05-format-discord.js",
    edits: [
      ["splitText(body, MESSAGE_CHUNK_LIMIT)", "splitText(body, 2600)"],
      ["content: truncate(content, DISCORD_LIMITS.content)", "content"]
    ],
    expect: FALLBACK
  },
  {
    name: "embed payloads allow @everyone pings",
    file: "05-format-discord.js",
    find: "allowed_mentions: { parse: [] }\n  };\n  if (embeds.length)",
    replace: "allowed_mentions: { parse: [\"everyone\"] }\n  };\n  if (embeds.length)",
    expect: MENTIONS
  },
  {
    name: "embed payloads allow mentions of a listed user",
    file: "05-format-discord.js",
    find: "allowed_mentions: { parse: [] }\n  };\n  if (embeds.length)",
    replace: "allowed_mentions: { parse: [], users: [\"123\"] }\n  };\n  if (embeds.length)",
    expect: MENTIONS
  },
  {
    name: "embed formatting failures send no fallback",
    file: "05-format-discord.js",
    find: "return buildPlainFallbackPayloads(tweet, options);\n}",
    replace: "return [];\n}",
    expect: FALLBACK_PRESERVES
  },
  {
    name: "fallback splits the main permalink across two messages",
    file: "05-format-discord.js",
    find: "const parts = chunks.length ? chunks : [body || formatAuthor(tweet)];",
    replace:
      "const parts = (chunks.length ? chunks : [body || formatAuthor(tweet)]).flatMap((chunk) => {\n" +
      "    const cut = tweet.url ? chunk.indexOf(tweet.url) : -1;\n" +
      "    return cut < 0 ? [chunk] : [chunk.slice(0, cut + 12), chunk.slice(cut + 12)];\n" +
      "  });",
    expect: FALLBACK_PRESERVES
  },
  {
    name: "single video follow-up wraps its link in <> so Discord does not unfurl it",
    file: "05-format-discord.js",
    find: "`_Video:_\\n${entries[0].url}`",
    replace: "`_Video:_\\n<${entries[0].url}>`",
    expect: PRESERVES
  },
  {
    name: "video follow-up wraps its links in a code block",
    file: "05-format-discord.js",
    edits: [
      ["`_Video:_\\n${entries[0].url}`", "`_Video:_\\n\\`\\`\\`\\n${entries[0].url}\\n\\`\\`\\``"],
      ["blocks.join(\"\\n\\n\")", "`\\`\\`\\`\\n${blocks.join(\"\\n\\n\")}\\n\\`\\`\\``"]
    ],
    expect: PRESERVES
  },
  {
    name: "every message suppresses its embeds",
    file: "05-format-discord.js",
    find: "allowed_mentions: { parse: [] }\n  };\n  if (embeds.length)",
    replace: "allowed_mentions: { parse: [] },\n    flags: 4\n  };\n  if (embeds.length)",
    expect: PRESERVES
  },
  {
    name: "messages without an image embed suppress their embeds",
    file: "05-format-discord.js",
    find: "if (embeds.length) payload.embeds = embeds;",
    replace: "if (embeds.length) payload.embeds = embeds;\n  if (embeds.length && !embeds.some((embed) => embed.image)) payload.flags = 4;",
    expect: PRESERVES
  },
  {
    name: "share content omits the main permalink",
    file: "05-format-discord.js",
    find: "const lines = [];\n  if (tweet.url) lines.push(tweet.url);\n  if (resolveQuoteLayout",
    replace: "const lines = [];\n  if (resolveQuoteLayout",
    expect: PRESERVES
  },
  {
    name: "drop supplemental image embeds",
    file: "05-format-discord.js",
    find: "return [...withHints, ...supplements];",
    replace: "return withHints;",
    expect: PRESERVES
  },
  {
    name: "embed descriptions strip spaces from the main text",
    file: "05-format-discord.js",
    find: "description: chunk,",
    replace: "description: chunk.replace(/ /g, \"\"),",
    expect: PRESERVES
  },
  {
    name: "fallback strips whitespace from the main text",
    file: "05-format-discord.js",
    find: "if (tweet.text) lines.push(tweet.text);",
    replace: "if (tweet.text) lines.push(tweet.text.replace(/\\s+/g, \"\"));",
    expect: FALLBACK_PRESERVES
  },
  {
    name: "fallback drops the main permalink",
    file: "05-format-discord.js",
    find: "lines.push(formatMediaLinkPlain(item));\n  if (tweet.url) lines.push(tweet.url);",
    replace: "lines.push(formatMediaLinkPlain(item));",
    expect: FALLBACK_PRESERVES
  },
  {
    name: "videos that failed to upload are not linked when another upload succeeds",
    file: "08-deliver.js",
    find: ".filter((url) => isPlayableTweetVideoUrl(url));",
    replace: ".filter(() => false);",
    expect: PRESERVES
  },
  {
    name: "attachments hidden from embeds are never uploaded",
    file: "08-deliver.js",
    find: "files.map((attachment, fileIndex)",
    replace: "[].map((attachment, fileIndex)",
    expect: PRESERVES
  },
  {
    name: "failed downloads are not reported as skipped",
    file: "13-media-fetch.js",
    find: "    skipped.push({\n      sourceUrl: media.url,\n      reason: resolved.reason,",
    replace: "    void ({\n      sourceUrl: media.url,\n      reason: resolved.reason,",
    expect: PRESERVES
  },
  {
    name: "shares include the quoted post even when the user excluded it",
    file: "08-deliver.js",
    find: "const resolved = await resolveAttachmentsForTweet(tweet, options);",
    replace: "options = { ...options, includeQuote: true };\n  const resolved = await resolveAttachmentsForTweet(tweet, options);",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "embed shares drop an included quoted post",
    file: "05-format-discord.js",
    find: "if (shareOptions.includeQuote === false || !hasQuoteTweet(tweet)) return \"none\";",
    replace: "return \"none\";",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "shares include a text-less quoted post even when the user excluded it",
    file: "08-deliver.js",
    find: "const resolved = await resolveAttachmentsForTweet(tweet, options);",
    replace: "if (tweet.quote && !tweet.quote.text) options = { ...options, includeQuote: true };\n  const resolved = await resolveAttachmentsForTweet(tweet, options);",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "embed shares leak part of an excluded quote's text past its opening",
    file: "05-format-discord.js",
    find: "  if (tweet.url) lines.push(tweet.url);\n  if (resolveQuoteLayout(tweet, shareOptions) !== \"none\" && tweet.quote?.url) {",
    replace:
      "  if (tweet.url) lines.push(tweet.url);\n  if (shareOptions.includeQuote === false && tweet.quote?.text?.length > 100) lines.push(tweet.quote.text.slice(100, 200));\n  if (resolveQuoteLayout(tweet, shareOptions) !== \"none\" && tweet.quote?.url) {",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "embed shares leak an excluded quote's media that has no twimg media ID",
    file: "05-format-discord.js",
    find: "  const embeds = [...buildTweetEmbedGroup(tweet, \"main\", shareOptions)];",
    replace:
      "  const embeds = [...buildTweetEmbedGroup(tweet, \"main\", shareOptions)];\n  if (!includeQuote) for (const item of tweet.quote?.media || []) if (item.posterUrl || (item.type === \"image\" && !isTweetImageMediaUrl(item.url))) embeds.push({ image: { url: item.posterUrl || item.url } });",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "embed messages suppress their embeds, hiding an included quote's text",
    file: "05-format-discord.js",
    find: "  if (embeds.length) payload.embeds = embeds;",
    replace: "  if (embeds.length) {\n    payload.embeds = embeds;\n    payload.flags = 1 << 2;\n  }",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "plain-text fallback includes the quoted post even when the user excluded it",
    file: "05-format-discord.js",
    find: "if (includeQuote && hasQuoteTweet(tweet)) {\n    lines.push(\"\");",
    replace: "if (hasQuoteTweet(tweet)) {\n    lines.push(\"\");",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "plain-text fallback relabels media links when the user excluded the quote",
    file: "05-format-discord.js",
    find: "for (const item of mediaLinks(tweet, options)) lines.push(formatMediaLinkPlain(item));",
    replace: "for (const item of mediaLinks(tweet)) lines.push(formatMediaLinkPlain(item));",
    expect: QUOTE_ONLY_WHEN_INCLUDED
  },
  {
    name: "multipart uploads send an empty payload_json",
    file: "01-http.js",
    find: 'formData.append("payload_json", JSON.stringify(payloadJson || {}));',
    replace: 'formData.append("payload_json", JSON.stringify({}));',
    expect: MENTIONS
  }
];

function prepare(mutant) {
  const file = path.join(srcDir, mutant.file);
  let code = readFileSync(file, "utf8");
  const edits = mutant.edits || [[mutant.find, mutant.replace]];
  const missing = edits.find(([find]) => !code.includes(find));
  if (missing) return { missing: missing[0] };
  for (const [find, replace] of edits) code = code.replace(find, replace);
  const dir = mkdtempSync(path.join(tmpdir(), "tds-mutant-"));
  cpSync(srcDir, dir, { recursive: true });
  writeFileSync(path.join(dir, mutant.file), code);
  return { dir };
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function failingTests(dir, only) {
  const filter = only ? [`--test-name-pattern=^${escapeRegExp(only)}$`] : [];
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...filter, check], {
    env: { ...process.env, DISCORD_LIMITS_SRC_DIR: dir },
    stdio: ["ignore", "pipe", "ignore"]
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve([...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])));
  });
}

async function verdict(mutant) {
  const { dir, missing } = prepare(mutant);
  if (missing) {
    return { ok: false, line: `STALE ${mutant.name} — ${mutant.file} no longer contains ${JSON.stringify(missing)}; update this mutant to the new code` };
  }
  const failures = await failingTests(dir, mutant.expect).finally(() => rmSync(dir, { recursive: true, force: true }));
  return failures.includes(mutant.expect)
    ? { ok: true, line: `ok   caught: ${mutant.name}` }
    : { ok: false, line: `FAIL missed: ${mutant.name} (expected "${mutant.expect}" to fail; failed: ${failures.join("; ") || "none"})` };
}

async function baseline() {
  const failures = await failingTests(srcDir);
  return failures.length
    ? { ok: false, line: `FAIL baseline should pass, but failed: ${failures.join("; ")}` }
    : { ok: true, line: "ok   baseline passes" };
}

async function inPool(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

const results = await inPool([baseline, ...mutants.map((mutant) => () => verdict(mutant))], availableParallelism());
for (const { line } of results) console.log(line);
process.exit(results.every((result) => result.ok) ? 0 : 1);
