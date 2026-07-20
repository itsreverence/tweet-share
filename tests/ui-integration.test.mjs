import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiPath = path.join(root, "userscript", "src", "09-ui.js");
const uiSource = readFileSync(uiPath, "utf8").replace(/\nstartUi\(\);\s*$/, "");

function createUiHarness({ destinations = [], alwaysShowPreview = true, hasQuote = false } = {}) {
  const calls = {
    closeOverlay: 0,
    documentScans: 0,
    injected: [],
    menus: [],
    runShares: [],
    settings: 0
  };
  const queuedMicrotasks = [];
  let observerCallback = null;

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}
  }

  const document = {
    documentElement: {},
    addEventListener() {},
    querySelectorAll() {
      calls.documentScans += 1;
      return [];
    }
  };

  const context = createContext({
    console,
    document,
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    queueMicrotask(callback) {
      queuedMicrotasks.push(callback);
    },
    window: {
      setTimeout(callback) {
        callback();
      }
    },
    getDestinations: async () => destinations,
    loadPreferences: async () => ({ alwaysShowPreview }),
    extractTweet: () => ({ quote: hasQuote ? { text: "quote" } : null }),
    hasQuoteTweet: (tweet) => Boolean(tweet.quote),
    closeXOverlay() {
      calls.closeOverlay += 1;
    },
    openSettingsModal() {
      calls.settings += 1;
    },
    openDestinationMenu(...args) {
      calls.menus.push(args);
    },
    __calls: calls
  });

  runInNewContext(`${uiSource}
injectDiscordShareMenuItem = (menu) => __calls.injected.push(menu);
runShare = async (...args) => __calls.runShares.push(args);
this.exports = {
  installShareMenuIntegration,
  scanShareMenus,
  shareMenusNearNode,
  startDiscordShare
};`, context);

  return {
    ...context.exports,
    calls,
    flushMicrotasks() {
      while (queuedMicrotasks.length) queuedMicrotasks.shift()();
    },
    notify(records) {
      observerCallback(records);
    }
  };
}

function shareMenu() {
  return {
    nodeType: 1,
    getAttribute(name) {
      return name === "role" ? "menu" : null;
    },
    querySelectorAll(selector) {
      return selector === '[role="menuitem"]' ? [{ textContent: "Copy link" }] : [];
    }
  };
}

test("startDiscordShare opens settings when no destination exists", async () => {
  const { startDiscordShare, calls } = createUiHarness();

  await startDiscordShare({}, {});

  assert.equal(calls.closeOverlay, 1);
  assert.equal(calls.settings, 1);
  assert.equal(calls.runShares.length, 0);
});

test("startDiscordShare sends directly only for the one-destination no-preview path", async () => {
  const destination = { id: "friends", label: "Friends" };
  const { startDiscordShare, calls } = createUiHarness({
    destinations: [destination],
    alwaysShowPreview: false
  });

  const article = {};
  await startDiscordShare(article, {});

  assert.equal(calls.closeOverlay, 1);
  assert.equal(calls.runShares.length, 1);
  assert.equal(calls.runShares[0][0], article);
  assert.equal(calls.runShares[0][1], destination.id);
  assert.equal(calls.menus.length, 0);
});

test("startDiscordShare preserves preview when the post has a quote", async () => {
  const { startDiscordShare, calls } = createUiHarness({
    destinations: [{ id: "friends", label: "Friends" }],
    alwaysShowPreview: false,
    hasQuote: true
  });

  await startDiscordShare({}, {});

  assert.equal(calls.runShares.length, 0);
  assert.equal(calls.menus.length, 1);
  assert.equal(calls.menus[0][3].showQuoteOption, true);
});

test("mutation integration scans only added menu neighborhoods", () => {
  const menu = shareMenu();
  const child = {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: () => [],
    closest: () => menu
  };
  const { installShareMenuIntegration, calls, flushMicrotasks, notify } = createUiHarness();

  installShareMenuIntegration();
  assert.equal(calls.documentScans, 1);

  notify([{ addedNodes: [child] }, { addedNodes: [child] }]);
  flushMicrotasks();

  assert.equal(calls.documentScans, 1);
  assert.deepEqual(calls.injected, [menu]);
});
