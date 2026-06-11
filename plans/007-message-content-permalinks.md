# Plan 007: Message content permalink lines

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/05-format-discord.js tests/format-discord.test.mjs`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-inline-quote-embed-layout.md (shares `buildShareContentLines`; land 004 first OR merge helpers without duplicating)
- **Category**: direction
- **Planned at**: commit `ac922cf` (post v0.6.14 work), 2026-05-26

## Why this matters

FaytuksBot puts the **status URL in message `content`** even when a rich embed is present — for media tweets the content is often just `https://x.com/…/status/…`. That makes permalinks copyable from Discord search, mobile long-press, and bots that ignore embeds.

Tweet Share leaves `content` empty on embed shares (`buildWebhookPayload` only sets content for video follow-ups or plain fallback). The embed `url` field links the title area but not the same as visible message text.

## Current state

```328:337:userscript/src/05-format-discord.js
function buildWebhookPayload(embeds, tweet, options = {}) {
  const payload = {
    username: webhookSenderName(),
    avatar_url: webhookSenderAvatarUrl(),
    allowed_mentions: { parse: [] }
  };
  if (embeds.length) payload.embeds = embeds;
  if (options.content) payload.content = options.content;
  ...
}
```

`buildEmbedDiscordPayloads` does not pass content on the primary embed message except via plan 004's quote lines (not yet landed).

Video follow-up is a **separate** message with its own content — must not duplicate main URL there.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build | `npm run check` | exit 0 |

## Scope

**In scope:**

- `userscript/src/05-format-discord.js` — always set first-message content to main URL (+ quote line when inline quote from 004)
- `userscript/src/10-preferences.js` — `includeContentPermalink: true` default (opt-out)
- `userscript/src/11-settings.js` — checkbox "Include post URL in message text"
- `tests/format-discord.test.mjs`

**Out of scope:**

- Plain fallback mode (already has URLs in body)
- Video follow-up message content shape

## Git workflow

- Branch: `advisor/007-content-permalinks`
- If plan 004 not landed: implement `buildShareContentLines` here with only main URL; 004 extends it later

## Steps

### Step 1: Preference `includeContentPermalink`

Default `true`. Sanitize: `includeContentPermalink !== false`.

Settings: checkbox with hint "Shows the X post link above the embed in Discord (easier to copy)."

**Verify**: preferences tests updated.

### Step 2: Unify content builder

Ensure `buildShareContentLines(tweet, shareOptions)` (from 004 or create here):

```javascript
function buildShareContentLines(tweet, shareOptions = {}) {
  if (shareOptions.includeContentPermalink === false) return undefined;
  const lines = [];
  if (tweet.url) lines.push(tweet.url);
  // quote line only when inline layout (import resolveQuoteLayout from 004)
  ...
  return lines.length ? truncate(lines.join("\n"), DISCORD_LIMITS.content) : undefined;
}
```

Pass `includeContentPermalink` from preferences through `09-ui.js` → `shareToDestination` options.

### Step 3: Apply on first embed message only

In `buildEmbedDiscordPayloads`, after `packed` messages built:

```javascript
if (messages[0] && !messages[0].content) {
  const content = buildShareContentLines(tweet, shareOptions);
  if (content) messages[0].content = content;
}
```

Do not add to video-only follow-up message (`messages[1]` in link mode).

When `attachMedia` and content set, Discord may still show embed + attachments — acceptable (Faytuks does this).

**Verify**: simple tweet without quote → `payloads[0].content === tweet.url`.

### Step 4: Tests

- Simple tweet: content equals main URL
- `includeContentPermalink: false` → no content
- With plan 004 inline quote: content has two lines
- Video follow-up message: still no main URL on second message

**Verify**: `npm test` → exit 0.

### Step 5: Preview

Show content block at top of preview when `payload.content` set (`12-preview.js` may already partially support — extend).

**Verify**: `npm run check` → exit 0.

## Test plan

- 3+ cases above in `format-discord.test.mjs`
- Preferences sanitize

## Done criteria

- [ ] Default: embed shares include main URL in `content`
- [ ] Opt-out preference works
- [ ] Video follow-up message unchanged
- [ ] `npm test` && `npm run check` exit 0
- [ ] `plans/README.md` plan 007 → DONE

## STOP conditions

- Plan 004 in progress with conflicting `buildShareContentLines` — reconcile into one function, do not duplicate
- Content + embed causes Discord 400 — STOP and report (unlikely for URL-only content)

## Maintenance notes

- Long URLs + quote line must stay within `DISCORD_LIMITS.content` (2000).
- Card-mode quote without inline: content is main URL only (quote URL remains on quote embed's `url` field).
