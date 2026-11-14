import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const recorder = readFileSync(new URL("../verification/x-fixtures/record.js", import.meta.url), "utf8");

function recordPage(body, response) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: "https://x.com/home", runScripts: "outside-only" });
  const { window } = dom;
  const saved = [];
  window.URL.createObjectURL = (blob) => {
    saved.push(blob);
    return "blob:fixture";
  };
  window.HTMLAnchorElement.prototype.click = () => {};
  window.console.log = () => {};
  window.XMLHttpRequest.prototype.send = function () {};
  window.eval(recorder);

  const xhr = new window.XMLHttpRequest();
  Object.defineProperty(xhr, "responseURL", { value: "https://x.com/i/api/graphql/abc/TweetDetail" });
  Object.defineProperty(xhr, "responseText", { value: JSON.stringify(response) });
  return {
    window,
    async record(url) {
      xhr.send();
      xhr.dispatchEvent(new window.Event("load"));
      window.tdsRecord(url, "case");
      return saved.length ? JSON.parse(await saved.at(-1).text()) : null;
    }
  };
}

const article = (id, inner = "") =>
  `<article data-testid="tweet"><a href="/someone/status/${id}"><time datetime="2026-01-01T00:00:00Z">Jan 1</time></a>` +
  `<div data-testid="tweetText">post ${id}</div>${inner}</article>`;

test("the recorder keeps only allow-listed fields, at every depth", async () => {
  const response = {
    data: {
      tweet: {
        rest_id: "100",
        legacy: {
          created_at: "Thu Jan 01 00:00:00 +0000 2026",
          full_text: "hello",
          favorited: true,
          bookmarked: true,
          in_reply_to_status_id_str: "99",
          in_reply_to_screen_name: "parent",
          extended_entities: {
            media: [{
              type: "video",
              media_url_https: "https://pbs.twimg.com/a.jpg",
              additional_media_info: { source_user: { legacy: { following: true, notifications: true } } },
              video_info: { variants: [{ bitrate: 1, content_type: "video/mp4", url: "https://video.twimg.com/a.mp4", secret: 1 }] }
            }]
          }
        },
        note_tweet: { note_tweet_results: { result: { text: "long", entity_set: { urls: [] }, viewer_sentinel: "leak" } } },
        core: { user_results: { result: { rest_id: "5", legacy: { name: "N", screen_name: "someone", following: true } } } }
      }
    }
  };
  const page = recordPage(article("100"), response);
  const fixture = await page.record("https://x.com/someone/status/100");
  const saved = JSON.stringify(fixture.responses);

  for (const leaked of ["favorited", "bookmarked", "following", "notifications", "additional_media_info", "viewer_sentinel", "secret"]) {
    assert.ok(!saved.includes(leaked), `${leaked} is not recorded`);
  }
  const [post] = fixture.responses;
  assert.equal(post.legacy.in_reply_to_status_id_str, "99", "reply data is kept for reply fixtures");
  assert.equal(post.legacy.extended_entities.media[0].video_info.variants[0].url, "https://video.twimg.com/a.mp4", "video variants are kept");
  assert.equal(post.note_tweet.note_tweet_results.result.text, "long", "long-post text is kept");
});

test("recording a post records its own article, not one that quotes it", async () => {
  const quoting = `<article data-testid="tweet"><a href="/other/status/1"><time>Jan 1</time></a>` +
    `<div data-testid="tweetText">private outer text</div>` +
    `<div role="link"><a href="/someone/status/100"><time>Jan 1</time></a><div>quoted</div></div></article>`;
  const quotedOnly = recordPage(quoting, {});
  assert.equal(await quotedOnly.record("https://x.com/someone/status/100"), null, "a post shown only as a quote is not recorded");

  const both = recordPage(quoting + article("100"), {});
  const fixture = await both.record("https://x.com/someone/status/100");
  assert.ok(!fixture.markup.includes("private outer text"), "the quoting post's markup is not recorded");
  assert.ok(fixture.markup.includes("post 100"), "the post's own article is recorded");
});

test("a post that also shows the requested post's timestamp outside a quote box is not recorded", async () => {
  const quoting = `<article data-testid="tweet"><a href="/other/status/1"><time>Jan 1</time></a>` +
    `<div data-testid="tweetText">private outer text</div>` +
    `<div><a href="/someone/status/100"><time>Jan 1</time></a><div>quoted</div></div></article>`;
  assert.equal(await recordPage(quoting, {}).record("https://x.com/someone/status/100"), null, "the quoting post is skipped");
  const fixture = await recordPage(quoting + article("100"), {}).record("https://x.com/someone/status/100");
  assert.ok(!fixture.markup.includes("private outer text"), "the post's own article is recorded instead");
});

test("a post whose timestamp links to one of its photos is recorded", async () => {
  const photoLinked = `<article data-testid="tweet"><a href="/someone/status/100/photo/1"><time>Jan 1</time></a>` +
    `<div data-testid="tweetText">post 100</div></article>`;
  const fixture = await recordPage(photoLinked, {}).record("https://x.com/someone/status/100");
  assert.ok(fixture?.markup.includes("post 100"), "the post is recorded");
});

test("the recorder keeps every field the capture code reads", async () => {
  const response = {
    tweet: {
      rest_id: "100",
      legacy: {
        created_at: "Thu Jan 01 00:00:00 +0000 2026",
        full_text: "hi",
        extended_entities: { media: [{ id: 7, type: "photo", media_url: "http://pbs.twimg.com/media/old.jpg" }] }
      },
      core: { user_results: { result: { rest_id: "5", legacy: { name: "N", screen_name: "someone", profile_image_url: "http://pbs.twimg.com/a_normal.jpg" } } } }
    }
  };
  const fixture = await recordPage(article("100"), response).record("https://x.com/someone/status/100");
  const [post] = fixture.responses;
  assert.equal(post.legacy.extended_entities.media[0].media_url, "http://pbs.twimg.com/media/old.jpg", "media_url is kept");
  assert.equal(post.legacy.extended_entities.media[0].id, 7, "a media id is kept");
  assert.equal(post.core.user_results.result.legacy.profile_image_url, "http://pbs.twimg.com/a_normal.jpg", "profile_image_url is kept");
});

test("a post is skipped when any of its timestamps opens another post, wherever it sits", async () => {
  const outer = `<article data-testid="tweet"><div role="link"><a href="/other/status/1"><time>Jan 1</time></a></div>` +
    `<div data-testid="tweetText">private outer text</div><a href="/someone/status/100"><time>Jan 1</time></a></article>`;
  assert.equal(await recordPage(outer, {}).record("https://x.com/someone/status/100"), null, "the outer post is skipped");
});

test("the recorded markup leaves out nested posts, the repost line, and the action row's labels", async () => {
  const body = `<article data-testid="tweet"><div data-testid="socialContext">You reposted</div>` +
    `<a href="/someone/status/100"><time>Jan 1</time></a><div data-testid="tweetText">post 100</div>` +
    `<article data-testid="tweet"><a href="/x/status/200"><time>Jan 1</time></a><div>nested post 200</div></article>` +
    `<div role="group" aria-label="5 likes, Liked, Bookmarked"><button aria-label="Like, Liked">1</button>` +
    `<button aria-label="Share post, viewer extra">S</button></div></article>`;
  const fixture = await recordPage(body, {}).record("https://x.com/someone/status/100");
  for (const leaked of ["You reposted", "nested post 200", "Liked", "Bookmarked", "viewer extra"]) {
    assert.ok(!fixture.markup.includes(leaked), `${leaked} is not recorded`);
  }
  assert.match(fixture.markup, /data-testid="share"/, "the share button stays for the script to find");
  assert.ok(fixture.markup.includes("post 100"), "the post itself is recorded");
});

test("a video keeps its poster, which the script reads for the thumbnail", async () => {
  const video = article("100", `<div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/amplify_video_thumb/9/img/a.jpg" src="blob:x"></video></div>`);
  const fixture = await recordPage(video, {}).record("https://x.com/someone/status/100");
  assert.match(fixture.markup, /poster="https:\/\/pbs\.twimg\.com\/amplify_video_thumb\/9\/img\/a\.jpg"/, "the poster is kept");
});

test("an allow-listed field holding an object is dropped, not copied", async () => {
  const response = {
    tweet: {
      rest_id: "100",
      legacy: { created_at: "Thu Jan 01 00:00:00 +0000 2026", full_text: { viewer_sentinel: { bookmarked: true } } }
    }
  };
  const fixture = await recordPage(article("100"), response).record("https://x.com/someone/status/100");
  assert.ok(!JSON.stringify(fixture).includes("viewer_sentinel"), "the object is not recorded");
});
