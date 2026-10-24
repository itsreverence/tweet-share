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
const toasts = ({ document }, state) => [...document.querySelectorAll(`.tds-toast[data-state="${state}"]`)];

async function openShareMenu(view) {
  click(view, view.document.querySelector('[data-testid="share"]'));
  const layer = view.document.createElement("div");
  layer.innerHTML = '<div role="menu"><div role="menuitem"><svg><path d="M1"/></svg><span>Copy link</span></div></div>';
  view.document.body.append(layer);
  await waitFor(() => shareItems(view).length > 0, "the Share to Discord menu item");
  return shareItems(view);
}

const byText = (root, selector, text) =>
  [...root.querySelectorAll(selector)].filter((node) => node.textContent.trim() === text);
const previewMenu = ({ document }) => document.querySelector('[role="menu"][aria-label="Share to Discord"]');
const sentText = (requests) => requests.map((request) => JSON.stringify(postedMessage(request).payload)).join("\n");
const sentUrls = (requests) => new Set(sentText(requests).match(/https?:\/\/[^\s"<>)]+/g));

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

const settingsDialog = ({ document }) =>
  document.querySelector('[role="dialog"][aria-label="Tweet Discord Share settings"]');
const channelList = (dialog) => dialog.querySelector(".tds-settings__list");
const addChannelCard = (dialog) => byText(dialog, "div", "Add channel")[0].parentElement;
const fieldInput = (container, label) => byText(container, "label", label)[0].parentElement.querySelector("input");
const channelNames = (dialog) =>
  byText(channelList(dialog), "label", "Display name").map((label) => label.parentElement.querySelector("input").value);

function type({ window }, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function openSettings(view) {
  view.menuCommands.get("Tweet Discord Share settings…")();
  return waitFor(() => settingsDialog(view), "the settings dialog");
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
  assert.ok(menu.textContent.includes(postText), "the preview shows the post text");
  assert.ok(menu.textContent.includes(quoteText), "the preview shows the quoted post");
  click(view, byText(menu, '[role="menuitem"]', "Friends")[0]);

  const success = await waitFor(() => toast(view, "success"), "the success toast");
  assert.equal(success.textContent, "Sent to Friends", "success toast names the chosen destination");
  assert.equal(view.webhookPosts(webhookUrl).length, 0, "nothing is posted to the first destination");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the chosen destination receives the post text");
  assert.ok(sent.includes(quoteText), "with the quote toggle left on, the quote text is sent");
  assert.ok(sentUrls(view.webhookPosts(friendsWebhookUrl)).has(quoteUrl), "with the quote toggle left on, the quote permalink is sent");
});

test("a quoted post opens the preview for a single destination, and unchecking the quote keeps it out", async (t) => {
  const view = openPage(t, { destinations: [friends], quote: true });

  const menu = await openPreview(view);
  const [quoteToggle] = byText(menu, "label", "Include quoted tweet");
  assert.ok(quoteToggle, "the preview offers the quote toggle");
  click(view, quoteToggle);
  assert.ok(!menu.textContent.includes(quoteText), "the preview drops the quoted post");
  click(view, byText(menu, '[role="menuitem"]', "Friends")[0]);

  await waitFor(() => toast(view, "success"), "the success toast");
  const sent = sentText(view.webhookPosts(friendsWebhookUrl));
  assert.ok(sent.includes(postText), "the post text is still sent");
  assert.ok(!sent.includes(quoteText), "the quote text is not sent");
  assert.ok(!sentUrls(view.webhookPosts(friendsWebhookUrl)).has(quoteUrl), "the quote permalink is not sent");
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
  const addCard = addChannelCard(dialog);
  type(view, fieldInput(addCard, "Display name"), "General");
  type(view, fieldInput(addCard, "Webhook URL"), friendsWebhookUrl);
  click(view, byText(dialog, "button", "Save")[0]);
  await waitFor(() => toast(view, "success"), "the Settings saved toast");

  const reloaded = openPage(t, { store: view.store });
  const menu = await openPreview(reloaded);
  click(reloaded, byText(menu, '[role="menuitem"]', "General")[1]);
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
  type(view, [...dialog.querySelectorAll("input")].find((input) => input.value === "General"), "Renamed");
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
  type(view, fieldInput(channelList(dialog), "Display name"), "Renamed");
  click(view, byText(dialog, "span", "Always show preview before sending")[0]);
  const addCard = addChannelCard(dialog);
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
  type(view, fieldInput(channelList(dialog), "Webhook URL"), "https://example.com/not-a-webhook");
  const addCard = addChannelCard(dialog);
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
