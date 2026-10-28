import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildUserscript } from "../scripts/userscript-bundle.mjs";

const { source: userscript } = buildUserscript();
const webhookUrl = "https://discord.com/api/webhooks/123/abc-DEF";
const friendsWebhookUrl = "https://discord.com/api/webhooks/456/friends-XYZ";
const postUrl = "https://x.com/alice/status/1234567890";
const postText = "Hello from the smoke test";
const quoteId = "999";
const quoteText = "Bob's quoted words";
const photoUrl = "https://pbs.twimg.com/media/SmokePhoto?format=jpg&name=small";
const general = { id: "general", label: "General", webhookUrl };
const friends = { id: "friends", label: "Friends", webhookUrl: friendsWebhookUrl };
const quoteMarkup = (text) => `<div role="link" tabindex="0">
    <div data-testid="User-Name"><span>Bob</span><span>@bob</span></div>
    <a href="/bob/status/999"><span>Show more</span></a>
    <div data-testid="tweetText"><span>${text}</span></div>
  </div>`;
// `quote` is true for the default quoted post, or the quoted post's text.
const page = ({ quote, text }) => `<!doctype html><body><main>
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a><a href="/alice"><span>@alice</span></a></div>
  <a href="/alice/status/1234567890"><time datetime="2026-06-10T21:06:19.000Z">Jun 10</time></a>
  <div data-testid="tweetText"><span>${text}</span></div>
  <div data-testid="tweetPhoto"><img alt="Image" src="${photoUrl}"></div>
  ${quote ? quoteMarkup(quote === true ? quoteText : quote) : ""}
  <div role="group"><button data-testid="share" aria-label="Share post"><svg><path d="M0"/></svg></button></div>
</article></main></body>`;

function openPage(t, {
  destinations = [],
  quote = false,
  text = postText,
  store = new Map([
    ["tds-destinations", destinations],
    ["tds-preferences", { alwaysShowPreview: false }]
  ]),
  discordResponse = { status: 204, responseText: "" }
}) {
  const dom = new JSDOM(page({ quote, text }), {
    url: postUrl,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  });
  const { window } = dom;
  t.after(() => window.close());
  const requests = [];
  const menuCommands = new Map();
  const respond = (details) => {
    if (details.url.startsWith("https://discord.com/api/webhooks/")) return discordResponse;
    if (details.url.startsWith("https://pbs.twimg.com/media/") && details.method === "GET") {
      return { status: 200, response: new ArrayBuffer(64) };
    }
    return { status: 404, responseText: "" };
  };
  // Userscript managers serialize stored values, so the page never shares references with storage.
  window.GM = {
    getValue: async (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
    setValue: async (key, value) => {
      store.set(key, structuredClone(value));
    },
    registerMenuCommand: (name, callback) => menuCommands.set(name, callback),
    xmlHttpRequest(details) {
      requests.push(details);
      setTimeout(() => details.onload(respond(details)), 0);
    }
  };
  window.eval(userscript);
  const posts = () => requests.filter((request) => request.method === "POST");
  return {
    window,
    document: window.document,
    store,
    menuCommands,
    posts,
    webhookPosts: (url = webhookUrl) => posts().filter((request) => request.url === url)
  };
}

function postedMessage(request) {
  if (typeof request.data === "string") return { payload: JSON.parse(request.data), files: [] };
  const entries = [...request.data.entries()];
  return {
    payload: JSON.parse(entries.find(([name]) => name === "payload_json")[1]),
    files: entries.filter(([name]) => name !== "payload_json").map(([, file]) => file)
  };
}

async function waitFor(condition, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = condition();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// jsdom has no layout and fires click on disabled buttons, so this refuses what a user could not reach.
// Layout (zero size, off screen, covered) is left to the Chromium flow scripts.
function assertNotHiddenOrDisabled({ window }, node) {
  const what = `<${node.tagName.toLowerCase()}> "${node.textContent.trim() || node.value}"`;
  assert.ok(!node.disabled, `${what} is disabled`);
  assert.equal(node.closest('[inert], [aria-hidden="true"]'), null, `${what} sits in an inert or aria-hidden region`);
  for (let element = node; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    assert.ok(
      !element.hidden && style.display !== "none" && style.visibility !== "hidden",
      `${what} sits in a collapsed or hidden region; open it first, as a user would`
    );
  }
}

function click(view, node) {
  assertNotHiddenOrDisabled(view, node);
  node.dispatchEvent(new view.window.MouseEvent("click", { bubbles: true }));
}

const press = ({ window, document }, key, modifiers = {}) =>
  (document.activeElement || document).dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
const visibleText = (node) =>
  node.nodeType === node.TEXT_NODE
    ? node.textContent
    : node.getAttribute?.("aria-hidden") === "true"
      ? ""
      : [...node.childNodes].map(visibleText).join("");
const accessibleName = (node) => {
  const labelledBy = node.getAttribute("aria-labelledby");
  const name = labelledBy
    ? labelledBy.split(/\s+/).map((id) => visibleText(node.ownerDocument.getElementById(id))).join(" ")
    : node.getAttribute("aria-label") || visibleText(node);
  return name.replace(/\s+/g, " ").trim();
};
const accessibleDescription = (node) =>
  (node.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => node.ownerDocument.getElementById(id).textContent)
    .join(" ");
const shareItems = ({ document }) =>
  [...document.querySelectorAll('[role="menuitem"]')].filter((item) => item.textContent.trim() === "Share to Discord");
const toast = ({ document }, state) => document.querySelector(`.tds-toast[data-state="${state}"]`);
const toasts = ({ document }, state) => [...document.querySelectorAll(`.tds-toast[data-state="${state}"]`)];

async function openShareMenu(view, share = view.document.querySelector('[data-testid="share"]')) {
  click(view, share);
  const layer = view.document.createElement("div");
  layer.innerHTML = '<div role="menu"><div role="menuitem"><svg><path d="M1"/></svg><span>Copy link</span></div></div>';
  view.document.body.append(layer);
  await waitFor(() => shareItems(view).length > 0, "the Share to Discord menu item");
  return shareItems(view);
}

const byText = (root, selector, text) =>
  [...root.querySelectorAll(selector)].filter((node) => node.textContent.trim() === text);
const sharePanel = ({ document }) =>
  [...document.querySelectorAll('[role="dialog"]')].find((dialog) => accessibleName(dialog) === "Share to Discord") ?? null;
const channelButtons = (panel, name) => {
  const group = [...panel.querySelectorAll('[role="group"]')].find((candidate) => accessibleName(candidate) === "Send to");
  return [...group.querySelectorAll("button")].filter((button) => name === undefined || accessibleName(button) === name);
};
const leafWithText = (root, prefix) =>
  [...root.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent.startsWith(prefix));
const sentText = (requests) => requests.map((request) => JSON.stringify(postedMessage(request).payload)).join("\n");
const stringsIn = (value) =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];
const sentStatusIds = (requests) =>
  new Set(
    requests
      .flatMap((request) => stringsIn(postedMessage(request).payload))
      .flatMap((text) => text.match(/https?:\/\/[^\s<>)]+/g) || [])
      .flatMap((url) => /\/status\/(\d+)/.exec(url)?.[1] ?? [])
  );

async function openPreview(view, share) {
  const [item] = await openShareMenu(view, share);
  click(view, item);
  const menu = await waitFor(() => sharePanel(view), "the Share to Discord preview");
  await waitFor(() => {
    const destinations = channelButtons(menu);
    return destinations.length > 0 && destinations.every((button) => !button.disabled);
  }, "the destinations to enable once the preview loads");
  return menu;
}

function expandPreview(view, menu) {
  const toggle = byText(menu, "button", "Preview message")[0];
  if (toggle.getAttribute("aria-expanded") !== "true") click(view, toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "the Preview message disclosure is expanded");
  return view.document.getElementById(toggle.getAttribute("aria-controls"));
}

// Approximates what a reader sees line by line: block boxes and preserved newlines break lines.
function renderedLines({ window }, root) {
  // jsdom does not inherit white-space, so take it from the nearest element that sets it.
  const whiteSpace = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const value = window.getComputedStyle(node).whiteSpace;
      if (value !== "normal") return value;
    }
    return "normal";
  };
  let text = "";
  const walk = (node) => {
    if (node.nodeType === node.TEXT_NODE) {
      const preserved = /^pre/.test(whiteSpace(node.parentElement));
      text += preserved ? node.textContent : node.textContent.replace(/\s+/g, " ");
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const block = !/^inline/.test(window.getComputedStyle(node).display);
    if (block) text += "\n";
    node.childNodes.forEach(walk);
    if (block) text += "\n";
  };
  walk(root);
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

const settingsDialog = ({ document }) =>
  document.querySelector('[role="dialog"][aria-label="Tweet Discord Share settings"]');
const addChannelCard = (dialog) => byText(dialog, "div", "Add channel")[0].parentElement;
const fieldInput = (container, label) => byText(container, "label", label)[0].control;
const editButtons = (dialog) => [...dialog.querySelectorAll("button")].filter((button) => /^(Edit|Done)$/.test(button.textContent));
const channelNames = (dialog) => editButtons(dialog).map(accessibleDescription);
const controlledBy = ({ document }, button) => document.getElementById(button.getAttribute("aria-controls"));

function editChannel(view, dialog, name) {
  const button = editButtons(dialog).find((candidate) => accessibleDescription(candidate) === name);
  click(view, button);
  return controlledBy(view, button);
}

function expandAddChannel(view, dialog) {
  click(view, byText(dialog, "button", "+ Add channel")[0]);
  return addChannelCard(dialog);
}

function type(view, input, value) {
  assertNotHiddenOrDisabled(view, input);
  input.value = value;
  input.dispatchEvent(new view.window.Event("input", { bubbles: true }));
}

async function openSettings(view) {
  view.menuCommands.get("Tweet Discord Share settings…")();
  return waitFor(() => settingsDialog(view), "the settings dialog");
}

test("the test click refuses disabled, inert, aria-hidden, and collapsed controls", (t) => {
  const { window } = new JSDOM(`<body>
    <button id="disabled" disabled>Disabled</button>
    <div inert><button id="inert">Inert</button></div>
    <div aria-hidden="true"><button id="aria-hidden">Hidden from AT</button></div>
    <div hidden><button id="collapsed">Collapsed</button></div>
    <button id="reachable">Reachable</button>
  </body>`, { pretendToBeVisual: true });
  t.after(() => window.close());
  const view = { window, document: window.document };
  for (const id of ["disabled", "inert", "aria-hidden", "collapsed"]) {
    assert.throws(() => click(view, window.document.getElementById(id)), assert.AssertionError, `the ${id} button is refused`);
  }
  assert.doesNotThrow(() => click(view, window.document.getElementById("reachable")));
});

test("sharing to the only destination posts the post to its webhook", async (t) => {
  const view = openPage(t, { destinations: [general] });

  const items = await openShareMenu(view);
  assert.equal(items.length, 1, "X's share menu gains exactly one Share to Discord item");
  click(view, items[0]);

  const success = await waitFor(() => toast(view, "success"), "the success toast");
  assert.match(success.textContent, /General/, "success toast names the destination");
  assert.equal(shareItems(view).length, 1, "the menu still has exactly one Share to Discord item");
  const messages = view.webhookPosts().map(postedMessage);
  assert.ok(messages.length >= 1, "the share POSTs to the webhook");
  const payloads = messages.map((message) => message.payload);
  assert.ok(payloads.some((payload) => payload.content?.split("\n").some((line) => line === postUrl)), "a message carries the post URL");
  assert.ok(
    payloads.some((payload) => payload.embeds?.some((embed) => embed.description?.includes(postText))),
    "an embed description carries the post text"
  );
  assert.equal(messages.flatMap((message) => message.files).length, 1, "the photo is uploaded as one file");
  for (const [index, payload] of payloads.entries()) {
    assert.deepEqual(payload.allowed_mentions?.parse, [], `message ${index + 1} disables mentions`);
  }
});

test("sharing with no destinations opens settings and sends nothing", async (t) => {
  const view = openPage(t, { destinations: [] });

  const [item] = await openShareMenu(view);
  click(view, item);

  await waitFor(() => settingsDialog(view), "the settings dialog");
  assert.equal(view.posts().length, 0, "no POST to any URL");
});

test("a Discord rejection shows its message in an error toast", async (t) => {
  const view = openPage(t, {
    destinations: [general],
    discordResponse: { status: 400, responseText: JSON.stringify({ message: "Invalid Form Body" }) }
  });

  const [item] = await openShareMenu(view);
  click(view, item);

  const error = await waitFor(() => toast(view, "error"), "the error toast");
  assert.equal(error.textContent, "Invalid Form Body");
});

test("choosing the second destination in the preview posts only to its webhook", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const menu = await openPreview(view);
  const preview = expandPreview(view, menu);
  assert.ok(preview.textContent.includes(postText), "the preview shows the post text");
  assert.ok(preview.textContent.includes(quoteText), "the preview shows the quoted post");
  click(view, channelButtons(menu, "Friends")[0]);

  const success = await waitFor(() => toast(view, "success"), "the success toast");
  assert.equal(success.textContent, "Sent to Friends", "success toast names the chosen destination");
  assert.equal(view.webhookPosts(webhookUrl).length, 0, "nothing is posted to the first destination");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the chosen destination receives the post text");
  assert.ok(sent.includes(quoteText), "with the quote toggle left on, the quote text is sent");
  assert.ok(sentStatusIds(view.webhookPosts(friendsWebhookUrl)).has(quoteId), "with the quote toggle left on, the quote permalink is sent");
});

test("a quoted post opens the preview for a single destination, and unchecking the quote keeps it out", async (t) => {
  const view = openPage(t, { destinations: [friends], quote: true });

  const menu = await openPreview(view);
  const preview = expandPreview(view, menu);
  const [quoteToggle] = byText(menu, "label", "Include quoted post");
  assert.ok(quoteToggle, "the preview offers the quote toggle");
  assert.ok(preview.textContent.includes(quoteText), "the preview starts with the quoted post");
  click(view, quoteToggle);
  assert.ok(!preview.textContent.includes(quoteText), "the preview drops the quoted post");
  click(view, channelButtons(menu, "Friends")[0]);

  await waitFor(() => toast(view, "success"), "the success toast");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the post text is still sent");
  assert.ok(!sent.includes(quoteText), "the quote text is not sent");
  assert.ok(!sentStatusIds(view.webhookPosts(friendsWebhookUrl)).has(quoteId), "no link to the quoted post is sent");
});

test("the summary line names the post, its media, and the quote, and follows the quote toggle", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const menu = await openPreview(view);
  const summary = leafWithText(menu, "Post by @alice");
  assert.equal(summary?.textContent, "Post by @alice · 1 media file · quoting @bob");
  click(view, byText(menu, "label", "Include quoted post")[0]);
  assert.equal(summary.textContent, "Post by @alice · 1 media file", "unchecking the quote drops it from the summary");
});

test("the preview shows the post link and the quoted-post line on separate lines", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const preview = expandPreview(view, await openPreview(view));
  const lines = renderedLines(view, preview);
  assert.ok(lines.includes(postUrl), `the post URL is a line of its own in ${JSON.stringify(lines)}`);
  assert.ok(
    lines.includes("↳ 📑 Quoted post: https://x.com/bob/status/999"),
    `the quoted-post line is a line of its own in ${JSON.stringify(lines)}`
  );
  assert.ok(preview.querySelector(`a[href="${postUrl}"]`), "the post URL is a link");
});

test("the preview shows where masked links in the post and the quote really go, and draws quote lines as a quote", async (t) => {
  const phish = "https://evil.example/phish";
  const lure = "https://lure.example/win";
  const view = openPage(t, {
    destinations: [general, friends],
    text: `Security notice [x.com/settings/security](${phish}) and _new_`,
    quote: `Claim it [x.com/rewards](${lure}) today\nSecond line`
  });

  const preview = expandPreview(view, await openPreview(view));
  for (const href of [phish, lure]) {
    const link = preview.querySelector(`a[href="${href}"]`);
    assert.ok(link, `the masked link to ${href} is a link`);
    assert.equal(link.title, href, "hovering shows the full destination");
    assert.match(accessibleName(link), new RegExp(`\\(${new URL(href).host.replace(".", "\\.")}\\)$`), "the link names the host it opens");
  }
  assert.equal(preview.querySelector('a[href="https://x.com/alice/status/1234567890"]').textContent, postUrl, "a bare URL is shown as itself, with no host suffix");
  assert.equal(leafWithText(preview, "new")?.tagName, "EM", "italics in the post text render as italics");

  const lines = renderedLines(view, preview);
  assert.ok(lines.includes("Second line"), `the quote's second line is a line of its own in ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((line) => line.startsWith(">")), `no literal "> " is shown in ${JSON.stringify(lines)}`);
  const quotes = [...preview.querySelectorAll("blockquote")].map((quote) => quote.textContent);
  assert.deepEqual(quotes, ["Claim it x.com/rewards (lure.example) today\nSecond line"], "the quoted post's lines sit in one block quote");
});

const videoMarkup = '<div data-testid="videoPlayer"><video src="https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/smoke.mp4"></video></div>';
const attachmentHint = (preview) => [...preview.querySelectorAll("*")].find((node) => node.children.length === 0 && /attached on send/.test(node.textContent))?.textContent;

for (const [what, setUp, says, hint] of [
  ["a post with only a photo", () => {}, "leaves video out", "1 media file attached on send."],
  ["a post with a video", ({ document }) => {
    document.querySelector('[data-testid="tweetPhoto"]').insertAdjacentHTML("afterend", videoMarkup);
  }, "says a large video goes as a link", "2 media files attached on send. Video too large for Discord goes as a link."]
]) {
  test(`the preview's attachment note for ${what} ${says}`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    setUp(view);
    const preview = expandPreview(view, await openPreview(view));

    assert.equal(attachmentHint(preview), hint);
  });
}

test("the video note follows the quote toggle when only the quoted post has a video", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });
  view.document.querySelector('[role="link"] [data-testid="tweetText"]').insertAdjacentHTML("afterend", videoMarkup);
  const menu = await openPreview(view);
  const preview = expandPreview(view, menu);
  assert.match(attachmentHint(preview), /Video too large for Discord goes as a link\.$/, "with the quote included, its video is attached");

  click(view, byText(menu, "label", "Include quoted post")[0].querySelector("input"));
  assert.equal(attachmentHint(preview), "1 media file attached on send.", "without the quote, only the photo is attached");
});

test("the preview starts collapsed unless Always show preview is on", async (t) => {
  for (const alwaysShowPreview of [false, true]) {
    const view = openPage(t, {
      store: new Map([["tds-destinations", [general]], ["tds-preferences", { alwaysShowPreview }]]),
      quote: true
    });
    const menu = await openPreview(view);
    const toggle = byText(menu, "button", "Preview message")[0];
    const preview = view.document.getElementById(toggle.getAttribute("aria-controls"));
    assert.equal(toggle.getAttribute("aria-expanded"), String(alwaysShowPreview), `aria-expanded with alwaysShowPreview ${alwaysShowPreview}`);
    assert.equal(preview.hidden, !alwaysShowPreview, `preview visibility with alwaysShowPreview ${alwaysShowPreview}`);
  }
});

test("once the post is ready, focus is on the first channel, arrow keys move between channels, and activating it sends there", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });

  const menu = await openPreview(view);
  const [generalItem] = channelButtons(menu, "General");
  const [friendsItem] = channelButtons(menu, "Friends");
  await waitFor(() => view.document.activeElement === generalItem, "focus on the first channel when none was used before");
  press(view, "ArrowDown");
  assert.equal(view.document.activeElement, friendsItem, "ArrowDown moves to the next channel");
  press(view, "ArrowUp");
  assert.equal(view.document.activeElement, generalItem, "ArrowUp moves back");

  click(view, view.document.activeElement);
  const success = await waitFor(() => toast(view, "success"), "the success toast");
  assert.equal(success.textContent, "Sent to General", "the focused channel is the one that receives the share");
  assert.equal(view.webhookPosts(friendsWebhookUrl).length, 0, "nothing is posted to the other channel");
});

test("the share panel is a non-modal dialog named by its heading, with the channels as plain buttons in a Send to group", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });

  const panel = await openPreview(view);
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.notEqual(panel.getAttribute("aria-modal"), "true", "the rest of X stays reachable while the panel is open");
  const heading = view.document.getElementById(panel.getAttribute("aria-labelledby"));
  assert.match(heading.tagName, /^H[1-6]$/, "the panel's name is its visible heading");
  assert.equal(heading.textContent, "Share to Discord");
  assert.deepEqual(channelButtons(panel).map(accessibleName), ["General", "Friends"]);
  assert.deepEqual(channelButtons(panel).map((button) => button.getAttribute("role")), [null, null], "channels are plain buttons");
  assert.equal(panel.querySelector('[role="menu"], [role="menuitem"]'), null, "nothing in the panel claims menu semantics");
  assert.equal(shareItems(view).length, 1, "X's own share menu still has exactly one Share to Discord item");
});

test("arrow keys cycle through the channels and leave the quote toggle and the preview to the browser", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const panel = await openPreview(view);
  const [generalButton, friendsButton] = channelButtons(panel);
  await waitFor(() => view.document.activeElement === generalButton, "focus on the first channel");
  press(view, "ArrowDown");
  assert.equal(view.document.activeElement, friendsButton, "ArrowDown moves to the next channel");
  press(view, "ArrowDown");
  assert.equal(view.document.activeElement, generalButton, "ArrowDown from the last channel wraps to the first");
  press(view, "ArrowUp");
  assert.equal(view.document.activeElement, friendsButton, "ArrowUp from the first channel wraps to the last");

  const quoteToggle = byText(panel, "label", "Include quoted post")[0].control;
  quoteToggle.focus();
  assert.equal(press(view, "ArrowDown"), true, "ArrowDown on the quote toggle is not taken over");
  assert.equal(view.document.activeElement, quoteToggle);

  const preview = expandPreview(view, panel);
  assert.equal(preview.getAttribute("role"), "region");
  assert.equal(accessibleName(preview), "Message preview");
  assert.equal(preview.tabIndex, 0, "Tab reaches the preview, so the keyboard can scroll it");
  for (const target of [preview, preview.querySelector("a")]) {
    target.focus();
    for (const key of ["ArrowDown", "ArrowUp"]) {
      assert.equal(press(view, key), true, `${key} on the preview's <${target.tagName.toLowerCase()}> is left to the browser to scroll`);
      assert.equal(view.document.activeElement, target, `${key} keeps focus in the preview`);
    }
  }
});

test("a channel's avatar shows the whole first character of its name, even a flag or a family emoji", async (t) => {
  const view = openPage(t, {
    destinations: [
      { ...general, id: "japan", label: "🇯🇵 Japan" },
      { ...friends, id: "family", label: "👨‍👩‍👧 Family" },
      { ...general, id: "eclair", label: "e\u0301clair club" }
    ]
  });

  const panel = await openPreview(view);
  const initials = channelButtons(panel).map((button) => button.querySelector(".tds-avatar").textContent);
  assert.deepEqual(initials, ["🇯🇵", "👨‍👩‍👧", "E\u0301"]);
});

test("the last-used channel is the default, named by its label alone and described as Last used", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  view.window.localStorage.setItem("tds-last-destination", "friends");

  const menu = await openPreview(view);
  assert.deepEqual(channelButtons(menu).map(accessibleName), ["General", "Friends"], "channel buttons are named by the channel label alone");
  const [friendsItem] = channelButtons(menu, "Friends");
  assert.equal(accessibleDescription(friendsItem), "Last used");
  assert.equal(accessibleDescription(channelButtons(menu, "General")[0]), "", "only the last-used channel carries the badge");
  await waitFor(() => view.document.activeElement === friendsItem, "focus on the last-used channel");
});

test("Escape closes the panel and returns focus to the post's Share button", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });

  const menu = await openPreview(view);
  await waitFor(() => channelButtons(menu).includes(view.document.activeElement), "focus on a channel");
  press(view, "Escape");

  assert.equal(sharePanel(view), null, "the panel closes");
  assert.equal(view.document.activeElement, view.document.querySelector('[data-testid="share"]'), "focus is back on Share");
});

// jsdom has no layout, so a test that cares where a control is gives it a box, as the browser would.
const placeAt = (node, top, left = 0, size = 34) => {
  node.getBoundingClientRect = () => new node.ownerDocument.defaultView.DOMRect(left, top, size, size);
};

const rerenders = [
  ["X re-renders the post", ({ document }) => {
    const article = document.querySelector("article");
    article.replaceWith(article.cloneNode(true));
  }],
  ["X re-renders its Share button", ({ document }) => {
    const share = document.querySelector('[data-testid="share"]');
    share.replaceWith(share.cloneNode(true));
  }]
];

for (const [what, rerender] of rerenders) {
  test(`when ${what} under the open panel, Escape focuses the post's new Share button`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    await openPreview(view);
    const oldShare = view.document.querySelector('[data-testid="share"]');

    rerender(view);
    press(view, "Escape");
    const share = view.document.querySelector('[data-testid="share"]');
    assert.notEqual(share, oldShare, "the page has a new Share button");
    assert.equal(view.document.activeElement, share, "focus is on the post's current Share button");
  });

  test(`when ${what} under settings opened from the panel, closing settings focuses the post's new Share button`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    const menu = await openPreview(view);
    click(view, [...menu.querySelectorAll("button")].find((button) => accessibleName(button) === "Settings"));
    const dialog = await waitFor(() => settingsDialog(view), "the settings dialog");

    rerender(view);
    click(view, byText(dialog, "button", "Cancel")[0]);
    assert.equal(view.document.activeElement, view.document.querySelector('[data-testid="share"]'), "focus is on the post's current Share button");
  });
}

// The shared copy sits in view; the same post appears again far up the timeline, first in the page.
function pageWithTwoCopies({ document }) {
  const shared = document.querySelector("article");
  const other = shared.cloneNode(true);
  shared.before(other);
  const shareOf = (article) => article.querySelector('[data-testid="share"]');
  placeAt(shareOf(shared), 300, 800);
  for (const control of other.querySelectorAll("a, button")) placeAt(control, -2000, 800);
  return { shared, other, shareOf };
}

for (const [where, otherTop] of [["far out of view", -2000], ["also in view", 500]]) {
  test(`when X re-renders the shared copy of a post whose other copy is ${where}, the panel and focus stay with the shared copy`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    const { shared, other, shareOf } = pageWithTwoCopies(view);
    for (const control of other.querySelectorAll("a, button")) placeAt(control, otherTop, 800);
    const panel = await openPreview(view, shareOf(shared));

    const rerendered = shared.cloneNode(true);
    shared.replaceWith(rerendered);
    placeAt(shareOf(rerendered), 300, 800);
    view.window.dispatchEvent(new view.window.Event("resize"));
    const top = parseFloat(panel.style.top);
    assert.ok(Math.abs(top - 300) < Math.abs(top - otherTop), `the panel stays by the shared copy (top ${top})`);

    press(view, "Escape");
    assert.equal(view.document.activeElement, shareOf(rerendered), "focus is on the shared copy's new Share button");
  });
}

for (const [where, top, expected] of [
  ["far out of view", -2000, "a control in view"],
  ["in view", 500, "the other copy's Share button"]
]) {
  test(`when the shared copy is gone and the post's other copy is ${where}, Escape focuses ${expected}`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    const { shared, other, shareOf } = pageWithTwoCopies(view);
    const inView = view.document.createElement("a");
    inView.href = "/home";
    view.document.querySelector("main").prepend(inView);
    for (const control of other.querySelectorAll("a, button")) placeAt(control, top, 800);
    await openPreview(view, shareOf(shared));

    shared.remove();
    press(view, "Escape");
    assert.equal(view.document.activeElement, top < 0 ? inView : shareOf(other), expected);
  });
}

// X has closed its share menu by now, as it does on the Escape the userscript sends when it takes over.
function removePost({ document }) {
  document.querySelector('[role="menu"]')?.parentElement.remove();
  document.querySelector("article").remove();
}

// Each case builds the page around the post, then names where focus belongs once the post is gone.
const postGoneCases = [
  ["the main column has a control", "focus lands on the first control in the main column", ({ document }) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin", '<a href="/home" id="target">Home</a>');
  }],
  ["the main column's first control is collapsed", "focus skips it for the first control that can take focus", ({ document }) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin", '<div hidden><a href="/more">More</a></div><button id="target">Visible</button>');
  }],
  ["the main column's first control is scrolled away", "focus goes to a control in view, so the next Tab does not jump the page", ({ document }) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin", '<a href="/top" id="top">Top</a><a href="/near" id="target">Near</a>');
    placeAt(document.getElementById("top"), -2000);
    placeAt(document.getElementById("target"), 300);
  }],
  ["the main column has nothing focusable", "focus goes to the first control elsewhere on the page", ({ document }) => {
    document.body.insertAdjacentHTML("afterbegin", '<nav><a href="/home" id="target">Home</a></nav>');
  }],
  ["nothing on the page can take focus", "focus goes to the main column itself", ({ document }) => {
    document.querySelector("main").id = "target";
  }]
];

for (const [what, where, setUp] of postGoneCases) {
  test(`when the post is gone and ${what}, Escape never leaves focus on the page body: ${where}`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    setUp(view);
    await openPreview(view);

    removePost(view);
    press(view, "Escape");
    assert.equal(sharePanel(view), null, "the panel closes");
    assert.equal(view.document.activeElement, view.document.getElementById("target"), where);
  });
}

test("focusing the main column as a last resort leaves it unfocusable again once focus moves on", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const main = view.document.querySelector("main");
  await openPreview(view);

  removePost(view);
  press(view, "Escape");
  assert.equal(view.document.activeElement, main, "focus is on the main column");
  main.blur();
  assert.equal(main.hasAttribute("tabindex"), false, "X's main column is left as it was");
});

test("closing settings once the post is gone focuses the page, not a control of the closed dialog", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const home = view.document.createElement("a");
  home.href = "/home";
  view.document.querySelector("main").prepend(home);
  const menu = await openPreview(view);
  click(view, [...menu.querySelectorAll("button")].find((button) => accessibleName(button) === "Settings"));
  const dialog = await waitFor(() => settingsDialog(view), "the settings dialog");

  removePost(view);
  click(view, byText(dialog, "button", "Cancel")[0]);
  assert.equal(settingsDialog(view), null, "settings close");
  assert.equal(view.document.activeElement, home, "focus is on the page's first control");
});

function addComposer({ document }) {
  const composer = document.createElement("textarea");
  composer.setAttribute("aria-label", "Post text");
  document.querySelector("main").append(composer);
  return composer;
}

test("once the panel has closed, Escape elsewhere on X leaves focus alone", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const composer = addComposer(view);

  // Two activations in one task, as when X's menu and the item's own key handler both act on Enter.
  const [item] = await openShareMenu(view);
  click(view, item);
  click(view, item);
  await waitFor(() => {
    const menu = sharePanel(view);
    return menu && channelButtons(menu).every((button) => !button.disabled);
  }, "the second panel's channels to enable");
  press(view, "Escape");
  assert.equal(sharePanel(view), null, "Escape closes the panel");

  composer.focus();
  press(view, "Escape");
  press(view, "Escape");
  assert.equal(view.document.activeElement, composer, "focus stays in the composer");
  composer.blur();
  press(view, "Escape");
  assert.equal(view.document.activeElement, view.document.body, "with nothing focused, Escape does not pull focus to Share");
});

test("Escape after Shift+Tab out of the panel belongs to what has focus", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const composer = addComposer(view);

  const menu = await openPreview(view);
  composer.focus();
  press(view, "Escape");
  assert.equal(view.document.activeElement, composer, "focus stays in the composer");
  assert.equal(sharePanel(view), menu, "the panel stays open until dismissed from inside or by a click outside");
});

test("typing in X's composer while the panel is open costs the page no search for the post", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const composer = addComposer(view);
  await openPreview(view);
  composer.focus();
  // With the post re-rendered, finding its Share button again means searching the page.
  const article = view.document.querySelector("article");
  article.replaceWith(article.cloneNode(true));
  let searches = 0;
  for (const owner of [view.window.Document.prototype, view.window.Element.prototype]) {
    const querySelectorAll = owner.querySelectorAll;
    owner.querySelectorAll = function (...args) {
      searches += 1;
      return querySelectorAll.apply(this, args);
    };
  }

  for (const key of ["a", "j", "Shift", "Enter"]) press(view, key);
  assert.equal(searches, 0, "keys other than Escape search nothing");
  press(view, "Escape");
  assert.ok(searches > 0, "Escape does look for the post's Share button, to tell whether it owns the key");
  assert.equal(view.document.activeElement, composer, "Escape in the composer stays the composer's");
});

for (const [how, dismiss] of [
  ["pressing Escape", (view) => view.document.dispatchEvent(new view.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
  ["clicking outside", (view) => view.document.querySelector("main").dispatchEvent(new view.window.PointerEvent("pointerdown", { bubbles: true }))]
]) {
  test(`dismissing the preview by ${how} sends nothing`, async (t) => {
    const view = openPage(t, { destinations: [general, friends], quote: true });

    await openPreview(view);
    dismiss(view);

    assert.equal(sharePanel(view), null, "the preview closes");
    assert.equal(view.document.querySelector('[role="status"], [role="alert"]'), null, "no share starts");
    assert.equal(view.posts().length, 0, "no POST to any URL");
  });
}

test("a channel added in settings and saved persists across reloads and receives the next share", async (t) => {
  const view = openPage(t, { destinations: [] });

  const dialog = await openSettings(view);
  const addCard = addChannelCard(dialog);
  type(view, fieldInput(addCard, "Display name"), "Friends");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(dialog, "button", "Save")[0]);
  const saved = await waitFor(() => toast(view, "success"), "the Settings saved toast");
  assert.equal(saved.textContent, "Settings saved.");

  const reloaded = openPage(t, { store: view.store });
  const reopened = await openSettings(reloaded);
  assert.deepEqual(channelNames(reopened), ["Friends"], "settings list the saved channel after a reload");
  click(reloaded, byText(reopened, "button", "Cancel")[0]);

  const [item] = await openShareMenu(reloaded);
  click(reloaded, item);
  const success = await waitFor(() => toast(reloaded, "success"), "the share success toast");
  assert.equal(success.textContent, "Sent to Friends", "the share goes to the saved channel");
  assert.ok(reloaded.webhookPosts(friendsWebhookUrl).length > 0, "the saved channel's webhook receives the post");
});

test("a channel added with an existing channel's name still receives its own shares", async (t) => {
  const view = openPage(t, { destinations: [general] });

  const dialog = await openSettings(view);
  const addCard = expandAddChannel(view, dialog);
  type(view, fieldInput(addCard, "Display name"), "General");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(dialog, "button", "Save")[0]);
  await waitFor(() => toast(view, "success"), "the Settings saved toast");

  const reloaded = openPage(t, { store: view.store });
  const menu = await openPreview(reloaded);
  click(reloaded, channelButtons(menu, "General")[1]);
  await waitFor(() => toast(reloaded, "success"), "the share success toast");
  assert.equal(reloaded.webhookPosts(webhookUrl).length, 0, "nothing is posted to the first General channel");
  assert.ok(reloaded.webhookPosts(friendsWebhookUrl).length > 0, "the second General channel's webhook receives the post");
});

test("Test webhook sends one test message to the URL being added", async (t) => {
  const view = openPage(t, { destinations: [] });

  const addCard = addChannelCard(await openSettings(view));
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(addCard, "button", "Test webhook")[0]);

  const success = await waitFor(() => toast(view, "success"), "the test success toast");
  assert.equal(success.textContent, "Test message sent. Check that Discord channel.");
  assert.deepEqual(view.posts().map((request) => request.url), [friendsWebhookUrl], "exactly one POST, to the typed webhook");
});

test("Cancel discards edited and removed channels", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const stored = structuredClone([...view.store]);

  const dialog = await openSettings(view);
  type(view, fieldInput(editChannel(view, dialog, "General"), "Display name"), "Renamed");
  click(view, byText(dialog, "button", "Remove")[1]);
  assert.deepEqual(channelNames(dialog), ["Renamed"], "the dialog shows the pending edit and removal");
  click(view, byText(dialog, "button", "Cancel")[0]);
  assert.equal(settingsDialog(view), null, "Cancel closes settings");

  const reopened = await openSettings(view);
  assert.deepEqual(channelNames(reopened), ["General", "Friends"], "reopened settings show the original channels");
  assert.deepEqual([...view.store], stored, "storage is unchanged");
});

test("Save refuses an unfinished Add channel form, points at the field to fix, and saves once it is cleared", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const stored = structuredClone([...view.store]);

  const dialog = await openSettings(view);
  type(view, fieldInput(editChannel(view, dialog, "General"), "Display name"), "Renamed");
  click(view, byText(dialog, "span", "Always show preview before sending")[0]);
  const addCard = expandAddChannel(view, dialog);
  const newLabel = fieldInput(addCard, "Display name");
  const newUrl = fieldInput(addCard, "Webhook URL");
  const save = byText(dialog, "button", "Save")[0];
  const hint = "Finish or clear the Add channel form before saving.";

  for (const [what, label, url, message, offending] of [
    ["a name without a URL", "Friends", "", `Enter a valid Discord webhook URL. ${hint}`, newUrl],
    ["a URL without a name", "", friendsWebhookUrl, `Enter a display name. ${hint}`, newLabel],
    ["a non-webhook URL", "Friends", "https://example.com/not-a-webhook", `Enter a valid Discord webhook URL. ${hint}`, newUrl]
  ]) {
    type(view, newLabel, label);
    type(view, newUrl, url);
    const errorsBefore = toasts(view, "error").length;
    save.focus();
    click(view, save);

    const error = await waitFor(() => toasts(view, "error")[errorsBefore], `the error toast for ${what}`);
    assert.equal(error.textContent, message, `the toast for ${what} names the problem and the Add channel form`);
    assert.equal(view.document.activeElement, offending, `focus moves to the field to fix for ${what}`);
    assert.equal(settingsDialog(view), dialog, `settings stay open for ${what}`);
    assert.deepEqual([...view.store], stored, `storage is unchanged for ${what}`);
    assert.equal(toast(view, "success"), null, `no success toast for ${what}`);
    assert.deepEqual([newLabel.value, newUrl.value], [label, url], `the typed input stays in the form for ${what}`);
    assert.deepEqual(channelNames(dialog), ["Renamed"], `the channel list is unchanged for ${what}`);
  }

  type(view, newLabel, "");
  type(view, newUrl, "");
  click(view, save);
  const saved = await waitFor(() => toast(view, "success"), "the Settings saved toast once the form is cleared");
  assert.equal(saved.textContent, "Settings saved.");
  assert.equal(settingsDialog(view), null, "Save closes settings");
  assert.deepEqual(view.store.get("tds-destinations"), [{ ...general, label: "Renamed" }], "the rename persists");
  assert.equal(view.store.get("tds-preferences").alwaysShowPreview, true, "the preference change persists");
});

test("a Save blocked by an invalid channel leaves the channel being added in the Add channel form", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const stored = structuredClone([...view.store]);

  const dialog = await openSettings(view);
  type(view, fieldInput(editChannel(view, dialog, "General"), "Webhook URL"), "https://example.com/not-a-webhook");
  const addCard = expandAddChannel(view, dialog);
  type(view, fieldInput(addCard, "Display name"), "Friends");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(dialog, "button", "Save")[0]);

  const error = await waitFor(() => toast(view, "error"), "the error toast");
  assert.equal(error.textContent, "Fix invalid channel names or webhook URLs before saving.");
  assert.deepEqual(channelNames(dialog), ["General"], "the channel being added is not moved into the list");
  assert.deepEqual(
    [fieldInput(addCard, "Display name").value, fieldInput(addCard, "Webhook URL").value],
    ["Friends", friendsWebhookUrl],
    "the Add channel form keeps the typed channel"
  );
  assert.deepEqual([...view.store], stored, "storage is unchanged");
});

test("settings list each channel as a row with its name and webhook status, without the internal id", async (t) => {
  const view = openPage(t, { destinations: [{ ...general, id: "chan-7f3a" }, friends] });
  const dialog = await openSettings(view);

  assert.deepEqual(channelNames(dialog), ["General", "Friends"]);
  const [generalRow] = editButtons(dialog).map((button) => button.closest("li"));
  assert.ok(visibleText(generalRow).includes("Webhook saved"), "a saved channel says its webhook is saved");
  assert.ok(!dialog.textContent.includes("chan-7f3a"), "the internal channel id is not shown");
});

test("a channel's row says Not saved yet until its webhook is stored, and Webhook saved after Save", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const rowText = (dialog, name) =>
    visibleText(editButtons(dialog).find((button) => accessibleDescription(button) === name).closest("li"));

  const dialog = await openSettings(view);
  assert.match(rowText(dialog, "General"), /Webhook saved/, "a stored channel says its webhook is saved");
  const addCard = expandAddChannel(view, dialog);
  type(view, fieldInput(addCard, "Display name"), "Friends");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(addCard, "button", "Add to list")[0]);
  assert.match(rowText(dialog, "Friends"), /Not saved yet/, "a channel added to the list is not saved yet");
  assert.doesNotMatch(rowText(dialog, "Friends"), /Webhook saved/);

  const generalForm = editChannel(view, dialog, "General");
  type(view, fieldInput(generalForm, "Webhook URL"), friendsWebhookUrl);
  assert.match(rowText(dialog, "General"), /Not saved yet/, "a changed webhook URL is not saved yet");
  type(view, fieldInput(generalForm, "Webhook URL"), webhookUrl);
  assert.match(rowText(dialog, "General"), /Webhook saved/, "restoring the stored URL says saved again");
  type(view, fieldInput(generalForm, "Display name"), "Renamed");
  assert.match(rowText(dialog, "Renamed"), /Webhook saved/, "a rename leaves the stored webhook saved");

  click(view, byText(dialog, "button", "Save")[0]);
  await waitFor(() => toast(view, "success"), "the Settings saved toast");
  const reopened = await openSettings(view);
  assert.match(rowText(reopened, "Renamed"), /Webhook saved/);
  assert.match(rowText(reopened, "Friends"), /Webhook saved/, "once saved, the added channel says so");
});

test("Remove moves focus to the next row, else the previous row, else the Add channel form", async (t) => {
  const third = { id: "third", label: "Third", webhookUrl: "https://discord.com/api/webhooks/789/third-QRS" };
  const view = openPage(t, { destinations: [general, friends, third] });
  const dialog = await openSettings(view);
  const remove = (name) =>
    click(view, byText(dialog, "button", "Remove").find((button) => accessibleDescription(button) === name));
  const focused = () => view.document.activeElement;

  remove("Friends");
  assert.deepEqual([focused().textContent, accessibleDescription(focused())], ["Edit", "Third"], "focus moves to the next row");
  remove("Third");
  assert.deepEqual([focused().textContent, accessibleDescription(focused())], ["Edit", "General"], "with no next row, focus moves to the previous row");
  remove("General");
  assert.equal(focused(), fieldInput(addChannelCard(dialog), "Display name"), "with no rows left, focus moves into the Add channel form");
});

test("Edit opens one channel's form inline and becomes Done, and Done closes it", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const dialog = await openSettings(view);
  const [generalEdit, friendsEdit] = editButtons(dialog);
  const generalForm = controlledBy(view, generalEdit);
  const friendsForm = controlledBy(view, friendsEdit);
  assert.deepEqual([generalForm.hidden, friendsForm.hidden], [true, true], "channel forms start collapsed");

  click(view, generalEdit);
  assert.equal(generalForm.hidden, false, "Edit opens the channel's form");
  assert.deepEqual([generalEdit.textContent, generalEdit.getAttribute("aria-expanded")], ["Done", "true"]);
  assert.equal(view.document.activeElement, fieldInput(generalForm, "Display name"), "focus moves into the form");
  type(view, fieldInput(generalForm, "Webhook URL"), "https://example.com/not-a-webhook");
  assert.ok(visibleText(generalEdit.closest("li")).includes("Needs a valid webhook URL"), "the row flags the bad webhook");

  click(view, friendsEdit);
  assert.deepEqual([generalForm.hidden, friendsForm.hidden], [true, false], "opening another channel closes the first");
  assert.equal(generalEdit.textContent, "Edit");

  click(view, friendsEdit);
  assert.equal(friendsForm.hidden, true, "Done closes the form");
  assert.deepEqual([friendsEdit.textContent, friendsEdit.getAttribute("aria-expanded")], ["Edit", "false"]);
  assert.equal(view.document.activeElement, friendsEdit, "focus returns to the button");
});

test("+ Add channel expands the Add channel form, Discard collapses it, and Add to list adds a row", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const dialog = await openSettings(view);
  const toggle = byText(dialog, "button", "+ Add channel")[0];
  const addCard = addChannelCard(dialog);
  assert.equal(addCard.hidden, true, "with a channel saved, the Add channel form starts collapsed");

  click(view, toggle);
  assert.deepEqual([addCard.hidden, toggle.hidden], [false, true], "the toggle gives way to the form");
  assert.equal(view.document.activeElement, fieldInput(addCard, "Display name"), "focus moves to the name field");
  type(view, fieldInput(addCard, "Display name"), "Friends");
  click(view, byText(addCard, "button", "Discard")[0]);
  assert.deepEqual([addCard.hidden, toggle.hidden], [true, false], "Discard collapses the form");
  assert.equal(view.document.activeElement, toggle);
  assert.equal(fieldInput(addCard, "Display name").value, "", "Discard clears what was typed");

  expandAddChannel(view, dialog);
  type(view, fieldInput(addCard, "Display name"), "Friends");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(addCard, "button", "Add to list")[0]);
  assert.deepEqual(channelNames(dialog), ["General", "Friends"], "the new channel joins the list");
  assert.equal(addCard.hidden, true, "the form collapses again");
});

for (const [what, field, value] of [
  ["an emptied name", "Display name", ""],
  ["a non-webhook URL", "Webhook URL", "https://example.com/not-a-webhook"]
]) {
  test(`a Save blocked by ${what} reopens that channel and focuses the field to fix`, async (t) => {
    const view = openPage(t, { destinations: [general, friends] });
    const stored = structuredClone([...view.store]);
    const dialog = await openSettings(view);

    const friendsForm = editChannel(view, dialog, "Friends");
    type(view, fieldInput(friendsForm, field), value);
    click(view, editButtons(dialog)[1]);
    assert.equal(friendsForm.hidden, true, "the channel's form is closed before saving");
    click(view, byText(dialog, "button", "Save")[0]);

    const error = await waitFor(() => toast(view, "error"), "the error toast");
    assert.equal(error.textContent, "Fix invalid channel names or webhook URLs before saving.");
    assert.equal(friendsForm.hidden, false, "Save reopens the channel to fix");
    assert.equal(view.document.activeElement, fieldInput(friendsForm, field), "focus is on the field to fix");
    assert.deepEqual([...view.store], stored, "storage is unchanged");
  });
}

test("settings focus the dialog, keep Tab inside it, and return focus on close", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const share = view.document.querySelector('[data-testid="share"]');
  share.focus();

  const dialog = await openSettings(view);
  assert.equal(view.document.activeElement, dialog, "with channels saved, focus starts on the dialog");
  const close = byText(dialog, "button", "×")[0];
  const save = byText(dialog, "button", "Save")[0];
  save.focus();
  press(view, "Tab");
  assert.equal(view.document.activeElement, close, "Tab past the last control wraps to the first");
  press(view, "Tab", { shiftKey: true });
  assert.equal(view.document.activeElement, save, "Shift+Tab past the first control wraps to the last");

  press(view, "Escape");
  assert.equal(settingsDialog(view), null, "Escape closes settings");
  assert.equal(view.document.activeElement, share, "focus returns to where it was");
});

test("with no channels, settings show the setup steps and focus the open Add channel form", async (t) => {
  const view = openPage(t, { destinations: [] });
  const dialog = await openSettings(view);

  const steps = leafWithText(dialog, "No channels yet").parentElement;
  assertNotHiddenOrDisabled(view, steps);
  const addCard = addChannelCard(dialog);
  assertNotHiddenOrDisabled(view, addCard);
  assert.equal(byText(dialog, "button", "+ Add channel")[0].hidden, true, "there is nothing to expand");
  assert.equal(view.document.activeElement, fieldInput(addCard, "Display name"), "focus is on the name field");
});

test("settings opened from the share panel return focus to Share on close", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const menu = await openPreview(view);

  click(view, [...menu.querySelectorAll("button")].find((button) => accessibleName(button) === "Settings"));
  const dialog = await waitFor(() => settingsDialog(view), "the settings dialog");
  assert.equal(sharePanel(view), null, "the panel gives way to settings");
  click(view, byText(dialog, "button", "Cancel")[0]);
  assert.equal(view.document.activeElement, view.document.querySelector('[data-testid="share"]'));
});

test("settings opened from the userscript menu while the panel has focus return focus to Share on close", async (t) => {
  const view = openPage(t, { destinations: [general, friends] });
  const menu = await openPreview(view);
  await waitFor(() => channelButtons(menu).includes(view.document.activeElement), "focus on a channel");

  await openSettings(view);
  assert.equal(sharePanel(view), null, "settings close the panel");
  press(view, "Escape");
  assert.equal(settingsDialog(view), null, "settings close");
  assert.equal(view.document.activeElement, view.document.querySelector('[data-testid="share"]'), "focus is back on Share");
});

test("every settings input is named by its label", async (t) => {
  const view = openPage(t, { destinations: [general] });
  const dialog = await openSettings(view);

  const inputs = [...dialog.querySelectorAll("input")];
  assert.ok(inputs.length >= 5, "settings show the channel, Add channel, and preference inputs");
  for (const input of inputs) {
    assert.ok(input.labels.length > 0, `the ${input.type} input with value "${input.value}" has a label`);
  }
});
