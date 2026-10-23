import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildUserscript } from "../scripts/userscript-bundle.mjs";

const { source: userscript } = buildUserscript();
const webhookUrl = "https://discord.com/api/webhooks/123/abc-DEF";
const friendsWebhookUrl = "https://discord.com/api/webhooks/456/friends-XYZ";
const postUrl = "https://x.com/alice/status/1234567890";
const postText = "Hello from the smoke test";
const quoteUrl = "https://x.com/bob/status/999";
const quoteText = "Bob's quoted words";
const photoUrl = "https://pbs.twimg.com/media/SmokePhoto?format=jpg&name=small";
const general = { id: "general", label: "General", webhookUrl };
const friends = { id: "friends", label: "Friends", webhookUrl: friendsWebhookUrl };
const quoteMarkup = `<div role="link" tabindex="0">
    <div data-testid="User-Name"><span>Bob</span><span>@bob</span></div>
    <a href="/bob/status/999"><span>Show more</span></a>
    <div data-testid="tweetText"><span>${quoteText}</span></div>
  </div>`;
const page = ({ quote }) => `<!doctype html><body><main>
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a><a href="/alice"><span>@alice</span></a></div>
  <a href="/alice/status/1234567890"><time datetime="2026-06-10T21:06:19.000Z">Jun 10</time></a>
  <div data-testid="tweetText"><span>${postText}</span></div>
  <div data-testid="tweetPhoto"><img alt="Image" src="${photoUrl}"></div>
  ${quote ? quoteMarkup : ""}
  <div role="group"><button data-testid="share" aria-label="Share post"><svg><path d="M0"/></svg></button></div>
</article></main></body>`;

function openPage(t, {
  destinations = [],
  quote = false,
  store = new Map([
    ["tds-destinations", destinations],
    ["tds-preferences", { alwaysShowPreview: false }]
  ]),
  discordResponse = { status: 204, responseText: "" }
}) {
  const dom = new JSDOM(page({ quote }), {
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

const click = ({ window }, node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const shareItems = ({ document }) =>
  [...document.querySelectorAll('[role="menuitem"]')].filter((item) => item.textContent.trim() === "Share to Discord");
const toast = ({ document }, state) => document.querySelector(`.tds-toast[data-state="${state}"]`);

async function openShareMenu(view) {
  click(view, view.document.querySelector('[data-testid="share"]'));
  const layer = view.document.createElement("div");
  layer.innerHTML = '<div role="menu"><div role="menuitem"><svg><path d="M1"/></svg><span>Copy link</span></div></div>';
  view.document.body.append(layer);
  await waitFor(() => shareItems(view).length > 0, "the Share to Discord menu item");
  return shareItems(view);
}

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

  await waitFor(() => view.document.querySelector('[role="dialog"][aria-label="Tweet Discord Share settings"]'), "the settings dialog");
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

const byText = (root, selector, text) =>
  [...root.querySelectorAll(selector)].filter((node) => node.textContent.trim() === text);
const previewMenu = ({ document }) => document.querySelector('[role="menu"][aria-label="Share to Discord"]');
const sentText = (requests) => requests.map((request) => JSON.stringify(postedMessage(request).payload)).join("\n");

async function openPreview(view) {
  const [item] = await openShareMenu(view);
  click(view, item);
  const menu = await waitFor(() => previewMenu(view), "the Share to Discord preview");
  await waitFor(() => {
    const destinations = [...menu.querySelectorAll('[role="menuitem"]')];
    return destinations.length > 0 && destinations.every((button) => !button.disabled);
  }, "the destinations to enable once the preview loads");
  return menu;
}

test("choosing the second destination in the preview posts only to its webhook", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const menu = await openPreview(view);
  assert.ok(menu.textContent.includes(postText), "the preview shows the post text");
  assert.ok(menu.textContent.includes(quoteText), "the preview shows the quoted post");
  click(view, byText(menu, '[role="menuitem"]', "Friends")[0]);

  const success = await waitFor(() => toast(view, "success"), "the success toast");
  assert.equal(success.textContent, "Sent to Friends", "success toast names the chosen destination");
  assert.equal(view.webhookPosts(webhookUrl).length, 0, "nothing is posted to the first destination");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the chosen destination receives the post text");
  assert.ok(sent.includes(quoteText), "with the quote toggle left on, the quote text is sent");
  assert.ok(sent.includes(quoteUrl), "with the quote toggle left on, the quote permalink is sent");
});

test("unchecking Include quoted tweet keeps the quote out of the preview and the message", async (t) => {
  const view = openPage(t, { destinations: [general, friends], quote: true });

  const menu = await openPreview(view);
  click(view, byText(menu, "label", "Include quoted tweet")[0]);
  assert.ok(!menu.textContent.includes(quoteText), "the preview drops the quoted post");
  click(view, byText(menu, '[role="menuitem"]', "Friends")[0]);

  await waitFor(() => toast(view, "success"), "the success toast");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the post text is still sent");
  assert.ok(!sent.includes(quoteText), "the quote text is not sent");
  assert.ok(!sent.includes(quoteUrl), "the quote permalink is not sent");
});

for (const [how, dismiss] of [
  ["pressing Escape", (view) => view.document.dispatchEvent(new view.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
  ["clicking outside", (view) => view.document.querySelector("main").dispatchEvent(new view.window.PointerEvent("pointerdown", { bubbles: true }))]
]) {
  test(`dismissing the preview by ${how} sends nothing`, async (t) => {
    const view = openPage(t, { destinations: [general, friends], quote: true });

    await openPreview(view);
    dismiss(view);

    assert.equal(previewMenu(view), null, "the preview closes");
    assert.equal(view.document.querySelector('[role="status"], [role="alert"]'), null, "no share starts");
    assert.equal(view.posts().length, 0, "no POST to any URL");
  });
}
