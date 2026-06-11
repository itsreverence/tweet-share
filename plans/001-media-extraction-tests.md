# Plan 001: Media extraction characterization tests

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/04-video.js userscript/src/06-syndication.js userscript/src/07-extract-dom.js userscript/src/03-network-capture.js tests/`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `ac922cf`, 2026-05-26

## Why this matters

Media handling spans DOM scraping, passive GraphQL capture, syndication fallback, and Discord formatting — but **only formatting is tested** today. Recent media work (v0.6.9–v0.6.12) iterated quickly on video follow-ups and supplemental image embeds without extraction fixtures. Any attachment-upload or syndication work (plans 002–003) will break silently without characterization tests for `extractMedia`, `mediaFromLegacyTweet`, `tweetFromSyndication`, and `enrichTweetMedia`.

## Current state

**Pipeline (share flow):**

1. `userscript/src/07-extract-dom.js` — `extractMedia(article)` reads `[data-testid="tweetPhoto"] img` and `<video>` nodes.
2. `userscript/src/03-network-capture.js` — intercepts GraphQL responses → `mediaFromLegacyTweet`, `cacheVideoVariants`.
3. `userscript/src/06-syndication.js` — `enrichTweetMedia` fetches `cdn.syndication.twimg.com/tweet-result` and merges media.
4. `userscript/src/04-video.js` — `nearestPlayableVideoUrl`, `directPlayableVideoUrls`.
5. `userscript/src/05-format-discord.js` — consumes normalized `tweet.media[]` (already tested in `tests/format-discord.test.mjs`).

**DOM extraction (images use raw `img.src`, may be lower-res than API URLs):**

```43:58:userscript/src/07-extract-dom.js
function extractMedia(article, excludedNodes = []) {
  const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
    .filter((img) => !isInsideExcludedNode(img, excludedNodes))
    .filter((img) => !isTweetVideoThumbnailUrl(img.src))
    .map((img) => ({ type: "image", url: img.src, alt: img.alt || "" }));

  const videos = [...article.querySelectorAll("video")]
    .filter((video) => !isInsideExcludedNode(video, excludedNodes))
    .map((video) => ({
      type: "video",
      url: nearestPlayableVideoUrl(video),
      posterUrl: isTweetVideoPosterUrl(video.poster) ? video.poster : "",
      alt: ""
    }));

  return uniqueMedia([...images, ...videos]);
}
```

**Syndication collapses to a single video entry:**

```45:47:userscript/src/06-syndication.js
  const videoUrl = normalizeTweetVideoUrl(bestSyndicationVideoUrl(data));
  const posterUrl = syndicationPosterUrl(data);
  const videos = videoUrl || posterUrl ? [{ type: "video", url: videoUrl, posterUrl, alt: "" }] : [];
```

**Test harness pattern** (follow this — VM context loading specific source files):

```11:22:tests/format-discord.test.mjs
function loadFormatContext() {
  const files = ["00-config.js", "02-utils.js", "04-video.js", "05-format-discord.js"];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = {
    console,
    location: { href: "https://x.com/" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] }
  };
  runInNewContext(`${code}\nthis.exports = { ... };`, context);
  return context.exports;
}
```

**Conventions:** plain functions in numbered `userscript/src/*.js` files; no imports; `node --test tests/*.test.mjs`; build via `npm run build`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0, all tests pass |
| Build + syntax | `npm run check` | exit 0 |
| Single file | `node --test tests/media-extraction.test.mjs` | exit 0 |

## Scope

**In scope:**

- `tests/media-extraction.test.mjs` (create)
- `tests/fixtures/syndication/` (create JSON fixtures)
- `tests/fixtures/dom/` (create minimal HTML snippets or JS DOM stubs)
- `tests/preferences.test.mjs` (fix failing assertion so full suite passes)

**Out of scope:**

- `userscript/src/05-format-discord.js` — already covered; do not duplicate format tests here.
- `userscript/src/08-deliver.js`, `01-http.js` — delivery/upload (plan 002).
- Changing extraction logic — this plan adds tests only; behavior changes belong in plan 003.

## Git workflow

- Branch: `advisor/001-media-extraction-tests`
- Commit message style: imperative, match repo — e.g. `Add media extraction characterization tests`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix preferences test baseline

In `tests/preferences.test.mjs`, line 41 compares `sanitizePreferences(null)` to `DEFAULT_PREFERENCES` by reference. Change to:

```javascript
assert.deepEqual(sanitizePreferences(null), { ...DEFAULT_PREFERENCES });
```

**Verify**: `node --test tests/preferences.test.mjs` → exit 0, 2 tests pass.

### Step 2: Create syndication JSON fixtures

Create `tests/fixtures/syndication/video-plus-photos.json` — minimal object shaped like syndication `tweet-result` with:

- `text`, `user` (name + screen_name), `id_str`
- `photos`: array of 2+ `{ url }` entries
- `video`: `{ poster, variants: [{ type: "video/mp4", src, bitrate }] }`
- `mediaDetails`: mix of `type: "photo"` and optional `video_info.variants`

Create `tests/fixtures/syndication/quote-parent.json` — tweet with no media (for quote merge tests).

Do not copy real tweet text verbatim from live posts; use synthetic placeholder text.

**Verify**: `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/syndication/video-plus-photos.json'))"` → exit 0.

### Step 3: Add `tests/media-extraction.test.mjs`

Load modules: `00-config.js`, `02-utils.js`, `03-network-capture.js`, `04-video.js`, `06-syndication.js`, `07-extract-dom.js` (in that order).

Export from VM context (functions must exist after load):

- `mediaFromLegacyTweet`, `scanForVideoVariants`, `tweetFromSyndication`, `bestSyndicationVideoUrl`, `uniqueMedia`
- `extractMedia`, `nearestPlayableVideoUrl` (with mocked `document` / `performance`)
- `isPlayableTweetVideoUrl`, `normalizeTweetVideoUrl`

**Test cases (minimum):**

1. **`mediaFromLegacyTweet` — photo + video** — legacy object with `extended_entities.media` containing one `photo` and one `video` with `video_info.variants`; assert 2 media items, video URL matches highest-bitrate MP4, poster set.
2. **`scanForVideoVariants` populates cache** — call with nested object containing `video_info.variants` and poster URL; assert `VIDEO_VARIANT_CACHE` has entry; `bestCachedVideoUrlForTweet` returns URL (load `04-video.js` helpers).
3. **`tweetFromSyndication` — multiple photos** — load fixture from step 2; assert `imageMedia(tweet).length >= 2` (define local `imageMedia` copy or export it from loaded code via `04-video.js`).
4. **`tweetFromSyndication` — single video** — assert one `type: "video"` with playable MP4 URL and poster.
5. **`extractMedia` — DOM stub** — build a minimal `article` object tree (plain JS objects with `querySelectorAll` returning arrays of fake `img`/`video` nodes) mimicking one image + one video; assert `uniqueMedia` length and that video thumbnail URLs are filtered from images.
6. **`nearestPlayableVideoUrl`** — video stub with `currentSrc` set to valid `https://video.twimg.com/...mp4`; assert returned URL passes `isPlayableTweetVideoUrl`.

Mock `request` in syndication tests: replace `fetchSyndicationTweet` by testing `tweetFromSyndication` and `bestSyndicationVideoUrl` directly with fixture JSON (no network).

**Verify**: `node --test tests/media-extraction.test.mjs` → exit 0, at least 6 tests pass.

### Step 4: Document fixture capture workflow

Add a short comment block at top of `tests/media-extraction.test.mjs` (not a new markdown file) explaining how a maintainer can refresh fixtures:

- Syndication: `GET https://cdn.syndication.twimg.com/tweet-result?id=<tweetId>&lang=en` (public, no auth) → save redacted JSON.
- DOM: DevTools → copy outer HTML of `[data-testid="tweet"]` → strip scripts, store under `tests/fixtures/dom/` when needed later.

**Verify**: comment exists; `npm test` → exit 0.

## Test plan

- New file: `tests/media-extraction.test.mjs` — cases listed in step 3.
- Pattern: `tests/format-discord.test.mjs` VM loader.
- Fix: `tests/preferences.test.mjs` spread fix.
- **Verification**: `npm test` → 18+ tests pass (10 existing format + 2 preferences + 6+ new).

## Done criteria

- [ ] `npm test` exits 0
- [ ] `npm run check` exits 0
- [ ] `tests/media-extraction.test.mjs` exists with ≥6 tests covering syndication + DOM + legacy API paths
- [ ] `tests/fixtures/syndication/` contains at least one multi-photo + video fixture
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row for 001 updated to DONE

## STOP conditions

- `07-extract-dom.js` or `06-syndication.js` exports have changed names — stop and list actual function names.
- VM load fails due to missing globals — stop and list the error; do not patch production code to make tests pass in this plan.
- Fixture syndication JSON shape does not match what `tweetFromSyndication` reads — stop and report which fields are absent.

## Maintenance notes

- When plan 003 changes syndication merging, update fixtures and expectations here first.
- When plan 002 adds attachment download, add integration-style tests that mock byte fetch separately (not in this plan).
- Reviewers: ensure tests assert **behavior** (counts, URL patterns, types) not full payload snapshots that churn on every Twitter CDN tweak.
