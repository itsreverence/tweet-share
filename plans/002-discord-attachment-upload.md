# Plan 002: Optional Discord attachment upload (Faytuks-style)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/01-http.js userscript/src/05-format-discord.js userscript/src/08-deliver.js userscript/src/09-ui.js userscript/src/10-preferences.js userscript/src/11-settings.js userscript/src/12-preview.js tests/`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-media-extraction-tests.md
- **Category**: direction
- **Planned at**: commit `ac922cf`, 2026-05-26

## Why this matters

OSINT Discord bots (e.g. FaytuksBot) respond to a tweet link with **one message**: a compact embed (author, text, source) plus **native Discord attachments** for the MP4 and all images. Inline video plays from `cdn.discordapp.com`; images are full-size files, not hotlinked embed tiles.

This userscript currently:

- Hotlinks the hero image in `embed.image`
- Adds **one supplemental embed per extra image** (embed budget + visual clutter)
- Sends **a second webhook message** with raw MP4 URL(s) because Discord will not unfurl video when custom embeds are on the same message

That is why a tweet like `https://x.com/itsalireza_akb/status/2064899952623362518` (video + multiple images) feels sloppy compared to Faytuks. v0.6.8 tried upload and was reverted (`b45c743`); this plan reintroduces it as an **opt-in preference** with size limits and automatic fallback to the current link-based mode.

## Current state

**JSON-only webhook client** — cannot send files today:

```22:40:userscript/src/01-http.js
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method,
      url,
      headers: { "content-type": "application/json" },
      data: body ? JSON.stringify(body) : undefined,
      ...
    });
  });
}
```

**Sequential JSON posts:**

```12:19:userscript/src/08-deliver.js
  const payloads = buildDiscordPayloads(tweet, options);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = sanitizeWebhookPayload(payloads[index]);
    await request("POST", destination.webhookUrl, payload);
    ...
  }
```

**Video forced to separate message:**

```359:368:userscript/src/05-format-discord.js
  const videoContent = buildVideoFollowUpContent(videoEntries, { imageSupplementCount });
  if (videoContent) {
    // Discord unfurls MP4 links in content, but not when custom embeds are on the same message.
    messages.push(
      buildWebhookPayload([], tweet, {
        content: videoContent,
        messageLabel: "Videos"
      })
    );
  }
```

**Preferences today** (`userscript/src/10-preferences.js`):

```3:6:userscript/src/10-preferences.js
const DEFAULT_PREFERENCES = {
  includeQuote: true,
  alwaysShowPreview: true
};
```

**Target UX (attach mode ON)** — one webhook POST shaped like Faytuks:

- `payload_json`: `{ username, avatar_url, allowed_mentions, embeds: [single rich card], content: optional tweet URL }`
- `files[0]`: `video.mp4` (if any)
- `files[1..n]`: `image_1.jpg`, … (all images in order)
- No supplemental image embeds; no video follow-up message
- Embed keeps author, description, footer; **omit** `embed.image` when the same image is attached (Discord shows attachments below embed); **omit** video embed fields (`Plays below ↓`)

**Discord limits to respect:**

- Max **10 attachments** per message
- **8 MB** per file on standard servers (document 25 MB boost tier but do not assume)
- Webhook multipart: `payload_json` + `file` fields (see [Discord webhook docs](https://discord.com/developers/docs/resources/webhook#execute-webhook))

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build + syntax | `npm run check` | exit 0 |
| Manual | Share a video+multi-image tweet with attach mode ON | one Discord message, playable video attachment |

## Scope

**In scope:**

- `userscript/src/01-http.js` — add `requestMultipart` (or extend `request`) for webhook file upload
- `userscript/src/13-media-fetch.js` (create) — fetch media bytes via `GM_xmlhttpRequest` / `GM.xmlHttpRequest` with `responseType: "arraybuffer"`
- `userscript/src/05-format-discord.js` — `buildDiscordPayloads` attach-mode branch; slim embed when attachments present
- `userscript/src/08-deliver.js` — resolve attachments, choose JSON vs multipart per message
- `userscript/src/10-preferences.js` — `attachMedia: false` default
- `userscript/src/11-settings.js` — toggle in Sharing section
- `userscript/src/12-preview.js` — show “attachments (N)” hint in preview when enabled
- `userscript/src/09-ui.js` — pass preference into `shareToDestination`
- `tests/format-discord.test.mjs` — attach-mode payload shape tests (mock files, no network)
- `tests/media-fetch.test.mjs` (create) — filename, size gate, ordering logic

**Out of scope:**

- Server-side proxy or bot — stays client-only userscript
- Uploading when total size exceeds limit — must fall back, not fail the share
- Changing default to `attachMedia: true` without explicit maintainer approval
- Nitro/boost detection (use conservative 8 MB cap)

## Git workflow

- Branch: `advisor/002-discord-attachment-upload`
- Bump `package.json` version patch when behavior ships (repo convention for releases)
- Commit style: `Add optional Discord media attachments (v0.6.14)` or similar
- Do NOT push unless operator instructs

## Steps

### Step 1: Add preference `attachMedia`

In `10-preferences.js`:

```javascript
const DEFAULT_PREFERENCES = {
  includeQuote: true,
  alwaysShowPreview: true,
  attachMedia: false
};
```

`sanitizePreferences`: `attachMedia: input.attachMedia === true` (opt-in only).

In `11-settings.js`, add checkbox: “Upload media to Discord (better playback; uses more bandwidth)” with short hint about 8 MB per file.

**Verify**: `npm test` → preferences tests updated and pass.

### Step 2: Create `13-media-fetch.js`

Implement:

```javascript
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 10;

function attachmentFilename(media, index) { ... } // e.g. media_0.mp4, media_1.jpg

function fetchMediaBytes(url) { /* GM XHR arraybuffer */ }

async function resolveAttachmentsForTweet(tweet, shareOptions) {
  // Collect videos first (main tweet, then quote if includeQuote), then images — same order as Faytuks sample
  // Skip items without URL; skip if fetch fails; skip if over size; stop at 10
  // Return { attachments: [{ filename, bytes, contentType, sourceUrl }], skipped: [...] }
}
```

Use `video/mp4` and `image/jpeg` content types when known; infer extension from URL.

On fetch error or oversize: push to `skipped`, continue (do not throw).

**Verify**: `node --test tests/media-fetch.test.mjs` → exit 0.

### Step 3: Add `requestMultipart` in `01-http.js`

New function:

```javascript
function requestMultipart(url, payloadJson, files) {
  // files: [{ name: "files[0]", filename, blob, contentType }]
  // Build FormData if available in userscript context, else manual multipart boundary
  // Do NOT set Content-Type header manually when using FormData (boundary auto)
  // Parse response with existing parseDiscordResponse
}
```

Keep existing `request()` for JSON-only messages unchanged.

**Verify**: unit-test boundary builder if FormData unavailable in Node tests; or mock `requestMultipart` in deliver tests.

### Step 4: Attach-mode formatting in `05-format-discord.js`

Add option `attachMedia: true` to `buildEmbedDiscordPayloads`:

When `attachMedia` and caller will attach files for this tweet half:

- Do **not** call `buildImageSupplementEmbeds` (no extra image embeds)
- Do **not** append video follow-up message
- Do **not** add video fields with `Plays below ↓`
- Do **not** set `embed.image` if that image is already in the attachment list (first image or video poster only when no attachment duplicate)
- Keep author, description, color, footer, url

Export a helper `collectMediaAttachmentUrls(tweet, shareOptions)` returning ordered URL list for fetch step (videos then images, main then quote).

Add tests in `format-discord.test.mjs`:

- `attachMedia: true` + video + 3 images → **1** payload message, no `content` video block, embed count 1 (or 2 with quote), no supplemental embeds.

**Verify**: `node --test tests/format-discord.test.mjs` → all pass including new cases.

### Step 5: Wire delivery in `08-deliver.js`

```javascript
async function shareToDestination(destinationId, tweet, options = {}) {
  const preferences = options.preferences || DEFAULT_PREFERENCES;
  const attachMedia = preferences.attachMedia === true;
  ...
  if (attachMedia) {
    const resolved = await resolveAttachmentsForTweet(tweet, options);
    const payloads = buildDiscordPayloads(tweet, { ...options, attachMedia: true, attachmentUrls: resolved.urls });
    // First (or only) message: multipart with files
    // If resolved.skipped.length, optionally append plain-text URLs in content (truncated) OR toast after share
  } else {
    // existing path
  }
}
```

If attachments empty after fetch (all failed), **fall back** to existing `buildDiscordPayloads` without attach flag and show info toast: “Media upload failed; sent links instead.”

Keep `WEBHOOK_SEND_DELAY_MS` between messages when multiple messages still required (long text embed packing).

**Verify**: `npm run check` → exit 0.

### Step 6: Preview polish (`12-preview.js`)

When `attachMedia` enabled, after rendering embed preview, append subtle line: “Media will upload as N attachment(s)” based on `collectMediaAttachmentUrls` count (no actual fetch in preview).

**Verify**: manual — open share popover with setting on; label visible.

### Step 7: Version bump

Increment `package.json` version and `userscript/metadata.txt` `@version` to next patch.

**Verify**: `npm run check` → exit 0.

## Test plan

- `tests/media-fetch.test.mjs`: ordering (video before images), max count 10, oversize rejection, filename generation
- `tests/format-discord.test.mjs`: attach mode payload structure (no video follow-up, no supplemental embeds)
- `tests/preferences.test.mjs`: `attachMedia` sanitize default false, true when set
- Pattern: existing VM loaders
- **Verification**: `npm test` && `npm run check` → exit 0

## Done criteria

- [ ] `attachMedia` preference defaults **false**; settings UI exposes toggle
- [ ] With `attachMedia: true`, a tweet with 1 MP4 + 2 images produces **one** Discord webhook message with **3 attachments** and **one** embed (manual test or documented QA)
- [ ] With `attachMedia: false`, behavior unchanged from pre-plan (format tests still pass)
- [ ] Fetch/upload failure falls back to link mode without throwing
- [ ] No attachment exceeds 8 MB attempted upload
- [ ] `npm test` and `npm run check` exit 0
- [ ] `plans/README.md` plan 002 → DONE

## STOP conditions

- `GM_xmlhttpRequest` cannot POST `FormData` / multipart in Tampermonkey — stop and report environment; document need for manual boundary builder.
- Discord webhook returns 413 or `413001` payload too large — stop and report; reduce scope to images-only attach or lower cap.
- Plan 001 not done and format tests fail on media changes — stop until 001 is DONE.
- Implementing this requires editing files outside scope — stop.

## Maintenance notes

- Watch Discord webhook API changes for multipart field names.
- v0.6.8 regression history: keep upload **opt-in** until stable; mention in settings that large videos may fail.
- Plan 003 (syndication) improves URL quality before fetch — run 003 before 002 if extraction URLs are often empty in practice.
- Reviewers: scrutinize CORS-free fetch paths (must use GM XHR, not `fetch()`), and that webhook URLs never log attachment bytes.
