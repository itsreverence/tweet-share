# Plan 004: Inline quote embed layout (Faytuks-style)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/05-format-discord.js userscript/src/10-preferences.js userscript/src/11-settings.js userscript/src/12-preview.js tests/format-discord.test.mjs`
> Plans 001–003 may be uncommitted on your branch; if `attachMedia` or `collectMediaAttachmentUrls` are missing, STOP — land plan 002 first.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-discord-attachment-upload.md (attach mode should already exist)
- **Category**: direction
- **Planned at**: commit `ac922cf` (post v0.6.14 work), 2026-05-26

## Why this matters

OSINT bots like FaytuksBot handle **quote tweets** as commentary on someone else's clip: one embed for the main author, quote text as an embed **field** (`Quote from: atrupar` + `> …`), quote URL in message **content**, and media attached without a second gray author card.

Tweet Share always appends a full second embed for the quote (`05-format-discord.js:373-375`). For posts like `https://x.com/JamieBonkiewicz/status/2064816452863988103` (text-only main + video quote), that wastes space and splits attention. Dual-card layout should remain when **both** main and quote have visual media (attribution prefixes from v0.6.10 still matter there).

## Current state

**Dual embed append (always when `includeQuote`):**

```371:375:userscript/src/05-format-discord.js
  const embeds = [...buildTweetEmbedGroup(tweet, "main", shareOptions)];

  if (includeQuote && hasQuoteTweet(tweet)) {
    embeds.push(...buildTweetEmbedGroup(tweet.quote, "quote", shareOptions));
  }
```

**Both sides have media → prefixed labels (keep this path):**

```36:39:userscript/src/05-format-discord.js
function needsMediaPostPrefix(rootTweet, shareOptions = {}) {
  const { includeQuote = true } = shareOptions;
  if (!includeQuote || !hasQuoteTweet(rootTweet)) return false;
  return tweetHasVisualMedia(rootTweet) && tweetHasVisualMedia(rootTweet.quote);
}
```

**Faytuks target shape (Jamie → atrupar quote):**

- `content`: `https://x.com/JamieBonkiewicz/status/…\n↳ Quotes: https://x.com/atrupar/status/…`
- `embeds`: **one** — author Jamie, description = main text, fields:
  - `Quote from: atrupar` → `> Hegseth: "…"`
  - `Source` → main status URL
- `attachments`: quote video only (attach mode)
- No gray second embed

**Preferences today** (`10-preferences.js`): `includeQuote`, `alwaysShowPreview`, `attachMedia` — no quote layout control.

**Tests to update:** `tests/format-discord.test.mjs` — `"quote tweet adds a second embed in the same message"` must become conditional (card mode) or move to inline-mode assertion.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build | `npm run check` | exit 0 |

## Scope

**In scope:**

- `userscript/src/05-format-discord.js` — inline quote layout, content lines, field builders
- `userscript/src/10-preferences.js` — `quoteLayout: "auto"`
- `userscript/src/11-settings.js` — layout selector (Auto / Inline / Card)
- `userscript/src/12-preview.js` — render quote fields + content lines in preview
- `userscript/src/09-ui.js` — pass `quoteLayout` into share options (if not already via preferences)
- `tests/format-discord.test.mjs` — Jamie/atrupar fixture + both-media card fixture

**Out of scope:**

- `06-syndication.js`, `13-media-fetch.js` — extraction/upload unchanged
- Changing `includeQuote` default
- Plan 005 timestamp (separate plan)
- Removing card mode entirely

## Git workflow

- Branch: `advisor/004-inline-quote-embed`
- Bump patch version when shipping
- Do NOT push unless instructed

## Steps

### Step 1: Add `quoteLayout` preference

In `10-preferences.js`:

```javascript
const DEFAULT_PREFERENCES = {
  includeQuote: true,
  alwaysShowPreview: true,
  attachMedia: false,
  quoteLayout: "auto" // "auto" | "inline" | "card"
};
```

`sanitizePreferences`: accept only those three strings; default `"auto"`.

Settings (`11-settings.js`): add a `<select>` or radio group in Sharing section:

- **Auto** — inline when not both-media; card when both have visual media (recommended, default)
- **Inline** — always inline when quote present
- **Card** — current behavior (two embeds)

**Verify**: `npm test` → preferences tests updated for `quoteLayout`.

### Step 2: Layout decision helper

In `05-format-discord.js`:

```javascript
function resolveQuoteLayout(tweet, shareOptions = {}) {
  const mode = shareOptions.quoteLayout || "auto";
  if (!shareOptions.includeQuote || !hasQuoteTweet(tweet)) return "none";
  if (mode === "card") return "card";
  if (mode === "inline") return "inline";
  // auto
  return needsMediaPostPrefix(tweet, shareOptions) ? "card" : "inline";
}
```

Export for tests if using VM harness (assign to `this.resolveQuoteLayout` in test loader only if needed).

**Verify**: unit assertion in `format-discord.test.mjs` — auto → inline for text main + video quote; auto → card for both with images.

### Step 3: Quote field + content builders

Add to `05-format-discord.js`:

```javascript
function formatQuoteFieldValue(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const quoted = trimmed.split("\n").map((line) => `> ${line}`).join("\n");
  return truncate(quoted, DISCORD_EMBED_LIMITS.fieldValue);
}

function buildInlineQuoteFields(tweet) {
  const quote = tweet.quote;
  if (!quote) return [];
  const username = quote.author?.username || "unknown";
  const fields = [];
  const quoteBody = formatQuoteFieldValue(quote.text);
  if (quoteBody) {
    fields.push({
      name: truncate(`Quote from: ${username}`, DISCORD_EMBED_LIMITS.fieldName),
      value: quoteBody,
      inline: false
    });
  }
  if (tweet.url) {
    fields.push({
      name: "Source",
      value: truncate(tweet.url, DISCORD_EMBED_LIMITS.fieldValue),
      inline: false
    });
  }
  return fields;
}

function buildShareContentLines(tweet, shareOptions = {}) {
  const lines = [];
  if (tweet.url) lines.push(tweet.url);
  const layout = resolveQuoteLayout(tweet, shareOptions);
  if (layout === "inline" && tweet.quote?.url) {
    lines.push(`↳ Quotes: ${tweet.quote.url}`);
  }
  return lines.length ? truncate(lines.join("\n"), DISCORD_LIMITS.content) : undefined;
}
```

Use `↳ Quotes:` without emoji (Discord font consistency); emoji is optional if you prefer Faytuks parity — pick one and test.

### Step 4: Wire inline layout in `buildEmbedDiscordPayloads`

1. Compute `quoteLayout = resolveQuoteLayout(tweet, shareOptions)` at start.
2. When building **main** `buildTweetEmbedGroup`, pass `shareOptions` plus `inlineQuoteFields: quoteLayout === "inline" ? buildInlineQuoteFields(tweet) : []`.
3. In `buildTweetEmbedGroup`, on the **last** content embed chunk for `kind === "main"`, append `inlineQuoteFields` to `fields` (after any video fields in link mode).
4. Replace quote embed append:

```javascript
if (includeQuote && hasQuoteTweet(tweet) && quoteLayout === "card") {
  embeds.push(...buildTweetEmbedGroup(tweet.quote, "quote", shareOptions));
}
```

5. When building webhook payloads in the packed loop, set `content: buildShareContentLines(tweet, shareOptions)` on the **first** message only (merge with existing video follow-up rules: content lines on embed message; video follow-up stays separate message in link mode).

**Link mode + inline + quote video:** main embed has quote field; video still goes to follow-up message via existing `buildVideoFollowUpContent` — no gray quote card.

**Attach mode + inline:** one embed + attachments; no second embed.

**Verify**: `node --test tests/format-discord.test.mjs` → new tests pass (step 5).

### Step 5: Tests (Jamie / atrupar fixture)

Add to `tests/format-discord.test.mjs`:

```javascript
const jamieQuoteTweet = {
  url: "https://x.com/JamieBonkiewicz/status/2064816452863988103",
  author: { displayName: "Jamie Bonkiewicz", username: "JamieBonkiewicz", avatarUrl: "https://pbs.twimg.com/profile_images/x.jpg" },
  text: "Then why isn't the Strait of Hormuz open?",
  media: [],
  quote: {
    url: "https://x.com/atrupar/status/2064811778433818859",
    author: { displayName: "Aaron Rupar", username: "atrupar" },
    text: 'Hegseth: "The United States of America controls the Strait of Hormuz"',
    media: [{ type: "video", url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/q.mp4" }]
  }
};
```

Assertions (`quoteLayout: "auto"` or default via preferences in options):

- `payloads[0].embeds.length === 1`
- Field `Quote from: atrupar` with `>` prefix in value
- `payloads[0].content` contains main URL and `↳ Quotes:` + atrupar URL
- Link mode: `payloads.length === 2` (video follow-up)
- Attach mode: `payloads.length === 1`, no quote embed author `atrupar`

Keep existing **both-media** test expecting **2 embeds** under auto/card.

**Verify**: `npm test` → exit 0.

### Step 6: Preview (`12-preview.js`)

When rendering first payload:

- Show `content` lines above embed cards if present
- Render embed `fields` (quote + source) in preview — add minimal field row styling matching Discord-ish layout

**Verify**: manual smoke — open share popover on a quotable tweet; inline fields visible.

### Step 7: Version bump

Patch `package.json` and `userscript/metadata.txt`; `npm run build`.

**Verify**: `npm run check` → exit 0.

## Test plan

- New: Jamie/atrupar inline auto layout
- New: `resolveQuoteLayout` auto → card when both have images (reuse existing both-media tweet)
- Update: `"quote tweet adds a second embed"` → pass `quoteLayout: "card"` OR split into inline vs card tests
- Preferences: sanitize `quoteLayout`
- **Verification**: `npm test` → 30+ tests, all pass

## Done criteria

- [ ] Auto layout: text-only main + quoted video → **1 embed**, content has both URLs, no gray quote card
- [ ] Auto layout: both main and quote have images → **2 embeds** (unchanged)
- [ ] `quoteLayout: "card"` preserves old behavior
- [ ] Settings exposes layout control; default `auto`
- [ ] Preview shows inline quote fields
- [ ] `npm test` && `npm run check` exit 0
- [ ] `plans/README.md` plan 004 → DONE

## STOP conditions

- Plan 002 code missing — STOP until attach/link modes exist
- Inline quote text empty but quote has media only — still use inline layout; field may be omitted; content must still include quote URL
- Appending fields exceeds embed limits on very long quote — truncate field value; if still failing, STOP and report char counts

## Maintenance notes

- Plan 005 adds `timestamp` to the same main embed — no conflict.
- Plan 007 generalizes content URLs for non-quote shares; 004's content lines should compose (call shared helper if 007 lands first).
- Reviewers: confirm link-mode video follow-up still works for inline quote-only-video case.
