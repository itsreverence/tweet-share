import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

/*
Fixture refresh notes:
Syndication fixtures can be refreshed with
GET https://cdn.syndication.twimg.com/tweet-result?id=<tweetId>&lang=en, then saved
as redacted JSON. DOM fixtures can be refreshed from DevTools by copying the outer
HTML of [data-testid="tweet"], stripping scripts, and storing it under
tests/fixtures/dom/ when an HTML fixture becomes useful.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");
const fixtureDir = path.join(root, "tests", "fixtures", "syndication");

function loadMediaContext() {
  const files = [
    "00-config.js",
    "02-utils.js",
    "03-network-capture.js",
    "04-video.js",
    "05-format-discord.js",
    "06-syndication.js",
    "07-extract-dom.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = createContext({
    console,
    URL,
    location: { href: "https://x.com/fixture_author/status/1000000000000000001" },
    performance: { getEntriesByType: () => [] },
    document: {
      querySelectorAll() {
        return [];
      }
    },
    request: () => Promise.resolve(null)
  });
  runInNewContext(`${code}\nthis.exports = {
    mediaFromLegacyTweet,
    scanForVideoVariants,
    mediaFromSyndication,
    mergeTweetMedia,
    tweetFromSyndication,
    enrichTweetMedia,
    bestSyndicationVideoUrl,
    uniqueMedia,
    extractMedia,
    extractTweet,
    extractQuote,
    extractText,
    normalizeTweetBodyText,
    tweetUrlFromArticle,
    nearestPlayableVideoUrl,
    isPlayableTweetVideoUrl,
    normalizeTweetVideoUrl,
    highResolutionTweetImageUrl,
    bestCachedVideoUrlForTweet,
    imageMedia,
    VIDEO_VARIANT_CACHE,
    TWEET_CACHE,
    bestCachedTweetForQuote,
    cacheTweetResult
  };`, context);
  return context.exports;
}

const {
  mediaFromLegacyTweet,
  scanForVideoVariants,
  mediaFromSyndication,
  mergeTweetMedia,
  tweetFromSyndication,
  enrichTweetMedia,
  bestSyndicationVideoUrl,
  uniqueMedia,
  extractMedia,
  extractTweet,
  extractQuote,
  extractText,
  normalizeTweetBodyText,
  tweetUrlFromArticle,
  nearestPlayableVideoUrl,
  isPlayableTweetVideoUrl,
  normalizeTweetVideoUrl,
  highResolutionTweetImageUrl,
  bestCachedVideoUrlForTweet,
  imageMedia,
  VIDEO_VARIANT_CACHE,
  TWEET_CACHE,
  bestCachedTweetForQuote,
  cacheTweetResult
} = loadMediaContext();

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));
}

function fakeNode(fields = {}) {
  return {
    contains(node) {
      return node === this;
    },
    querySelectorAll() {
      return [];
    },
    ...fields
  };
}

test("mediaFromLegacyTweet extracts photo and highest bitrate video", () => {
  const legacy = {
    extended_entities: {
      media: [
        {
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/photo.jpg",
          ext_alt_text: "Synthetic photo"
        },
        {
          type: "video",
          media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg",
          ext_alt_text: "Synthetic video",
          video_info: {
            variants: [
              {
                content_type: "application/x-mpegURL",
                url: "https://video.twimg.com/ext_tw_video/123/pu/pl/playlist.m3u8"
              },
              {
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/123/pu/vid/640x360/low.mp4",
                bitrate: 832000
              },
              {
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/high.mp4",
                bitrate: 2176000
              }
            ]
          }
        }
      ]
    }
  };

  const media = mediaFromLegacyTweet(legacy);
  assert.equal(media.length, 2);
  assert.deepEqual({ ...media[0] }, {
    type: "image",
    url: "https://pbs.twimg.com/media/photo.jpg",
    alt: "Synthetic photo"
  });
  assert.equal(media[1].type, "video");
  assert.equal(media[1].url, "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/high.mp4");
  assert.equal(media[1].posterUrl, "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg");
});

test("scanForVideoVariants populates cache for bestCachedVideoUrlForTweet", () => {
  VIDEO_VARIANT_CACHE.clear();
  scanForVideoVariants({
    media: {
      id_str: "456",
      media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/poster.jpg",
      video_info: {
        variants: [
          {
            content_type: "video/mp4",
            url: "https://video.twimg.com/ext_tw_video/456/pu/vid/640x360/low.mp4",
            bitrate: 832000
          },
          {
            content_type: "video/mp4",
            url: "https://video.twimg.com/ext_tw_video/456/pu/vid/1280x720/high.mp4",
            bitrate: 2176000
          }
        ]
      }
    }
  });

  assert.equal(VIDEO_VARIANT_CACHE.has("456"), true);
  assert.equal(
    bestCachedVideoUrlForTweet({
      media: [{ type: "video", posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/poster.jpg" }]
    }),
    "https://video.twimg.com/ext_tw_video/456/pu/vid/1280x720/high.mp4"
  );
});

test("tweetFromSyndication preserves multiple photos", () => {
  const tweet = tweetFromSyndication(readFixture("video-plus-photos.json"));
  assert.ok(imageMedia(tweet).length >= 2);
  assert.ok(tweet.media.some((item) => item.url === "https://pbs.twimg.com/media/photo-one.jpg?format=jpg&name=orig"));
  assert.ok(tweet.media.some((item) => item.url === "https://pbs.twimg.com/media/photo-two.jpg?format=jpg&name=orig"));
});

test("tweetFromSyndication emits playable videos with posters", () => {
  const data = readFixture("video-plus-photos.json");
  const tweet = tweetFromSyndication(data);
  const videos = tweet.media.filter((item) => item.type === "video");

  assert.equal(videos.length, 1);
  assert.equal(videos.some((video) => video.url === bestSyndicationVideoUrl(data)), true);
  assert.equal(videos.every((video) => isPlayableTweetVideoUrl(video.url)), true);
  assert.equal(videos.some((video) => video.posterUrl === "https://pbs.twimg.com/ext_tw_video_thumb/1000000000000000001/pu/img/poster.jpg"), true);
});

test("mediaFromSyndication returns images and multiple videos from mediaDetails", () => {
  const media = mediaFromSyndication(readFixture("multi-video.json"));
  const images = media.filter((item) => item.type === "image");
  const videos = media.filter((item) => item.type === "video");

  assert.equal(images.length, 1);
  assert.equal(images[0].url, "https://pbs.twimg.com/media/multi-photo.jpg?format=jpg&name=orig");
  assert.equal(videos.length, 3);
  assert.ok(videos.some((video) => video.url === "https://video.twimg.com/ext_tw_video/2000000000000000001/pu/vid/1280x720/one-high.mp4"));
  assert.ok(videos.some((video) => video.url === "https://video.twimg.com/tweet_video/2000000000000000002/pu/vid/640x360/two.mp4"));
  assert.ok(videos.some((video) => video.url === "https://video.twimg.com/ext_tw_video/2000000000000000003/pu/vid/1280x720/three.mp4"));
});

test("mergeTweetMedia prefers syndication media while preserving DOM-only items", () => {
  const merged = mergeTweetMedia(
    [
      { type: "image", url: "https://pbs.twimg.com/media/shared.jpg", alt: "Syndication shared" },
      { type: "image", url: "https://pbs.twimg.com/media/extra-one.jpg", alt: "" },
      { type: "image", url: "https://pbs.twimg.com/media/extra-two.jpg", alt: "" },
      {
        type: "video",
        url: "https://video.twimg.com/ext_tw_video/321/pu/vid/1280x720/syndication.mp4",
        posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/321/pu/img/poster.jpg",
        alt: ""
      }
    ],
    [
      { type: "image", url: "https://pbs.twimg.com/media/shared.jpg?format=jpg&name=small", alt: "DOM shared" },
      { type: "video", url: "", posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/321/pu/img/poster.jpg", alt: "" },
      { type: "image", url: "https://pbs.twimg.com/media/dom-only.jpg", alt: "DOM only" }
    ]
  );

  const images = merged.filter((item) => item.type === "image");
  const videos = merged.filter((item) => item.type === "video");
  assert.deepEqual(Array.from(images, (item) => item.url), [
    "https://pbs.twimg.com/media/shared.jpg?format=jpg&name=orig",
    "https://pbs.twimg.com/media/extra-one.jpg?format=jpg&name=orig",
    "https://pbs.twimg.com/media/extra-two.jpg?format=jpg&name=orig",
    "https://pbs.twimg.com/media/dom-only.jpg?format=jpg&name=orig"
  ]);
  assert.equal(images[0].alt, "Syndication shared");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].url, "https://video.twimg.com/ext_tw_video/321/pu/vid/1280x720/syndication.mp4");
});

test("extractMedia reads DOM image and video nodes while filtering thumbnails", () => {
  const image = fakeNode({
    src: "https://pbs.twimg.com/media/dom-photo.jpg:small",
    alt: "DOM photo"
  });
  const thumbnail = fakeNode({
    src: "https://pbs.twimg.com/ext_tw_video_thumb/789/pu/img/thumb.jpg",
    alt: "Video thumbnail"
  });
  const video = fakeNode({
    currentSrc: "https://video.twimg.com/ext_tw_video/789/pu/vid/1280x720/dom-video.mp4",
    src: "",
    poster: "https://pbs.twimg.com/ext_tw_video_thumb/789/pu/img/poster.jpg"
  });
  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === '[data-testid="tweetPhoto"] img') return [image, thumbnail];
      if (selector === "video") return [video];
      return [];
    }
  });

  const media = extractMedia(article);
  assert.equal(media.length, 2);
  assert.deepEqual({ ...media[0] }, {
    type: "image",
    url: "https://pbs.twimg.com/media/dom-photo.jpg?format=jpg&name=orig",
    alt: "DOM photo"
  });
  assert.equal(media[1].type, "video");
  assert.equal(media[1].url, "https://video.twimg.com/ext_tw_video/789/pu/vid/1280x720/dom-video.mp4");
  assert.equal(media[1].posterUrl, "https://pbs.twimg.com/ext_tw_video_thumb/789/pu/img/poster.jpg");
  assert.equal(uniqueMedia(media).length, 2);
});

test("extractMedia reads pbs media images when tweetPhoto wrappers are absent", () => {
  const image = fakeNode({
    src: "https://pbs.twimg.com/media/dom-photo-no-wrapper.jpg?format=jpg&name=small",
    alt: "DOM photo without wrapper"
  });
  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === '[data-testid="tweetPhoto"] img') return [];
      if (selector === 'img[src*="pbs.twimg.com/media/"]') return [image];
      if (selector === "video") return [];
      return [];
    }
  });

  const media = extractMedia(article);
  assert.equal(media.length, 1);
  assert.equal(media[0].type, "image");
  assert.equal(media[0].url, "https://pbs.twimg.com/media/dom-photo-no-wrapper.jpg?format=jpg&name=orig");
  assert.equal(media[0].alt, "DOM photo without wrapper");
});

test("extractMedia ignores small and SVG fallback media images", () => {
  const smallInlineImage = fakeNode({
    src: "https://pbs.twimg.com/media/tiny-inline.jpg?format=jpg&name=small",
    alt: "inline icon",
    naturalWidth: 48,
    naturalHeight: 48
  });
  const svgInlineImage = fakeNode({
    src: "https://pbs.twimg.com/media/inline-badge.svg",
    alt: "inline svg",
    naturalWidth: 120,
    naturalHeight: 120
  });
  const realFallbackImage = fakeNode({
    src: "https://pbs.twimg.com/media/real-fallback.jpg?format=jpg&name=small",
    alt: "real fallback image",
    naturalWidth: 640,
    naturalHeight: 360
  });
  const video = fakeNode({
    currentSrc: "https://video.twimg.com/ext_tw_video/790/pu/vid/1280x720/dom-video.mp4",
    src: "",
    poster: "https://pbs.twimg.com/ext_tw_video_thumb/790/pu/img/poster.jpg"
  });
  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === '[data-testid="tweetPhoto"] img') return [];
      if (selector === 'img[src*="pbs.twimg.com/media/"]') return [smallInlineImage, svgInlineImage, realFallbackImage];
      if (selector === "video") return [video];
      return [];
    }
  });

  const media = extractMedia(article);
  assert.equal(media.some((item) => /tiny-inline|inline-badge/.test(item.url)), false);
  assert.equal(media.some((item) => item.url === "https://pbs.twimg.com/media/real-fallback.jpg?format=jpg&name=orig"), true);
  assert.equal(media.some((item) => item.url === "https://video.twimg.com/ext_tw_video/790/pu/vid/1280x720/dom-video.mp4"), true);
});

test("network capture caches image-only tweet results with empty text", () => {
  TWEET_CACHE.clear();
  scanForVideoVariants({
    data: {
      tweetResult: {
        result: {
          rest_id: "300",
          legacy: {
            full_text: "",
            created_at: "Tue Jun 30 12:00:00 +0000 2026",
            extended_entities: {
              media: [{
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/image-only.jpg",
                ext_alt_text: "Image-only post"
              }]
            }
          },
          core: {
            user_results: {
              result: {
                legacy: {
                  name: "Image Author",
                  screen_name: "image_author",
                  profile_image_url_https: "https://pbs.twimg.com/profile_images/a_normal.jpg"
                }
              }
            }
          }
        }
      }
    }
  });

  const cached = TWEET_CACHE.get("300");
  assert.ok(cached);
  assert.equal(cached.text, "");
  assert.equal(cached.media.length, 1);
  assert.equal(cached.media[0].url, "https://pbs.twimg.com/media/image-only.jpg");
});

test("network capture caches tweet results when user data was seen separately", () => {
  TWEET_CACHE.clear();
  scanForVideoVariants([
    {
      rest_id: "42",
      legacy: {
        name: "Separate User",
        screen_name: "separate_user",
        profile_image_url_https: "https://pbs.twimg.com/profile_images/u_normal.jpg"
      }
    },
    {
      rest_id: "302",
      legacy: {
        full_text: "Tweet with separate user payload",
        user_id_str: "42",
        extended_entities: {
          media: [{
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/separate-user.jpg"
          }]
        }
      }
    }
  ]);

  const cached = TWEET_CACHE.get("302");
  assert.ok(cached);
  assert.equal(cached.author.username, "separate_user");
  assert.equal(cached.media.length, 1);
  assert.equal(cached.media[0].url, "https://pbs.twimg.com/media/separate-user.jpg");
});

test("mergeTweetMedia preserves fallback video poster metadata for duplicate URLs", () => {
  const videoUrl = "https://video.twimg.com/ext_tw_video/321/pu/vid/1280x720/shared.mp4";
  const merged = mergeTweetMedia(
    [{ type: "video", url: videoUrl, posterUrl: "", alt: "" }],
    [{ type: "video", url: videoUrl, posterUrl: "https://pbs.twimg.com/ext_tw_video_thumb/321/pu/img/poster.jpg", alt: "poster alt" }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, videoUrl);
  assert.equal(merged[0].posterUrl, "https://pbs.twimg.com/ext_tw_video_thumb/321/pu/img/poster.jpg");
  assert.equal(merged[0].alt, "poster alt");
});

test("enrichTweetMedia merges cached image-only media when syndication is empty", async () => {
  TWEET_CACHE.clear();
  cacheTweetResult({
    rest_id: "301",
    legacy: {
      full_text: "",
      extended_entities: {
        media: [{
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/cached-image-only.jpg",
          ext_alt_text: "Cached image"
        }]
      }
    },
    core: {
      user_results: {
        result: {
          legacy: {
            name: "Cached Author",
            screen_name: "cached_author",
            profile_image_url_https: "https://pbs.twimg.com/profile_images/c_normal.jpg"
          }
        }
      }
    }
  });

  const tweet = await enrichTweetMedia({
    url: "https://x.com/cached_author/status/301",
    author: { displayName: "Cached Author", username: "cached_author", avatarUrl: "" },
    text: "",
    media: [],
    createdAt: "",
    quote: null
  });

  assert.equal(tweet.media.length, 1);
  assert.equal(tweet.media[0].url, "https://pbs.twimg.com/media/cached-image-only.jpg?format=jpg&name=orig");
});

test("nearestPlayableVideoUrl returns a playable currentSrc URL", () => {
  const url = "https://video.twimg.com/ext_tw_video/999/pu/vid/1280x720/current.mp4";
  const result = nearestPlayableVideoUrl(fakeNode({ currentSrc: url, src: "", poster: "" }));

  assert.equal(result, normalizeTweetVideoUrl(url));
  assert.equal(isPlayableTweetVideoUrl(result), true);
});

test("nearestPlayableVideoUrl does not borrow unrelated page videos when poster matching fails", () => {
  const unrelated = "https://video.twimg.com/ext_tw_video/111/pu/vid/1280x720/other-tweet.mp4";
  const context = createContext({
    console,
    URL,
    location: { href: "https://x.com/" },
    performance: {
      getEntriesByType() {
        return [{ name: unrelated }];
      }
    },
    document: {
      querySelectorAll(selector) {
        if (selector === "video source[src], video[src]") {
          return [{ src: unrelated, getAttribute: () => unrelated }];
        }
        return [];
      }
    },
    request: () => Promise.resolve(null)
  });
  const files = [
    "00-config.js",
    "02-utils.js",
    "03-network-capture.js",
    "04-video.js",
    "05-format-discord.js",
    "06-syndication.js",
    "07-extract-dom.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  runInNewContext(`${code}\nthis.result = nearestPlayableVideoUrl({
    currentSrc: "",
    src: "",
    poster: "https://pbs.twimg.com/ext_tw_video_thumb/222/pu/img/unmatched.jpg",
    querySelectorAll() { return []; }
  });`, context);

  assert.equal(context.result, "");
});

test("extractTweet excludes quoted text and media from the main tweet", () => {
  const quoteTextNode = fakeNode({ innerText: "Quoted body" });
  const mainTextNode = fakeNode({ innerText: "Main body" });
  const quoteImage = fakeNode({ src: "https://pbs.twimg.com/media/quote.jpg", alt: "quote" });
  const mainImage = fakeNode({ src: "https://pbs.twimg.com/media/main.jpg", alt: "main" });
  const quoteContainer = fakeNode({
    contains(node) {
      return node === quoteContainer || node === quoteTextNode || node === quoteImage;
    },
    querySelectorAll(selector) {
      if (selector === '[data-testid="tweetText"]') return [quoteTextNode];
      if (selector === 'a[href*="/status/"]') {
        return [{ href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }];
      }
      if (selector === '[role="link"]' || selector === '[data-testid="card.wrapper"]') return [];
      if (selector === '[data-testid="tweetPhoto"] img') return [quoteImage];
      if (selector === "video") return [];
      return [];
    }
  });
  quoteContainer.querySelector = (selector) => {
    if (selector === '[data-testid="tweetText"]') return quoteTextNode;
    return null;
  };

  const article = fakeNode({
    contains(node) {
      return node === article || node === mainTextNode || node === mainImage || quoteContainer.contains(node);
    },
    querySelector(selector) {
      if (selector === "time") return { getAttribute: () => "2026-06-10T12:00:00.000Z" };
      if (selector === '[data-testid="User-Name"]') return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') {
        return [
          { href: "https://x.com/alice/status/1", getAttribute: () => "/alice/status/1" },
          { href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }
        ];
      }
      if (selector === '[data-testid="tweetText"]') return [mainTextNode, quoteTextNode];
      if (selector === '[data-testid="tweetPhoto"] img') return [mainImage, quoteImage];
      if (selector === "video") return [];
      if (selector === '[role="link"]') return [quoteContainer];
      if (selector === '[data-testid="card.wrapper"]') return [];
      return [];
    }
  });

  const tweet = extractTweet(article);
  assert.equal(tweet.url, "https://x.com/alice/status/1");
  assert.equal(tweet.text, "Main body");
  assert.equal(tweet.media.length, 1);
  assert.equal(tweet.media[0].url, "https://pbs.twimg.com/media/main.jpg?format=jpg&name=orig");
  assert.ok(tweet.quote);
  assert.equal(tweet.quote.url, "https://x.com/bob/status/2");
  assert.equal(tweet.quote.text, "Quoted body");
});

test("extractTweet identifies the timestamp permalink when the quoted link appears first", () => {
  const quoteUrl = "https://x.com/tenobrus/status/2079661246580973865";
  const mainUrl = "https://x.com/theo/status/2079662956628127954";
  const quoteLink = fakeNode({ href: quoteUrl, getAttribute: () => "/tenobrus/status/2079661246580973865" });
  const mainLink = fakeNode({
    href: mainUrl,
    getAttribute: () => "/theo/status/2079662956628127954",
    querySelector(selector) {
      return selector === "time" ? fakeNode() : null;
    }
  });
  const mainTextNode = fakeNode({ innerText: "Main post text" });
  const quoteTextNode = fakeNode({ innerText: "Distinct quoted post text" });
  const quoteImages = ["one", "two", "three"].map((name) =>
    fakeNode({ src: `https://pbs.twimg.com/media/${name}.jpg`, alt: name })
  );
  const quoteContainer = fakeNode({
    contains(node) {
      return node === quoteContainer || node === quoteTextNode || quoteImages.includes(node);
    },
    querySelector(selector) {
      return selector === '[data-testid="tweetText"]' ? quoteTextNode : null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return [quoteLink];
      if (selector === '[data-testid="tweetText"]') return [quoteTextNode];
      if (selector === '[data-testid="tweetPhoto"] img') return quoteImages;
      if (selector === 'img[src*="pbs.twimg.com/media/"]' || selector === "video") return [];
      return [];
    }
  });
  const broadClickableContainer = fakeNode({
    contains(node) {
      return node === broadClickableContainer || node === mainTextNode || quoteContainer.contains(node);
    },
    querySelector(selector) {
      return selector === '[data-testid="tweetText"]' ? mainTextNode : null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return [quoteLink, mainLink];
      if (selector === '[data-testid="tweetText"]') return [mainTextNode, quoteTextNode];
      return [];
    }
  });
  const article = fakeNode({
    contains(node) {
      return node === article || broadClickableContainer.contains(node);
    },
    querySelector(selector) {
      if (selector === "time") return fakeNode({ getAttribute: () => "2026-07-21T00:00:00.000Z" });
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return [quoteLink, mainLink];
      if (selector === '[role="link"]') return [broadClickableContainer, quoteContainer];
      if (selector === '[data-testid="card.wrapper"]') return [];
      if (selector === '[data-testid="tweetText"]') return [mainTextNode, quoteTextNode];
      if (selector === '[data-testid="tweetPhoto"] img') return quoteImages;
      if (selector === 'img[src*="pbs.twimg.com/media/"]' || selector === "video") return [];
      return [];
    }
  });

  const tweet = extractTweet(article);

  assert.equal(tweet.url, mainUrl);
  assert.equal(tweet.text, "Main post text");
  assert.equal(tweet.media.length, 0);
  assert.equal(tweet.quote.url, quoteUrl);
  assert.equal(tweet.quote.text, "Distinct quoted post text");
  assert.equal(tweet.quote.media.length, 3);
});

test("extractQuote merges cached media with DOM media instead of replacing it", () => {
  TWEET_CACHE.clear();
  cacheTweetResult({
    rest_id: "2",
    legacy: {
      full_text: "Cached quoted body",
      extended_entities: {
        media: [{
          type: "video",
          media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/2/pu/img/poster.jpg",
          video_info: {
            variants: [{
              content_type: "video/mp4",
              url: "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4",
              bitrate: 2176000
            }]
          }
        }]
      }
    },
    core: {
      user_results: {
        result: {
          legacy: { name: "Bob", screen_name: "bob", profile_image_url_https: "https://pbs.twimg.com/profile_images/b.jpg" }
        }
      }
    }
  });

  const quoteImage = fakeNode({ src: "https://pbs.twimg.com/media/dom-quote.jpg", alt: "DOM quote image" });
  const quoteContainer = fakeNode({
    contains(node) {
      return node === quoteContainer || node === quoteImage;
    },
    querySelector(selector) {
      if (selector === '[data-testid="tweetText"]') return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return [{ href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }];
      if (selector === '[data-testid="tweetPhoto"] img') return [quoteImage];
      if (selector === 'img[src*="pbs.twimg.com/media/"]') return [];
      if (selector === "video") return [];
      return [];
    }
  });
  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') {
        return [
          { href: "https://x.com/alice/status/1", getAttribute: () => "/alice/status/1" },
          { href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }
        ];
      }
      if (selector === '[role="link"]') return [quoteContainer];
      if (selector === '[data-testid="card.wrapper"]') return [];
      return [];
    }
  });

  const quote = extractQuote(article);
  assert.ok(quote);
  assert.equal(quote.media.some((item) => item.url === "https://pbs.twimg.com/media/dom-quote.jpg?format=jpg&name=orig"), true);
  assert.equal(quote.media.some((item) => item.url === "https://video.twimg.com/ext_tw_video/2/pu/vid/1280x720/quote.mp4"), true);
});

test("extractQuote returns null when only the main status link is present", () => {
  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') {
        return [{ href: "https://x.com/alice/status/1", getAttribute: () => "/alice/status/1" }];
      }
      if (selector === '[role="link"]' || selector === '[data-testid="card.wrapper"]') return [];
      return [];
    }
  });

  assert.equal(extractQuote(article), null);
});

test("extractQuote with link only does not borrow main tweet author metadata", () => {
  TWEET_CACHE.clear();
  const mainAuthorBlock = fakeNode({
    querySelectorAll(selector) {
      if (selector === "span") {
        return [{ textContent: "@alice" }, { textContent: "Alice" }];
      }
      if (selector === 'a[href^="/"]') return [{ getAttribute: () => "/alice" }];
      return [];
    }
  });
  const article = fakeNode({
    querySelector(selector) {
      if (selector === '[data-testid="User-Name"]') return mainAuthorBlock;
      if (selector === "time") return { getAttribute: () => "2026-06-10T12:00:00.000Z" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') {
        return [
          { href: "https://x.com/alice/status/1", getAttribute: () => "/alice/status/1" },
          { href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }
        ];
      }
      if (selector === '[role="link"]' || selector === '[data-testid="card.wrapper"]') return [];
      return [];
    }
  });

  const quote = extractQuote(article);
  assert.ok(quote);
  assert.equal(quote.url, "https://x.com/bob/status/2");
  assert.equal(quote.author.displayName, "");
  assert.equal(quote.author.username, "");
  assert.equal(quote.createdAt, "");
});

test("bestCachedTweetForQuote prefers status id and requires author match for fuzzy text", () => {
  TWEET_CACHE.clear();
  cacheTweetResult({
    rest_id: "200",
    legacy: {
      full_text: "Exact quoted tweet body for testing",
      created_at: "Tue May 26 12:00:00 +0000 2026"
    },
    core: {
      user_results: {
        result: {
          legacy: { name: "Bob", screen_name: "bob", profile_image_url_https: "https://pbs.twimg.com/profile_images/b.jpg" }
        }
      }
    }
  });
  cacheTweetResult({
    rest_id: "999",
    legacy: { full_text: "Exact quoted tweet body for testing but from wrong user" },
    core: {
      user_results: {
        result: {
          legacy: { name: "Eve", screen_name: "eve", profile_image_url_https: "https://pbs.twimg.com/profile_images/e.jpg" }
        }
      }
    }
  });

  const byId = bestCachedTweetForQuote({
    url: "https://x.com/bob/status/200",
    author: { username: "bob" },
    text: ""
  }, "100");
  assert.equal(byId?.author?.username, "bob");

  const fuzzy = bestCachedTweetForQuote({
    url: "",
    author: { username: "bob" },
    text: "Exact quoted tweet body for testing"
  }, "100");
  assert.equal(fuzzy?.author?.username, "bob");

  const wrongUser = bestCachedTweetForQuote({
    url: "",
    author: { username: "alice" },
    text: "Exact quoted tweet body for testing"
  }, "100");
  assert.equal(wrongUser, null);

  const shortText = bestCachedTweetForQuote({
    url: "",
    author: { username: "bob" },
    text: "quoted"
  }, "100");
  assert.equal(shortText, null);
});

test("tweetUrlFromArticle falls back to the page URL when no status link exists", () => {
  const article = fakeNode({
    querySelectorAll() {
      return [];
    }
  });

  assert.equal(
    tweetUrlFromArticle(article),
    "https://x.com/fixture_author/status/1000000000000000001"
  );
});

test("highResolutionTweetImageUrl upgrades media URLs and leaves other URLs alone", () => {
  assert.equal(
    highResolutionTweetImageUrl("https://pbs.twimg.com/media/Abcd.jpg:small"),
    "https://pbs.twimg.com/media/Abcd.jpg?format=jpg&name=orig"
  );
  assert.equal(
    highResolutionTweetImageUrl("https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/thumb.jpg"),
    "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/thumb.jpg"
  );
});

test("normalizeTweetBodyText rejoins https:// split across newlines", () => {
  assert.equal(
    normalizeTweetBodyText("Announcing Grok 4.5\nhttps://\nx.ai/news/grok-4-5"),
    "Announcing Grok 4.5\nhttps://x.ai/news/grok-4-5"
  );
  assert.equal(
    normalizeTweetBodyText("See https://\nexample.com/path and more"),
    "See https://example.com/path and more"
  );
});

test("extractText keeps expanded URLs on one line when X splits the protocol", () => {
  const textRoot = {
    cloneNode() {
      const clone = {
        innerText: "Announcing Grok 4.5 https://\nx.ai/news/grok-4-5",
        textContent: "Announcing Grok 4.5 https://\nx.ai/news/grok-4-5",
        querySelectorAll(selector) {
          if (selector !== "a") return [];
          return [{
            textContent: "https://\nx.ai/news/grok-4-5",
            replaceWith(value) {
              clone.innerText = `Announcing Grok 4.5 ${value}`;
              clone.textContent = clone.innerText;
            }
          }];
        }
      };
      return clone;
    }
  };

  const article = fakeNode({
    querySelectorAll(selector) {
      if (selector === '[data-testid="tweetText"]') return [textRoot];
      return [];
    }
  });

  assert.equal(extractText(article), "Announcing Grok 4.5 https://x.ai/news/grok-4-5");
});
