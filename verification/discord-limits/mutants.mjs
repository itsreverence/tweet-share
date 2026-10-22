import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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
    find: "attachments.map((attachment, fileIndex)",
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

function failingTests(dir) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", check], {
    env: { ...process.env, DISCORD_LIMITS_SRC_DIR: dir },
    encoding: "utf8"
  });
  return [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
}

let ok = true;

const baselineFailures = failingTests(srcDir);
if (baselineFailures.length) {
  ok = false;
  console.log(`FAIL baseline should pass, but failed: ${baselineFailures.join("; ")}`);
} else {
  console.log("ok   baseline passes");
}

for (const mutant of mutants) {
  const { dir, missing } = prepare(mutant);
  if (missing) {
    ok = false;
    console.log(`STALE ${mutant.name} — ${mutant.file} no longer contains ${JSON.stringify(missing)}; update this mutant to the new code`);
    continue;
  }
  const failures = failingTests(dir);
  rmSync(dir, { recursive: true, force: true });
  if (failures.includes(mutant.expect)) {
    console.log(`ok   caught: ${mutant.name}`);
  } else {
    ok = false;
    console.log(`FAIL missed: ${mutant.name} (expected "${mutant.expect}" to fail; failed: ${failures.join("; ") || "none"})`);
  }
}

process.exit(ok ? 0 : 1);
