import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

/*
Fixture refresh notes:
Syndication fixtures can be refreshed with
GET https://cdn.syndication.twimg.com/tweet-result?id=<tweetId>&lang=en&token=<token>, then saved
as redacted JSON. DOM fixtures can be refreshed from DevTools by copying the outer
HTML of [data-testid="tweet"], stripping scripts, and storing it under
tests/fixtures/dom/ when an HTML fixture becomes useful.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");
const fixtureDir = path.join(root, "tests", "fixtures", "syndication");

function loadMediaContext(request = () => Promise.resolve(null)) {
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
    request
  });
  runInNewContext(`${code}\nthis.exports = {
    mediaFromLegacyTweet,
    syndicationToken,
    fetchSyndicationTweet,
    syndicationMediaEntityUrls,
    visibleSyndicationText,
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

test("syndication requests include X's derived token", async () => {
  const calls = [];
  const context = loadMediaContext((...args) => {
    calls.push(args);
    return Promise.resolve({ id_str: "2057610994122166373" });
  });

  assert.equal(context.syndicationToken("2057610994122166373"), "4zk6bk5el");
  await context.fetchSyndicationTweet("2057610994122166373");
  assert.deepEqual(calls, [[
    "GET",
    "https://cdn.syndication.twimg.com/tweet-result?id=2057610994122166373&lang=en&token=4zk6bk5el"
  ]]);
});

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
  assert.deepEqual(Array.from(media[1].variants, (variant) => variant.url), [
    "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/high.mp4",
    "https://video.twimg.com/ext_tw_video/123/pu/vid/640x360/low.mp4"
  ]);
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

test("tweetFromSyndication removes hidden media URLs but preserves ordinary links", () => {
  const tweet = tweetFromSyndication({
    text: "Read https://example.com then watch https://t.co/media123",
    entities: {
      urls: [{ url: "https://example.com" }],
      media: [{ url: "https://t.co/media123" }]
    }
  });

  assert.equal(tweet.text, "Read https://example.com then watch");
});

test("tweetFromSyndication prefers text visible in the X page", () => {
  const tweet = tweetFromSyndication({
    text: "Visible quoted body https://t.co/media123",
    entities: { media: [{ url: "https://t.co/media123" }] }
  }, {
    text: "Visible quoted body"
  });

  assert.equal(tweet.text, "Visible quoted body");
});

test("tweetFromSyndication emits playable videos with posters", () => {
  const data = readFixture("video-plus-photos.json");
  const tweet = tweetFromSyndication(data);
  const videos = tweet.media.filter((item) => item.type === "video");

  assert.equal(videos.length, 1);
  assert.equal(videos.some((video) => video.url === bestSyndicationVideoUrl(data)), true);
  assert.equal(videos.every((video) => isPlayableTweetVideoUrl(video.url)), true);
  assert.equal(videos.some((video) => video.posterUrl === "https://pbs.twimg.com/ext_tw_video_thumb/1000000000000000001/pu/img/poster.jpg"), true);
  assert.equal(videos.every((video) => video.variants.length > 0), true);
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

const longPostParts = (overrides = {}) => ({
  url: "https://x.com/fixture_author/status/1000000000000000001",
  author: { displayName: "Fixture Author", username: "fixture_author", avatarUrl: "" },
  text: "The start of a long post",
  textCutOff: true,
  media: [],
  createdAt: "",
  quote: null,
  ...overrides
});

test("a post cut off on the timeline gets its full text, links expanded, from captured X traffic", async () => {
  const syndication = loadMediaContext(() => Promise.resolve(null));
  syndication.scanForVideoVariants({
    rest_id: "1000000000000000001",
    core: { user_results: { result: { legacy: { name: "Fixture Author", screen_name: "fixture_author" } } } },
    legacy: { full_text: "The start of a long post https://t.co/short" },
    note_tweet: { note_tweet_results: { result: {
      text: "The start of a long post and its ending https://t.co/abc",
      entity_set: { urls: [{ url: "https://t.co/abc", expanded_url: "https://github.com/example/project" }] }
    } } }
  });

  const tweet = await syndication.enrichTweetMedia(longPostParts());

  assert.equal(tweet.text, "The start of a long post and its ending https://github.com/example/project");
  assert.equal(tweet.textCutOff, false);
});

test("a post cut off with no captured full text says so in its text", async () => {
  const syndication = loadMediaContext(() => Promise.resolve(null));
  const tweet = await syndication.enrichTweetMedia(longPostParts());

  assert.match(tweet.text, /^The start of a long post…\n\n.*cut off.*Open on X/i);
  assert.equal(tweet.textCutOff, true);
});

test("a complete post is left alone", async () => {
  const syndication = loadMediaContext(() => Promise.resolve(null));
  const tweet = await syndication.enrichTweetMedia(longPostParts({ textCutOff: false }));

  assert.equal(tweet.text, "The start of a long post");
});

const fixtureAuthor = { user_results: { result: { legacy: { name: "Fixture Author", screen_name: "fixture_author" } } } };

test("captured text drops the t.co links that stand for a post's media and reads X's escaped characters", async () => {
  const syndication = loadMediaContext(() => Promise.resolve(null));
  syndication.scanForVideoVariants({
    rest_id: "1000000000000000001",
    core: fixtureAuthor,
    legacy: {
      full_text: "Tom &amp; Jerry &lt;3 https://t.co/photo",
      entities: { media: [{ url: "https://t.co/photo", type: "photo", media_url_https: "https://pbs.twimg.com/media/Photo.jpg" }] }
    }
  });

  const tweet = await syndication.enrichTweetMedia(longPostParts({ text: "", textCutOff: false }));

  assert.equal(tweet.text, "Tom & Jerry <3");
  assert.equal(tweet.media[0]?.url, "https://pbs.twimg.com/media/Photo.jpg?format=jpg&name=orig");
});

test("a captured long post's full text reads X's escaped characters", async () => {
  const syndication = loadMediaContext(() => Promise.resolve(null));
  syndication.scanForVideoVariants({
    rest_id: "1000000000000000001",
    core: fixtureAuthor,
    legacy: { full_text: "Tom &amp; Jerry" },
    note_tweet: { note_tweet_results: { result: { text: "Tom &amp; Jerry &lt;3 &gt;:)" } } }
  });

  const tweet = await syndication.enrichTweetMedia(longPostParts());

  assert.equal(tweet.text, "Tom & Jerry <3 >:)");
});

test("enrichTweetMedia takes a quote's missing link from the parent's quoted_tweet, unless it names someone else", async () => {
  const quoteLink = async (quotedName) => {
    const syndication = loadMediaContext((method, url) => Promise.resolve(
      new URL(url).searchParams.get("id") === "1000000000000000001"
        ? { id_str: "1000000000000000001", quoted_tweet: { id_str: "2000000000000000002", user: { screen_name: quotedName } } }
        : null
    ));
    const tweet = await syndication.enrichTweetMedia({
      url: "https://x.com/fixture_author/status/1000000000000000001",
      author: { displayName: "Fixture Author", username: "fixture_author", avatarUrl: "" },
      text: "Main post",
      media: [],
      createdAt: "",
      quote: { url: "", author: { displayName: "Quoted", username: "quoted_user", avatarUrl: "" }, text: "Quoted words", media: [], createdAt: "" }
    });
    return tweet.quote.url;
  };

  assert.equal(await quoteLink("Quoted_User"), "https://x.com/Quoted_User/status/2000000000000000002");
  assert.equal(await quoteLink("someone_else"), "");
});

const bobsPost = (id, legacy, fullText) => ({
  rest_id: id,
  core: { user_results: { result: { legacy: { name: "Bob", screen_name: "bob" } } } },
  legacy: { full_text: legacy.text || "", created_at: "Tue May 26 12:00:00 +0000 2026", extended_entities: legacy.media ? { media: legacy.media } : undefined },
  ...(fullText ? { note_tweet: { note_tweet_results: { result: { text: fullText } } } } : {})
});

// A timeline post by Alice whose quote box, as X often draws it, carries no link to the quoted post.
function articleQuoting(quoteBoxHtml) {
  const dom = new JSDOM(`<article>
    <div data-testid="User-Name"><span>Alice</span><span>@alice</span></div>
    <a href="/alice/status/111"><time datetime="2026-06-10T12:00:00.000Z"></time></a>
    <div data-testid="tweetText">Main body</div>
    <div role="link" tabindex="0"><div data-testid="User-Name"><span>Bob</span><span>@bob</span></div>${quoteBoxHtml}</div>
  </article>`, { url: "https://x.com/home" });
  return dom.window.document.querySelector("article");
}

const syndicationById = (results) => (method, url) => Promise.resolve(results[new URL(url).searchParams.get("id")] || null);

test("the parent's syndication result names the quoted post before any captured post by the same author", async () => {
  const quoted = "The launch happens tomorrow morning, and here is why it matters.";
  const syndication = loadMediaContext(syndicationById({
    111: { id_str: "111", quoted_tweet: { id_str: "999", user: { screen_name: "bob" } } },
    999: { id_str: "999", text: "The launch happens tomorrow morning, and here is why it matters.", user: { name: "Bob", screen_name: "bob" } }
  }));
  syndication.scanForVideoVariants(bobsPost("555", {
    text: "The launch happens tomorrow morning",
    media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/OtherPost.jpg" }]
  }));

  const tweet = await syndication.enrichTweetMedia(syndication.extractTweet(articleQuoting(`<div data-testid="tweetText">${quoted}</div>`)));

  assert.equal(tweet.quote.url, "https://x.com/bob/status/999");
  assert.equal(tweet.quote.text, quoted);
  assert.deepEqual(tweet.quote.media, [], "nothing of the other post comes along");
});

test("a quote with no link and no syndication answer takes the one captured post by its author whose full text matches", async () => {
  const fullText = "Weekly update from the team, part one, and everything that follows it";
  const syndication = loadMediaContext(() => Promise.resolve(null));
  syndication.scanForVideoVariants(bobsPost("555", { text: "Weekly update https://t.co/short" }, fullText));

  const tweet = await syndication.enrichTweetMedia({
    ...longPostParts({ textCutOff: false }),
    quote: { url: "", author: { displayName: "Bob", username: "bob", avatarUrl: "" }, text: "Weekly update from the team, part one", textCutOff: true, media: [], createdAt: "" }
  });

  assert.equal(tweet.quote.url, "https://x.com/bob/status/555");
  assert.equal(tweet.quote.text, fullText);
  assert.equal(tweet.quote.textCutOff, false);
});

test("a quote with no link stays unresolved when two captured posts by its author match its visible text", async () => {
  const opening = "This is a recurring opening longer than twenty four characters";
  const syndication = loadMediaContext(() => Promise.resolve(null));
  syndication.scanForVideoVariants(bobsPost("888", { text: `${opening} OLD post ending` }));
  syndication.scanForVideoVariants(bobsPost("999", { text: `${opening} CORRECT post ending` }));

  const tweet = await syndication.enrichTweetMedia(syndication.extractTweet(articleQuoting(
    `<div data-testid="tweetText">${opening}</div><span data-testid="tweet-text-show-more-link">Show more</span>`
  )));

  assert.equal(tweet.quote.url, "");
  assert.match(tweet.quote.text, new RegExp(`^${opening}`));
  assert.doesNotMatch(tweet.quote.text, /post ending/, "neither post's ending is borrowed");
});

test("enrichTweetMedia fills a link-only quote's text and photo from its syndication result", async () => {
  const quoteParent = { ...readFixture("quote-parent.json"), photos: [{ url: "https://pbs.twimg.com/media/QuoteParentPhoto.jpg" }] };
  const syndication = loadMediaContext((method, url) =>
    Promise.resolve(new URL(url).searchParams.get("id") === quoteParent.id_str ? quoteParent : null)
  );

  const tweet = await syndication.enrichTweetMedia({
    url: "https://x.com/fixture_author/status/1000000000000000001",
    author: { displayName: "Fixture Author", username: "fixture_author", avatarUrl: "" },
    text: "Main post",
    media: [],
    createdAt: "",
    quote: {
      url: `https://x.com/quote_parent/status/${quoteParent.id_str}`,
      author: { displayName: "", username: "", avatarUrl: "" },
      text: "",
      media: [],
      createdAt: ""
    }
  });

  assert.ok(tweet.quote, "the quote survives enrichment");
  assert.equal(tweet.quote.text, quoteParent.text);
  assert.equal(tweet.quote.author.displayName, quoteParent.user.name);
  assert.equal(tweet.quote.author.username, quoteParent.user.screen_name);
  assert.deepEqual(
    [...tweet.quote.media].map(({ type, url }) => ({ type, url })),
    [{ type: "image", url: "https://pbs.twimg.com/media/QuoteParentPhoto.jpg?format=jpg&name=orig" }],
    "the quote carries the photo only syndication knows about, at original size"
  );
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
  const narrowQuoteLinkContainer = fakeNode({
    getAttribute(name) {
      return name === "href" ? "/tenobrus/status/2079661246580973865" : "";
    },
    querySelector() {
      return null;
    }
  });
  const mediaOnlyQuoteContainer = fakeNode({
    contains(node) {
      return node === mediaOnlyQuoteContainer
        || node === narrowQuoteLinkContainer
        || quoteImages.includes(node);
    },
    querySelector(selector) {
      return selector === '[data-testid="tweetPhoto"] img'
        || selector === 'img[src*="pbs.twimg.com/media/"]'
        ? quoteImages[0]
        : null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return [quoteLink];
      if (selector === '[data-testid="tweetPhoto"] img') return quoteImages;
      return [];
    }
  });
  const quoteContainer = fakeNode({
    contains(node) {
      return node === quoteContainer
        || node === quoteTextNode
        || mediaOnlyQuoteContainer.contains(node);
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
      if (selector === '[role="link"]') {
        return [broadClickableContainer, quoteContainer, mediaOnlyQuoteContainer, narrowQuoteLinkContainer];
      }
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

test("extractQuote keeps visible text instead of cached hidden card URLs", () => {
  TWEET_CACHE.clear();
  cacheTweetResult({
    rest_id: "2",
    legacy: {
      full_text: "Visible quoted body https://t.co/hidden-card"
    },
    core: {
      user_results: {
        result: {
          legacy: { name: "Bob", screen_name: "bob" }
        }
      }
    }
  });

  const quoteText = fakeNode({ innerText: "Visible quoted body" });
  const quoteContainer = fakeNode({
    contains(node) {
      return node === quoteContainer || node === quoteText;
    },
    querySelector(selector) {
      return selector === '[data-testid="tweetText"]' ? quoteText : null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') {
        return [{ href: "https://x.com/bob/status/2", getAttribute: () => "/bob/status/2" }];
      }
      if (selector === '[data-testid="tweetText"]') return [quoteText];
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

  assert.equal(quote.text, "Visible quoted body");
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

test("bestCachedTweetForQuote names the one cached post by the quote's author whose text matches, else nothing", () => {
  TWEET_CACHE.clear();
  const cache = (id, screenName, text) => cacheTweetResult({
    rest_id: id,
    legacy: { full_text: text },
    core: { user_results: { result: { legacy: { name: screenName, screen_name: screenName } } } }
  });
  cache("200", "bob", "Exact quoted tweet body for testing");
  cache("999", "eve", "Exact quoted tweet body for testing but from wrong user");
  const quoteBy = (username, text) => bestCachedTweetForQuote({ url: "", author: { username }, text }, "100");

  assert.equal(quoteBy("bob", "Exact quoted tweet body for testing")?.url, "https://x.com/bob/status/200");
  assert.equal(quoteBy("alice", "Exact quoted tweet body for testing"), null, "another author's post never matches");
  assert.equal(quoteBy("bob", "quoted"), null, "a short text is no evidence");
  assert.equal(quoteBy("bob", ""), null, "an empty text matches nothing, however many posts the author has");

  cache("201", "bob", "Exact quoted tweet body for testing, posted again with more");
  assert.equal(quoteBy("bob", "Exact quoted tweet body for testing"), null, "two matching posts leave the quote unresolved");
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
