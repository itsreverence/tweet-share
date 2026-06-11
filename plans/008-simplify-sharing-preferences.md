# Plan 008: Simplify sharing preferences to two settings

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/10-preferences.js userscript/src/11-settings.js userscript/src/09-ui.js userscript/src/05-format-discord.js tests/`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 004–007 (inline quote, permalinks, attach mode) — should be DONE
- **Category**: dx
- **Planned at**: commit `ac922cf` (v0.6.17 work), 2026-05-26

## Why this matters

After Faytuks-style polish (plans 004–007), the settings modal exposes **five** sharing toggles. Three are “always on” behaviors that most users should never touch:

- `quoteLayout: "auto"` already picks inline vs card intelligently (`05-format-discord.js:42-47`).
- `includeContentPermalink: true` matches Faytuks (URL in message content).
- `includeQuote: true` is duplicated by the **per-share** “Include quoted tweet” checkbox in the share popover (`09-ui.js:316-332`).

Keeping dead toggles increases maintenance (every new feature touches prefs, settings UI, tests, migration) and makes the script feel configur-heavy for a single-user OSINT tool.

**Target UX:** Settings → Sharing has **two** controls. Quote inclusion stays **per share** in the popover only.

## Current state

**Five persisted preferences** (`10-preferences.js`):

```3:19:userscript/src/10-preferences.js
const DEFAULT_PREFERENCES = {
  includeQuote: true,
  alwaysShowPreview: true,
  attachMedia: false,
  quoteLayout: "auto",
  includeContentPermalink: true
};
```

**Settings UI** (`11-settings.js:285-343`): five controls in the Sharing card.

**What to keep vs remove**

| Preference | Recommendation | Reason |
|------------|----------------|--------|
| `attachMedia` | **Keep** — default **`true`** | Real tradeoff (bandwidth / 8 MB); Faytuks parity; fallback to links exists |
| `alwaysShowPreview` | **Keep** — default `true` | Power-user quick-send to one channel |
| `includeQuote` | **Remove from settings** | Per-share checkbox is enough; default checked |
| `quoteLayout` | **Remove** — hardcode auto | Smart behavior already implemented |
| `includeContentPermalink` | **Remove** — always on | Faytuks default; no user asked to disable |

**Internal override for tests:** `buildDiscordPayloads(tweet, { quoteLayout: "card" })` can remain — only **persistence** and settings UI go away.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build | `npm run check` | exit 0 |

## Scope

**In scope:**

- `userscript/src/10-preferences.js` — shrink to 2 prefs; migration-friendly sanitize
- `userscript/src/11-settings.js` — remove 3 controls; tighten copy on remaining 2
- `userscript/src/09-ui.js` — quote checkbox always starts checked; stop passing removed prefs
- `userscript/src/05-format-discord.js` — `includeContentPermalink` always true (remove pref branch); `resolveQuoteLayout` default auto only
- `tests/preferences.test.mjs` — update for 2-pref model
- `tests/format-discord.test.mjs` — keep `quoteLayout`/`includeContentPermalink` **option** tests where needed; remove pref-only cases

**Out of scope:**

- Removing per-share quote checkbox
- Removing attach-mode code paths
- Changing Discord channel management UI

## Git workflow

- Branch: `advisor/008-simplify-preferences`
- Bump patch version (e.g. `0.6.18`)
- Do NOT push unless instructed

## Steps

### Step 1: Shrink `DEFAULT_PREFERENCES`

```javascript
const DEFAULT_PREFERENCES = {
  alwaysShowPreview: true,
  attachMedia: true
};
```

`sanitizePreferences`:

```javascript
return {
  alwaysShowPreview: input.alwaysShowPreview !== false,
  attachMedia: input.attachMedia !== false  // default true; explicit false opts out
};
```

Ignore/strip legacy keys (`includeQuote`, `quoteLayout`, `includeContentPermalink`) on load — do not write them back on save.

**Verify**: `node --test tests/preferences.test.mjs` → pass after updating tests.

### Step 2: Simplify settings UI

Remove UI for: include quote default, quote layout select, include permalink.

Keep two options with shorter hints:

1. **Upload media to Discord** (checked by default)  
   Hint: _"Best playback. Files over 8 MB are sent as links instead."_

2. **Always show preview before sending** (checked by default)  
   Hint: _"Turn off to send instantly when you have one channel and the post has no quote."_

**Verify**: manual — open settings; Sharing section shows exactly 2 toggles.

### Step 3: Share popover quote checkbox

In `09-ui.js` `openDestinationMenu`:

- Initialize `includeQuote = true` always (remove `preferences.includeQuote`).
- Remove `quoteLayout` from `shareOptions()` — formatter defaults to auto.
- `shareOptions()` returns `{ includeQuote, preferences, attachMedia: preferences.attachMedia !== false }` (or `=== true` if sanitize uses strict true default).

Fast path in `startDiscordShare` (`09-ui.js:427-434`): pass `includeQuote: true` only; drop `quoteLayout` from options object.

**Verify**: quotable tweet still shows checkbox; unchecked → quote omitted from payload (existing behavior).

### Step 4: Hardcode formatter defaults

In `05-format-discord.js`:

- `buildShareContentLines`: remove `includeContentPermalink` check; always build main URL line (+ quote line when inline).
- `resolveQuoteLayout`: remove `shareOptions.preferences?.quoteLayout` read; keep `shareOptions.quoteLayout` for **tests only**; default mode `"auto"` when unset.

**Verify**: `npm test` → Jamie inline + card layout tests still pass (`quoteLayout` passed in test options, not prefs).

### Step 5: Update tests

- `preferences.test.mjs`: 2 fields only; `attachMedia` defaults true; `attachMedia: false` opts out.
- Remove preference tests for `quoteLayout` / `includeContentPermalink` / `includeQuote` if any.
- Add test: `includeContentPermalink false` option removed — simple tweet always has `content === url`.
- Keep `quoteLayout: "card"` in format tests (option, not preference).

**Verify**: `npm test` → exit 0 (count may drop slightly; all pass).

### Step 6: Version bump + build

`package.json`, `metadata.txt` → next patch; `npm run build`.

**Verify**: `npm run check` → exit 0.

## Test plan

- Preferences: defaults, sanitize legacy blob with old keys, persist 2 fields
- Format: permalink always on; card layout via `options.quoteLayout` still works
- **Verification**: `npm test` all pass

## Done criteria

- [ ] Settings Sharing section has **exactly 2** toggles
- [ ] `DEFAULT_PREFERENCES` has only `alwaysShowPreview` and `attachMedia`
- [ ] `attachMedia` defaults **true**; users can still turn off upload
- [ ] Quote checkbox in share popover still works; no “include quote default” in settings
- [ ] No persisted `quoteLayout` or `includeContentPermalink`
- [ ] `npm test` && `npm run check` exit 0
- [ ] `plans/README.md` plan 008 → DONE

## STOP conditions

- Removing a pref breaks attach-mode delivery — stop and report
- Users with `attachMedia: false` in storage should remain opted out after sanitize (`!== false` handles missing key as true — **document**: existing false stays false; missing/legacy → true). If you use `=== true` only, migration breaks opt-out — use `!== false` for attach default-on.

## Maintenance notes

- New Discord output options should default in code unless there is a genuine user-facing tradeoff.
- If `quoteLayout: "inline"` is ever needed again, restore as hidden dev flag in `00-config.js`, not settings UI.
