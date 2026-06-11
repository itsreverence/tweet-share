# Plan 005: Embed timestamp from tweet time

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/02-utils.js userscript/src/05-format-discord.js userscript/src/12-preview.js tests/format-discord.test.mjs`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (compose cleanly after plan 004)
- **Category**: direction
- **Planned at**: commit `ac922cf` (post v0.6.14 work), 2026-05-26

## Why this matters

FaytuksBot sets `timestamp` on the main rich embed (e.g. `2026-06-10T21:06:19.000Z` for Jamie's post). Discord renders this as the embed sidebar time — useful in fast-moving OSINT channels.

Tweet Share extracts `createdAt` in `07-extract-dom.js` (`time[datetime]` → ISO string) and syndication (`created_at` Twitter format) but **never** passes it to Discord payloads.

## Current state

**Extracted but unused:**

```61:62:userscript/src/07-extract-dom.js
function extractTimestamp(article) {
  return article.querySelector("time")?.getAttribute("datetime") || "";
}
```

```154:154:userscript/src/06-syndication.js
    createdAt: data.created_at || fallback.createdAt || "",
```

**Main embed builder** (`buildTweetEmbedGroup`) sets `author`, `description`, `footer`, `url`, `image` — no `timestamp` key.

Discord expects [ISO8601](https://discord.com/developers/docs/resources/channel#embed-object-embed-structure) for `embed.timestamp`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build | `npm run check` | exit 0 |

## Scope

**In scope:**

- `userscript/src/02-utils.js` — `discordEmbedTimestamp(createdAt)` parser
- `userscript/src/05-format-discord.js` — set `timestamp` on first main embed chunk only
- `userscript/src/12-preview.js` — optional subtle time display if trivial
- `tests/format-discord.test.mjs` — parser + embed tests

**Out of scope:**

- Quote embed timestamp in card mode (only main tweet time for v1)
- User timezone preferences

## Git workflow

- Branch: `advisor/005-embed-timestamp`
- Patch version bump when shipping

## Steps

### Step 1: Add `discordEmbedTimestamp` in `02-utils.js`

```javascript
function discordEmbedTimestamp(createdAt) {
  const raw = String(createdAt || "").trim();
  if (!raw) return undefined;
  // DOM <time datetime> is already ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  // Syndication / Twitter: "Tue May 26 12:00:00 +0000 2026"
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
```

**Verify**: add tests in `format-discord.test.mjs` or small inline in media-extraction — ISO input → ISO output; Twitter string → valid ISO; garbage → `undefined`.

### Step 2: Apply to main embed

In `buildTweetEmbedGroup`, when `kind === "main"` and building the **first** content embed object, add:

```javascript
timestamp: isFirst ? discordEmbedTimestamp(tweet.createdAt) : undefined
```

Only on first chunk of split descriptions. Do not set on quote embeds or supplemental image embeds.

**Verify**: test tweet with `createdAt: "2026-06-10T21:06:19.000Z"` → `payloads[0].embeds[0].timestamp` matches.

### Step 3: Preview (optional)

If `embed.timestamp` present in preview payload, show formatted local time in embed footer area — skip if preview structure makes this noisy.

**Verify**: `npm run check` → exit 0.

### Step 4: Version bump + build

**Verify**: `npm test` → exit 0.

## Test plan

- `discordEmbedTimestamp` — ISO, Twitter format, empty
- `buildDiscordPayloads` — main embed has timestamp; quote card embed does not (card mode)
- **Verification**: `npm test` all pass

## Done criteria

- [ ] Main embed includes `timestamp` when `tweet.createdAt` parseable
- [ ] Invalid/missing `createdAt` omits field (no throw)
- [ ] `npm test` && `npm run check` exit 0
- [ ] `plans/README.md` plan 005 → DONE

## STOP conditions

- `new Date(twitterFormat)` unreliable in VM test — use fixed fixture strings only
- Discord rejects timestamp format — STOP and report API error from manual test

## Maintenance notes

- If plan 004 inline layout merges quote into main embed, timestamp still reflects **main** tweet time only (Faytuks behavior).
- Syndication `created_at` on quote enrichment is separate; do not use quote `createdAt` for main embed.
