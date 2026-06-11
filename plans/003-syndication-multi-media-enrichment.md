# Plan 003: Syndication multi-media enrichment

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac922cf..HEAD -- userscript/src/06-syndication.js userscript/src/07-extract-dom.js userscript/src/02-utils.js tests/media-extraction.test.mjs`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-media-extraction-tests.md
- **Category**: correctness
- **Planned at**: commit `ac922cf`, 2026-05-26

## Why this matters

Even with attachment upload (plan 002), garbage in → garbage out. Syndication and DOM paths currently **drop or collapse** media items:

- `tweetFromSyndication` builds at most **one** video object even when `mediaDetails` lists multiple videos.
- Photos are merged from both `photos` and `mediaDetails` but video entries in `mediaDetails` are ignored (only `type === "photo"` is mapped).
- `enrichTweetMedia` patches the first video slot only instead of reconciling the full media list.
- DOM `extractMedia` uses `img.src` which is often a Twitter-resized URL, not `?format=jpg&name=orig` or syndication `media_url_https`.

For multi-image + video tweets (the Faytuks example), missing images or wrong video URL forces supplemental embeds and link fallbacks to look even worse.

## Current state

**Photos + single video in syndication:**

```37:59:userscript/src/06-syndication.js
  const photos = (data.photos || []).map((photo) => ({
    type: "image",
    url: photo.url || photo.media_url_https || "",
    alt: photo.alt_text || ""
  }));
  const mediaDetails = (data.mediaDetails || [])
    .filter((media) => media.type === "photo" && media.media_url_https)
    .map((media) => ({ type: "image", url: media.media_url_https, alt: media.ext_alt_text || "" }));
  const videoUrl = normalizeTweetVideoUrl(bestSyndicationVideoUrl(data));
  const posterUrl = syndicationPosterUrl(data);
  const videos = videoUrl || posterUrl ? [{ type: "video", url: videoUrl, posterUrl, alt: "" }] : [];

  return {
    ...
    media: uniqueMedia([...photos, ...mediaDetails, ...videos, ...(fallback.media || [])]),
```

**`enrichTweetMedia` only updates first video:**

```90:99:userscript/src/06-syndication.js
  if (cachedVideoUrl || videoUrl) {
    const media = tweet.media || [];
    const existingVideo = media.find((item) => item.type === "video");
    if (existingVideo) {
      existingVideo.url = cachedVideoUrl || videoUrl;
      existingVideo.posterUrl = existingVideo.posterUrl || posterUrl;
    } else {
      media.push({ type: "video", url: cachedVideoUrl || videoUrl, posterUrl, alt: "" });
    }
    tweet.media = media;
  }
```

**Legacy API path already handles multiple items correctly** — use as exemplar:

```49:75:userscript/src/03-network-capture.js
function mediaFromLegacyTweet(legacy) {
  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  return uniqueMedia(media.flatMap((item) => {
    if (item.type === "photo") { ... }
    if (item.video_info?.variants) { ... return [{ type: "video", ... }]; }
    return [];
  }));
}
```

**High-res image helper** — add to `02-utils.js` if not present:

```javascript
function highResolutionTweetImageUrl(url) {
  if (!url || !/pbs\.twimg\.com\/media\//.test(url)) return url;
  const base = url.split("?")[0];
  return `${base}?format=jpg&name=orig`;
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests | `npm test` | exit 0 |
| Build | `npm run check` | exit 0 |

## Scope

**In scope:**

- `userscript/src/06-syndication.js` — refactor media extraction from syndication payload
- `userscript/src/02-utils.js` — `highResolutionTweetImageUrl` (if new)
- `userscript/src/07-extract-dom.js` — apply high-res helper to image URLs from DOM
- `tests/media-extraction.test.mjs` — extend cases from plan 001

**Out of scope:**

- `05-format-discord.js` formatting changes
- Attachment upload (`08-deliver.js`, plan 002)
- New network APIs beyond existing syndication endpoint

## Git workflow

- Branch: `advisor/003-syndication-multi-media`
- Commit: `Improve syndication and DOM media enrichment`
- Do NOT push unless instructed

## Steps

### Step 1: Add `mediaFromSyndication(data)` in `06-syndication.js`

Extract a function parallel to `mediaFromLegacyTweet`:

1. Map all `data.photos` to images (high-res URL).
2. For each `data.mediaDetails` entry:
   - `photo` → image with `media_url_https`
   - `video` / `animated_gif` with `video_info.variants` → video with best MP4 + poster from `media_url_https`
3. If top-level `data.video` exists, merge as additional video (do not replace others).
4. Return `uniqueMedia([...])`.

Replace inline photo/video assembly in `tweetFromSyndication` with `mediaFromSyndication(data)`.

**Verify**: `node --test tests/media-extraction.test.mjs` → syndication multi-photo + multi-video cases pass.

### Step 2: Fix `enrichTweetMedia` merge strategy

Instead of patching only `existingVideo`:

```javascript
const syndicationMedia = data ? mediaFromSyndication(data) : [];
tweet.media = mergeTweetMedia(syndicationMedia, tweet.media, {
  cachedVideoUrl,
  videoUrl,
  posterUrl
});
```

Implement `mergeTweetMedia` in `06-syndication.js` or `02-utils.js`:

- Prefer syndication URLs when DOM URL is empty or non-playable for videos
- Prefer higher-resolution image URL when same media key (match `pbs.twimg.com/media/<id>`)
- Preserve DOM-only items not in syndication
- Order: stable — photos in syndication order, then videos

**Verify**: tests for merge when DOM has 1 image and syndication has 3.

### Step 3: High-res DOM images

In `07-extract-dom.js` `extractMedia`:

```javascript
.map((img) => ({
  type: "image",
  url: highResolutionTweetImageUrl(img.src),
  alt: img.alt || ""
}));
```

**Verify**: test with stub `img.src` `https://pbs.twimg.com/media/Abcd.jpg:small` → expect `name=orig` in output URL.

### Step 4: Extend fixtures

Add `tests/fixtures/syndication/multi-video.json` if syndication can return 2+ videos (or synthetic `mediaDetails` array with 2 video entries). Update tests.

**Verify**: `npm test` → exit 0.

## Test plan

- Extend `tests/media-extraction.test.mjs`:
  - `mediaFromSyndication` returns N images + M videos from fixture
  - `mergeTweetMedia` keeps all images when syndication has more than DOM
  - DOM high-res transform
- **Verification**: `npm test` → exit 0; `npm run check` → exit 0

## Done criteria

- [ ] `mediaFromSyndication` handles photos and videos from `mediaDetails` (not photos-only filter)
- [ ] `enrichTweetMedia` no longer uses `media.find` single-video patch as sole merge
- [ ] DOM images use `highResolutionTweetImageUrl`
- [ ] Plan 001 tests updated and passing
- [ ] `npm test` && `npm run check` exit 0
- [ ] `plans/README.md` plan 003 → DONE

## STOP conditions

- Live syndication JSON for test tweet IDs lacks `mediaDetails` (only `video` + `photos`) — document actual shape; do not invent fields. Merging `photos` + `video` may be sufficient for the example tweet.
- `name=orig` URLs 403 in browser — stop and report; keep `large` or `4096x4096` variant instead.
- Merge logic requires changing `05-format-discord.js` — stop (out of scope).

## Maintenance notes

- Syndication schema is undocumented; keep fixtures so API drift is caught in CI.
- When plan 002 downloads attachments, better URLs here directly improve file quality.
- Reviewers: watch for duplicate images when both `photos` and `mediaDetails` list the same `media_url_https` — `uniqueMedia` must dedupe.
