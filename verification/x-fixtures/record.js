// Records a public post from x.com as a test fixture. Paste into the browser console on x.com, reload nothing, then
// scroll until the post is on screen and run: tdsRecord("https://x.com/user/status/123", "photos")
// It keeps only the markup and fields the script reads. Review the file before committing it, and record public posts only.
(() => {
  if (window.tdsRecord) return;
  const nodes = new Map();
  const pickUrls = (urls) => urls?.map(({ url, expanded_url, display_url }) => ({ url, expanded_url, display_url }));
  const pickMedia = (media) => media?.map(({ id_str, media_key, type, url, media_url_https, ext_alt_text, video_info }) => ({
    id_str, media_key, type, url, media_url_https, ext_alt_text,
    video_info: video_info && { variants: video_info.variants?.map(({ bitrate, content_type, url }) => ({ bitrate, content_type, url })) }
  }));
  const pickEntities = (entities) => entities && { urls: pickUrls(entities.urls), media: pickMedia(entities.media) };
  const pickLegacy = (legacy = {}) => ({
    full_text: legacy.full_text,
    text: legacy.text,
    created_at: legacy.created_at,
    user_id_str: legacy.user_id_str,
    quoted_status_id_str: legacy.quoted_status_id_str,
    in_reply_to_status_id_str: legacy.in_reply_to_status_id_str,
    in_reply_to_screen_name: legacy.in_reply_to_screen_name,
    entities: pickEntities(legacy.entities),
    extended_entities: pickEntities(legacy.extended_entities)
  });
  const pickNote = (result) => result && { note_tweet_results: { result: {
    text: result.note_tweet_results?.result?.text,
    entity_set: { urls: pickUrls(result.note_tweet_results?.result?.entity_set?.urls) }
  } } };
  const pickUser = (result) => result?.legacy
    ? { rest_id: result.rest_id, legacy: { name: result.legacy.name, screen_name: result.legacy.screen_name, profile_image_url_https: result.legacy.profile_image_url_https } }
    : undefined;
  const pick = (node) => ({
    rest_id: node.rest_id,
    legacy: pickLegacy(node.legacy),
    note_tweet: pickNote(node.note_tweet),
    core: { user_results: { result: pickUser(node.core?.user_results?.result) } }
  });
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
  const KEEP = new Set(["data-testid", "href", "src", "alt", "datetime", "role", "dir", "aria-label", "tabindex"]);
  const cleanMarkup = (article) => {
    const clone = article.cloneNode(true);
    clone.querySelectorAll("script, style, svg *").forEach((node) => node.remove());
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      for (const { name } of [...node.attributes]) if (!KEEP.has(name)) node.removeAttribute(name);
    }
    // The action row shows the viewer's likes and bookmarks.
    clone.querySelectorAll('[role="group"]').forEach((group) => {
      const share = group.querySelector('[aria-label*="hare"]');
      group.replaceChildren();
      if (share) {
        share.setAttribute("data-testid", "share");
        group.append(share);
      }
    });
    return clone.outerHTML;
  };
  window.tdsRecord = (url, name) => {
    const id = url.match(/status\/(\d+)/)?.[1];
    // A post's own timestamp links to it; a quote inside another post does not count, or a public quote could record
    // the post that quotes it.
    const ownsPermalink = (item) => [...item.querySelectorAll("a[href] time")].some((time) => {
      const link = time.closest("a");
      return link.closest("article") === item && !link.closest('[role="link"]') && new URL(link.href).pathname.endsWith(`/status/${id}`);
    });
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find(ownsPermalink);
    if (!article) return console.log("TDS fixture: scroll until the post is on screen, then run this again.");
    const node = nodes.get(id);
    const quoted = node?.legacy?.quoted_status_id_str && nodes.get(node.legacy.quoted_status_id_str);
    const fixture = { name, url, recordedAt: new Date().toISOString(), markup: cleanMarkup(article), responses: [node, quoted].filter(Boolean).map(pick) };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(fixture, null, 1)], { type: "application/json" }));
    link.download = `${name}.json`;
    link.click();
    console.log("TDS fixture saved", name, "markup", fixture.markup.length, "chars, responses", fixture.responses.length);
  };
  console.log('TDS recorder ready. Scroll to a post, then run tdsRecord("<post url>", "<name>").');
})();
