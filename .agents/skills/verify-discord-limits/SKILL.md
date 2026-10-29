---
name: verify-discord-limits
description: Check that every webhook request tweet-share sends to Discord stays within Discord's limits (2000-char content, 10 embeds, 10 attachments and 6000 embed chars per message, 4096 description, 1024 field value, 256 field name/title/author, 25 fields, non-empty fields), disables every mention, and still carries the post's text, permalink, and media as links or uploaded files, with every photo shown once. Use when changing userscript/src/05-format-discord.js, truncate/splitText or other helpers in 02-utils.js, media helpers in 04-video.js, DISCORD_* constants in 00-config.js, request/requestMultipart in 01-http.js, shareToDestination or sanitizeWebhookPayload in 08-deliver.js, or attachment selection in 13-media-fetch.js, or when a share fails with a Discord 400 "Invalid Form Body".
---

# Verify Discord webhook limits

**Property.** For every tweet and every outcome of the media downloads, every webhook request that `shareToDestination` sends is one Discord accepts: within Discord's size limits, with no empty field and no message that has neither content, embeds, nor files, at most 10 files, and every mention disabled: `allowed_mentions.parse` is `[]`, `allowed_mentions.users` and `.roles` are absent or empty, and `replied_user` is not `true`. The check reads the requests where they leave `01-http.js`: the JSON body of `request`, or the `payload_json` part and the files of the `requestMultipart` form. `buildDiscordPayloads` falls back to `buildPlainFallbackPayloads` when embed formatting throws or produces no payloads. A second copy of the source replaces `buildEmbedDiscordPayloads` with one that does either, so the fallback is also sent through `shareToDestination` and checked against the same per-message and mention rules.

**Preservation.** Staying within limits must not cost content. The sent messages carry the main post's full text in embed descriptions, in order, plus its permalink and every media item, and every quoted media item unless `includeQuote` is `false`. The permalink must appear whole in one message's `content`. A media item counts as delivered only in a form Discord renders. An image counts when it is some embed's `image.url`, or when a multipart file was downloaded from it. A video counts when its URL, with `/0/0/` collapsed as `normalizeTweetVideoUrl` does, is a line by itself in the `content` of a message without embeds (Discord unfurls MP4 links there, but not next to custom embeds, not when wrapped in `<>`, and not inside a ```` ``` ```` code block), or when a multipart file was downloaded from that URL or one of its `variants`, collapsed the same way. A message whose `flags` include `SUPPRESS_EMBEDS` (`1 << 2`) renders neither embeds nor unfurls, so only its uploaded files count. These are the only forms the code produces: `shareCards` turns the post, and an included quote, into cards, `cardEmbeds` puts a card's first photo on its first embed and the rest on same-`url` embeds that Discord merges into its grid, and returns them as one group that `packEmbedsIntoMessages` keeps in one message (every embed with a `url` is sent in the same message as the first embed of the share with that `url`), `buildVideoFollowUpContent` writes each video URL on its own line in an embed-free follow-up, `resolveAttachmentsForTweet` downloads the media, `assignUploads` points the first message's photo embeds at its uploads through `attachment://` and keeps a file off the upload when a later message links that photo, `buildDiscordPayloads` leaves uploaded videos out of the follow-up (`fallbackVideoUrls`), and `shareToDestination` sends each message with the files its `_files` list names. The plain-text fallback carries the main post's text, and its permalink whole in one message. The quoted post follows `includeQuote` on both paths. When it is not `false`, the quote's permalink, and its text when it has any, appear in some message's `content` or in the embeds of a message that renders them. When it is `false`, the share sends exactly the requests it sends for the same post with `quote` removed, compared serialized and in order (JSON body, or `payload_json` and uploaded files), so no part of the quote reaches Discord, including media with no recognizable ID such as video posters. That property generates `tweetWithMarkedQuote`, whose quote always exists and has a `twitter.com` permalink and media IDs the main post never uses. Its text either starts with `QUOTE_MARK` or is empty, so media-only and link-only quotes are exercised. Quotes from the same generator must show up when included, so the exclusion comparison runs on quotes a share does send. Text is compared by `spansChunksAcrossTrimmedCuts`. It collapses whitespace runs to one space, then walks the post's text through the chunks in order (embed descriptions starting at the first one, or fallback message contents starting anywhere in the first one, after the author line). Characters inside a chunk must match exactly. At each chunk boundary it skips at most one space, because `splitText` trims the whitespace where it cuts and a hard cut mid-word leaves none.

**Each photo once.** Discord resolves an `attachment://<name>` embed image only against the files uploaded with that same message, so every such image must name one of them. No two embeds show the same photo, with an `attachment://` image counted as the file it names. A file that no embed of its message names is listed by Discord above the message as a plain attachment, so no embed anywhere shows that photo as well. Photos are matched by their twimg media ID, so size variants of one photo count as one. This property runs on `tweetWithShareableImages` and on `tweetWithRepeatedPhoto`, whose quote repeats a photo of the main post the way extraction sometimes assigns one photo to both.

**Harm if broken.** Discord rejects the message with HTTP 400. `retryRateLimitedRequest` retries only 429s, and `buildDiscordPayloads` only falls back to plain text when formatting throws or produces no payloads, never when Discord rejects one, so a rejected message is lost. In a multi-message share, the messages before it have already posted, so the channel gets half a share. A broken `allowed_mentions` lets a tweet containing `@everyone`, `<@id>`, or `<@&id>` ping the whole server, a user, or a role. A broken preservation property means a share that Discord accepts but that silently drops part of the post, such as a video whose upload failed and whose link was never sent. A broken `attachment://` name makes Discord drop that image or reject the message, and a photo that is uploaded without an embed naming it, and also linked from one, shows twice.

**Tool.** Property-based testing with [fast-check](https://fast-check.dev) (pinned `4.10.2` in `package.json`). It runs the real `userscript/src` files in a `node:vm` context, the same way the tests in `tests/` do, and drives `shareToDestination` through a fake `GM.xmlHttpRequest`. The fake answers media `HEAD`/`GET` requests from a generated fetch plan and records every webhook request. No verifier runs on plain browser JS, so this generates inputs against the real code rather than proving anything about a hand-written model. When a property fails, fast-check shrinks the input to a small counterexample.

## Run it

```sh
npm ci                                    # once; installs fast-check
npm run verify:discord-limits             # the check alone, ~2.5 s, 1000 generated cases per property
npm run verify:discord-limits:mutants     # proves every property can still fail (~3 s on 8 cores)
```

Knobs: `FC_NUM_RUNS=20000` for a deeper soak, `FC_SEED=<n> FC_NUM_RUNS=<n>` to replay a failure (the failure message prints the exact command; the counterexample path it also prints is informational and the replay does not read it). `DISCORD_LIMITS_SRC_DIR=<dir>` points the check at another copy of the source.

`npm test` runs this check alongside the unit tests, so CI runs it on every push and pull request. Every property must pass.

## Does my change touch this?

It does if the diff touches any of the following (coverage record):

| File | Functions / constants the check depends on |
|---|---|
| `userscript/src/05-format-discord.js` | whole file: `buildDiscordPayloads`, `buildEmbedDiscordPayloads`, `shareCards`, `postCard`, `gridUrl`, `cardPhotoUrls`, `cardEmbeds`, `assignUploads`, `packEmbedsIntoMessages`, `buildInlineQuoteFields`, `formatQuoteFieldValue`, `shareContentLine`, `collectShareVideoEntries`, `buildVideoFollowUpContent`, `mediaUrlIdentity`, `collectMediaAttachmentUrls`, `mediaLinks`, `hasQuoteTweet`, `buildWebhookPayload`, `buildPlainFallbackPayloads`, `splitText`, `textBreakBefore`, `countEmbedChars` |
| `userscript/src/02-utils.js` | `truncate`, `unique`, `discordEmbedTimestamp`, `tweetIdFromUrl`, `highResolutionProfileImageUrl`, `isTweetImageMediaUrl`, `tweetImageMediaKey`, `isTweetVideoPosterUrl`, `isTweetVideoThumbnailUrl`, `isPlayableTweetVideoUrl`, `normalizeTweetVideoUrl`, `posterMediaId`, `videoQualityScore`, `playableVideoVariants` |
| `userscript/src/04-video.js` | `imageMedia`, `videoMedia`, `directPlayableVideoUrls`, `playableVideoVariantsForMedia` |
| `userscript/src/00-config.js` | `DISCORD_LIMITS`, `DISCORD_EMBED_LIMITS`, `MESSAGE_CHUNK_LIMIT`, `MEDIA_LINK_STYLE`, `WEBHOOK_SENDER_NAME`, `WEBHOOK_SEND_DELAY_MS` |
| `userscript/src/01-http.js` | `request`, `requestOnce`, `requestMultipart`, `requestMultipartOnce` (the JSON body and the `payload_json` and file parts), `parseDiscordResponse`, `delay` |
| `userscript/src/08-deliver.js` | `shareToDestination` (which payloads get sent, and which files go with each from its `_files`), `sanitizeWebhookPayload` |
| `userscript/src/13-media-fetch.js` | `resolveAttachmentsForTweet`, `collectMediaAttachmentItems`, `mediaAttachmentVariantUrls`, `resolveMediaAttachment`, `fetchMediaBytes`, `fetchMediaSize`, `responseContentLength`, `attachmentBytesLength`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_REQUEST_MAX_BYTES`, `ATTACHMENT_MAX_COUNT` |

The check loads exactly `00-config.js`, `01-http.js`, `02-utils.js`, `04-video.js`, `05-format-discord.js`, `13-media-fetch.js`, and `08-deliver.js` (see `loadSource` in `verification/discord-limits/limits.property.mjs`). It stubs `getDestinationById` and `showToast`, which live in files it doesn't load. If you move a covered function into another file, add that file to `loadSource`. `prepare` in `mutants.mjs` copies the whole source directory, so it needs no change.

**Sync point.** The check was last confirmed against the code at the last commit that touched the verification or this skill. No hash is stored here, so the rule survives squash merges and rebases. To see what covered source changed since then:

```sh
sync=$(git log -1 --format=%H -- verification/discord-limits .agents/skills/verify-discord-limits)
git diff "$sync" -- userscript/src/00-config.js userscript/src/01-http.js userscript/src/02-utils.js userscript/src/04-video.js userscript/src/05-format-discord.js userscript/src/08-deliver.js userscript/src/13-media-fetch.js
```

An empty diff means the check is in sync. Otherwise, reread the diff, confirm that the generators and checks still describe the code (see "Updating" below), and run both commands with the expected result. Then move the sync point forward by committing your change to the verification or to this skill. A source commit alone never moves it. The reverse also holds: any commit to these paths moves the sync point, even a typo fix, so make one only after that review.

## Reading a failure: real bug or modeling error?

A failure prints the broken limit and a shrunk input, for example:

```
Error: message 1 embed 1 fields[0].value is 1026 chars (limit 1024)
Counterexample (shrunk): [{ "url": ..., "text": "aaaa… (250 chars)", "quote": { "text": "😀😀… (1023 chars)", ... } }, {}, []]
Replay: FC_SEED=-107803955 FC_NUM_RUNS=1000 npm run verify:discord-limits
```

The second array element is the `options` object passed to `shareToDestination`. The third, for the properties that send a share, is the fetch plan: one `{ get, head, size }` outcome per distinct media URL in the order the share downloads them, where a URL past the end of the plan fails to download (`PLAN_EXHAUSTED`). The fourth, for the fallback and mention properties, is how embed formatting fails (`throws` or `returns no payloads`), or `undefined` for the real formatter. To decide which kind of failure it is:

- **Real bug.** The counterexample is a tweet X could produce: at most 4 media items per post, text up to 25,000 chars, display name up to 50, `@handle` up to 15. Any download outcome is real (CDNs time out, return errors, omit `content-length`, or serve files over Discord's upload limit). Report it with the counterexample in code terms (which function produced the over-limit value). Do not loosen the `DISCORD_DOCUMENTED_LIMITS` table, the generators, or the checks to make it pass. The `DISCORD_DOCUMENTED_LIMITS` table in the check is deliberately separate from `00-config.js`, so a wrong constant in the product cannot hide a bug.
- **Modeling error.** The input is something the product can never receive, such as more than 4 media items, a tweet shape that `03-network-capture.js` / `06-syndication.js` / `07-extract-dom.js` never builds, or an option that no caller passes. Another sign is an exception thrown from inside the harness (`loadSource` failing with `X is not defined` means a covered function now calls a helper in a file the check doesn't load, and the fake answers every non-webhook request as a media download, so a new kind of request gets nonsense answers). Fix the generator, the loader, or the fake, and say so in your report.
- If you are unsure, reproduce the case by hand with `buildDiscordPayloads` in a scratch script and check the limit against [Discord's docs](https://discord.com/developers/docs/resources/message#embed-object-embed-limits).

## Updating after an intended change

- **New payload field or embed part** (e.g. you start setting `embed.title` somewhere new, or add `thumbnail`/`provider`): if Discord counts it toward the 6000 total or limits it, add it to `embedChars` / `embedViolations` in `limits.property.mjs`.
- **New tweet data** that formatting or attachment selection reads (new `tweet.*` key, a new media `type` or media field, a new share option): add it to the generators (`postArb`, `mediaOf`, `fullMedia`, `videoItem`, `options`), or the check will never exercise it.
- **New send path** (a new function whose result goes to `request("POST", webhookUrl, …)` or `requestMultipart`): send it through the fake transport in `sentWebhookRequests`, or load a variant of the source for it the way `failingFormatter` forces the fallback.
- **New download behavior** (another request in `13-media-fetch.js`, a new response field it reads): teach `mediaResponse`, `fetchOutcome`, and `smallDownload` about it.
- **New property**: add a mutant to `mutants.mjs` that breaks the code it guards and names that property in `expect`. Every property has at least one mutant, so a property that can never fail shows up as `FAIL missed`.
- **Renamed or moved guard**: if `mutants.mjs` prints `STALE <name>`, point that mutant's `find` string at the new code, so each property is still shown failing on a broken variant.
- **Array, string, or regex generators**: give each one that may grow past 10 elements `size: "max"`. fast-check's default size caps them near 10 whatever `maxLength` or the regex says.
- After any of these, run both commands, then commit the change to move the sync point above.

## Scope: what a pass means and doesn't

**Covered:** the webhook requests `shareToDestination` sends for generated tweets and download outcomes. A main post and an optional quoted post each have text 0–25,000 chars (prose, emoji, newlines, space runs, `@everyone`, lengths clustered around 256/1024/1900/2000/4096/6000), 0–4 media items (pbs.twimg.com images, a non-twimg image, `ext_tw_video` and `amplify_video` MP4s with or without `?tag=` queries and a lower-bitrate variant, `amplify_video` MP4s with the `/0/0/` path segment that `normalizeTweetVideoUrl` collapses, `tweet_video` GIFs with a bitrate-0 variant, empty URLs, posters), optional or empty author fields with display names up to 50 graphemes, and `includeQuote`. Each media download can succeed, fail, time out, or return 404, its `HEAD` can report a size, omit it, or fail, and sizes cluster around the 10 MiB per-file and 24 MiB per-request budgets, so shares mix uploaded files, skipped files, links, and video follow-ups the way `resolveAttachmentsForTweet` decides them. A quarter of the tweets have 4 media items on both posts (`fullMedia`: all images, all videos, or mixed), and the fetch plan is sometimes empty (nothing uploads) or all small successful downloads (everything uploads), so the densest shares occur. The preservation properties generate only pbs.twimg.com/media images (`tweetWithShareableImages`), because shares drop other image hosts on purpose. Each property runs 1000 random cases. This is sampling, not exhaustive proof.

**Assumptions:** lengths are measured in UTF-16 code units (`String.length`). That is never smaller than Discord's character count, so a pass is conservative.

**Not covered:**
- The 10-attachments-per-message guard is checked but cannot be reached: a share uploads at most 8 files (both posts' photos and videos, at most 4 media items per post). The 10-embeds guard is reachable. A whitespace run past the middle of a chunk makes `splitText` cut a chunk of a few characters, so a post with four photos and six such chunks fills nine slots and the quote card's grid would overflow. The `wordsBetweenLongWhitespace` text arm produces such posts, one mutant removes the guard, and another packs each embed on its own so a grid can leave its card.
- Multipart bytes. The fake downloads return stand-in objects that record their source URL, so the check does not see real file contents, content types, filenames, or Discord's per-file and per-request size limits.
- Webhook failures. Every webhook request succeeds, so 429 retries (`retryRateLimitedRequest`), timeouts, network errors, partial-delivery errors, and `WEBHOOK_SEND_DELAY_MS` pacing are not exercised. `tests/http.test.mjs` and `tests/deliver.test.mjs` cover those.
- Video variants learned from network capture (`VIDEO_VARIANT_CACHE`, filled by `03-network-capture.js`). The cache stays empty, so only variants on the media item itself are tried.
- Preservation of an included quoted post's full text, author names, and timestamps. Only the main text, permalink, and media are checked whole. An included quote's text is checked by its leading `QUOTE_MARK`, and its permalink whole.
- Lone surrogates. `truncate`/`splitText` can cut an emoji in half, and the check does not test whether Discord accepts that.
- URL validity beyond length (Discord rejects some malformed `url`/`image.url` values). Timestamp format.
- How tweets are extracted (`03-network-capture.js`, `06-syndication.js`, `07-extract-dom.js`). The check assumes they produce the shape above.
- Settings, preview, and UI code (`09-*`, `10-*`, `11-*`, `12-preview.js`), including the webhook test message and toasts.
