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
    "06-syndication.js",
    "07-extract-dom.js"
  ];
  const code = files.map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
  const context = createContext({
    console,
    location: { href: "https://x.com/fixture_author/status/1000000000000000001" },
    performance: { getEntriesByType: () => [] },
    document: { querySelectorAll: () => [] },
    request: () => Promise.resolve(null)
  });
  runInNewContext(`${code}\nthis.exports = {
    mediaFromLegacyTweet,
    scanForVideoVariants,
    mediaFromSyndication,
    mergeTweetMedia,
    tweetFromSyndication,
    bestSyndicationVideoUrl,
    uniqueMedia,
    extractMedia,
    nearestPlayableVideoUrl,
    isPlayableTweetVideoUrl,
    normalizeTweetVideoUrl,
    highResolutionTweetImageUrl,
    bestCachedVideoUrlForTweet,
    imageMedia,
    VIDEO_VARIANT_CACHE
  };`, context);
  return context.exports;
}

const {
  mediaFromLegacyTweet,
  scanForVideoVariants,
  mediaFromSyndication,
  mergeTweetMedia,
  tweetFromSyndication,
  bestSyndicationVideoUrl,
  uniqueMedia,
  extractMedia,
  nearestPlayableVideoUrl,
  isPlayableTweetVideoUrl,
  normalizeTweetVideoUrl,
  highResolutionTweetImageUrl,
  bestCachedVideoUrlForTweet,
  imageMedia,
  VIDEO_VARIANT_CACHE
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

test("nearestPlayableVideoUrl returns a playable currentSrc URL", () => {
  const url = "https://video.twimg.com/ext_tw_video/999/pu/vid/1280x720/current.mp4";
  const result = nearestPlayableVideoUrl(fakeNode({ currentSrc: url, src: "", poster: "" }));

  assert.equal(result, normalizeTweetVideoUrl(url));
  assert.equal(isPlayableTweetVideoUrl(result), true);
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
