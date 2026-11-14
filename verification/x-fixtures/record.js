// Records a public post from x.com as a test fixture. Paste into the browser console on x.com, reload nothing, then
// scroll until the post is on screen and run: tdsRecord("https://x.com/user/status/123", "photos")
// It keeps only the markup and fields the script reads. Review the file before committing it, and record public posts only.
(() => {
  if (window.tdsRecord) return;
  const nodes = new Map();
  // The fields the script reads. `true` keeps a string, number or boolean; anything else is dropped.
  const URLS = [{ url: true, expanded_url: true, display_url: true }];
  const MEDIA = [{
    id: true, id_str: true, media_key: true, type: true, url: true, media_url: true, media_url_https: true, ext_alt_text: true,
    video_info: { variants: [{ bitrate: true, content_type: true, url: true }] }
  }];
  const ENTITIES = { urls: URLS, media: MEDIA };
  const POST = {
    rest_id: true,
    legacy: {
      full_text: true, text: true, created_at: true, user_id_str: true, quoted_status_id_str: true,
      in_reply_to_status_id_str: true, in_reply_to_screen_name: true, entities: ENTITIES, extended_entities: ENTITIES
    },
    note_tweet: { note_tweet_results: { result: { text: true, entity_set: { urls: URLS } } } },
    core: { user_results: { result: {
      rest_id: true,
      legacy: { name: true, screen_name: true, profile_image_url: true, profile_image_url_https: true }
    } } }
  };
  const pick = (schema, value) => {
    if (schema === true) return ["string", "number", "boolean"].includes(typeof value) ? value : undefined;
    if (Array.isArray(schema)) return Array.isArray(value) ? value.map((item) => pick(schema[0], item)) : undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.keys(schema).map((key) => [key, pick(schema[key], value[key])]));
  };
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.rest_id && value.legacy?.created_at) nodes.set(String(value.rest_id), value);
    Object.values(value).forEach(visit);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      if (!/graphql/.test(this.responseURL)) return;
      try { visit(JSON.parse(this.responseText)); } catch {}
    });
    return send.apply(this, args);
  };
  const KEEP = new Set(["data-testid", "href", "src", "alt", "poster", "datetime", "role", "dir", "aria-label", "tabindex"]);
  const cleanMarkup = (article) => {
    const clone = article.cloneNode(true);
    // Another post nested in this one, the "You reposted" line, and the action row's likes and bookmarks are not this
    // post, or describe the viewer.
    clone.querySelectorAll('script, style, svg *, article, [data-testid="socialContext"]').forEach((node) => node.remove());
    clone.querySelectorAll('[role="group"]').forEach((group) => {
      const share = group.querySelector('[aria-label*="hare"]');
      group.replaceChildren();
      group.removeAttribute("aria-label");
      if (share) {
        share.replaceChildren();
        share.setAttribute("aria-label", "Share post");
        share.setAttribute("data-testid", "share");
        group.append(share);
      }
    });
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      for (const { name } of [...node.attributes]) if (!KEEP.has(name)) node.removeAttribute(name);
    }
    return clone.outerHTML;
  };
  window.tdsRecord = (url, name) => {
    const id = url.match(/status\/(\d+)/)?.[1];
    // Every timestamp link in the post must open this post. X does not link a quote's timestamp, so a post that links
    // another post's timestamp anywhere is skipped, even if that leaves nothing to record: the wrong post could be a
    // protected one.
    const ownsPermalink = (item) => {
      const ids = [...item.querySelectorAll("a[href] time")]
        .map((time) => time.closest("a"))
        .filter((link) => link.closest("article") === item)
        .map((link) => new URL(link.href).pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1] || "");
      return ids.length > 0 && ids.every((value) => value === id);
    };
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find(ownsPermalink);
    if (!article) return console.log("TDS fixture: no post on screen links only to this post. Scroll to it and run this again, or pick another post.");
    const node = nodes.get(id);
    const quoted = node?.legacy?.quoted_status_id_str && nodes.get(node.legacy.quoted_status_id_str);
    const fixture = { name, url, recordedAt: new Date().toISOString(), markup: cleanMarkup(article), responses: [node, quoted].filter(Boolean).map((node) => pick(POST, node)) };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(fixture, null, 1)], { type: "application/json" }));
    link.download = `${name}.json`;
    link.click();
    console.log("TDS fixture saved", name, "markup", fixture.markup.length, "chars, responses", fixture.responses.length);
  };
  console.log('TDS recorder ready. Scroll to a post, then run tdsRecord("<post url>", "<name>").');
})();
