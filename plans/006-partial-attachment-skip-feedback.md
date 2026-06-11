# Plan 006: Partial attachment skip feedback

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/08-deliver.js userscript/src/13-media-fetch.js tests/media-fetch.test.mjs`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-discord-attachment-upload.md
- **Category**: dx
- **Planned at**: commit `ac922cf` (post v0.6.14 work), 2026-05-26

## Why this matters

Plan 002's `resolveAttachmentsForTweet` skips oversize/failed files and still uploads the rest. Today the user only sees a toast when **zero** attachments succeed (`08-deliver.js` → "Media upload failed; sent links instead."). Silent partial skips mean missing videos with no explanation — brittle for OSINT shares where one clip in a multi-media tweet exceeds 8 MB.

Faytuks runs server-side and likely filters before post; userscript users need explicit feedback.

## Current state

```17:29:userscript/src/08-deliver.js
  if (attachMedia) {
    const resolved = await resolveAttachmentsForTweet(tweet, options);
    attachments = resolved.attachments;
    if (attachments.length > 0) {
      payloads = buildDiscordPayloads(tweet, { ...options, attachMedia: true, attachmentUrls: resolved.urls });
    } else {
      payloads = buildDiscordPayloads(tweet, { ...options, attachMedia: false });
      showToast("Media upload failed; sent links instead.", "info");
    }
  }
```

`resolved.skipped` is populated in `13-media-fetch.js` with `reason`: `"count" | "size" | "fetch"` — never surfaced.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |

## Scope

**In scope:**

- `userscript/src/08-deliver.js` — toast after successful partial upload
- `userscript/src/13-media-fetch.js` — optional `summarizeSkippedMedia(skipped)` helper
- `tests/media-fetch.test.mjs` — summary helper unit test

**Out of scope:**

- Retrying failed fetches
- Appending skipped URLs to Discord message content (optional follow-up; keep toast-only for this plan)

## Git workflow

- Branch: `advisor/006-partial-skip-feedback`

## Steps

### Step 1: Skip summary helper

In `13-media-fetch.js`:

```javascript
function summarizeSkippedMedia(skipped = []) {
  if (!skipped.length) return "";
  const parts = [];
  const byReason = { fetch: 0, size: 0, count: 0 };
  for (const item of skipped) byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  if (byReason.size) parts.push(`${byReason.size} too large`);
  if (byReason.fetch) parts.push(`${byReason.fetch} failed to download`);
  if (byReason.count) parts.push(`${byReason.count} over limit`);
  return parts.join(", ");
}
```

**Verify**: unit test with mixed skip reasons → readable string.

### Step 2: Toast in `shareToDestination`

After successful multipart send (or after all payloads sent), if `attachMedia && resolved.skipped.length > 0 && resolved.attachments.length > 0`:

```javascript
showToast(`Uploaded ${resolved.attachments.length} file(s); ${summarizeSkippedMedia(resolved.skipped)}.`, "info");
```

Keep existing full-failure toast unchanged.

**Verify**: extend `media-fetch.test.mjs` or add deliver-focused test with mocked `resolveAttachmentsForTweet` export if extracted — at minimum test `summarizeSkippedMedia`.

### Step 3: Version bump

Patch version; `npm run check`.

## Test plan

- `summarizeSkippedMedia` — empty, single reason, mixed
- **Verification**: `npm test` exit 0

## Done criteria

- [ ] Partial upload shows info toast with counts
- [ ] Full failure still shows existing toast
- [ ] All-success upload shows no skip toast
- [ ] `npm test` exit 0
- [ ] `plans/README.md` plan 006 → DONE

## STOP conditions

- `showToast` unavailable in deliver scope — STOP (should exist from UI module)
- Cannot test deliver without heavy mock — toast logic must be testable via extracted helper at minimum

## Maintenance notes

- If plan 004 adds content URL lines, do not duplicate skipped URLs in content without truncation review.
- Reviewers: toast copy should stay under ~120 chars for mobile Discord users reading Tampermonkey toasts on X.
