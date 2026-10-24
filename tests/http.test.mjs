import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "userscript", "src", "01-http.js"), "utf8");

class FakeFormData {
  entries = [];

  append(...entry) {
    this.entries.push(entry);
  }
}

function loadHttpContext(respond, { holdTimers = false } = {}) {
  const calls = [];
  const delays = [];
  const timers = [];
  const setTimeout = (callback, ms) => {
    delays.push(ms);
    if (holdTimers) timers.push(callback);
    else queueMicrotask(callback);
  };
  const context = createContext({
    Blob,
    FormData: FakeFormData,
    console,
    setTimeout,
    window: { setTimeout },
    GM: {
      xmlHttpRequest(options) {
        calls.push(options);
        queueMicrotask(() => respond(options, calls.length));
      }
    }
  });

  runInNewContext(`${source}
this.exports = {
  parseDiscordResponse,
  request,
  requestMultipart
};`, context);

  return { ...context.exports, calls, delays, timers };
}

function assertBoundedTimeout(options) {
  assert.ok(
    options.timeout >= 5_000 && options.timeout <= 120_000,
    `request timeout of ${options.timeout} ms is outside the 5000 to 120000 ms bound`
  );
}

test("request applies a bounded timeout and reports timeout failures", async () => {
  const { request, calls } = loadHttpContext((options) => options.ontimeout());

  await assert.rejects(() => request("POST", "https://discord.com/api/webhooks/1/token", {}), /timed out/i);
  assert.equal(calls.length, 1);
  assertBoundedTimeout(calls[0]);
});

test("request retries explicit Discord rate limits using retry_after", async () => {
  const { request, calls, delays, timers } = loadHttpContext((options, attempt) => {
    if (attempt === 1) {
      options.onload({ status: 429, responseText: '{"message":"rate limited","retry_after":0.25}' });
      return;
    }
    options.onload({ status: 204, responseText: "" });
  }, { holdTimers: true });

  const sent = request("POST", "https://discord.com/api/webhooks/1/token", { content: "hello" });
  await new Promise(setImmediate);
  assert.equal(calls.length, 1, "no retry before the retry_after delay elapses");
  assert.deepEqual(delays, [250]);
  timers.shift()();
  await sent;
  assert.equal(calls.length, 2, "retries once the retry_after delay elapses");
});

test("multipart requests wait before retrying a rate limit without retry_after", async () => {
  const { requestMultipart, calls, delays, timers } = loadHttpContext((options, attempt) => {
    if (attempt === 1) {
      options.onload({ status: 429, responseText: '{"message":"rate limited"}' });
      return;
    }
    options.onload({ status: 200, responseText: '{"id":"1"}' });
  }, { holdTimers: true });

  const sent = requestMultipart("https://discord.com/api/webhooks/1/token", { content: "hello" }, []);
  await new Promise(setImmediate);
  assert.equal(calls.length, 1, "no retry before the default delay elapses");
  assert.ok(delays.length === 1 && delays[0] > 0, `waits a nonzero default delay, got ${delays}`);
  timers.shift()();
  await sent;
  assert.equal(calls.length, 2, "retries once the default delay elapses");
});

test("request stops after the bounded rate-limit retry count", async () => {
  const { request, calls, delays } = loadHttpContext((options) => {
    options.onload({ status: 429, responseText: '{"message":"rate limited","retry_after":0}' });
  });

  await assert.rejects(
    () => request("POST", "https://discord.com/api/webhooks/1/token", {}),
    /rate limited/i
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [0, 0]);
});

test("request does not retry before a long retry_after period", async () => {
  const { request, calls, delays } = loadHttpContext((options) => {
    options.onload({ status: 429, responseText: '{"message":"try later","retry_after":30}' });
  });

  await assert.rejects(
    () => request("POST", "https://discord.com/api/webhooks/1/token", {}),
    /try later/i
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("multipart requests do not retry ambiguous network failures", async () => {
  const { requestMultipart, calls } = loadHttpContext((options) => options.onerror());

  await assert.rejects(
    () => requestMultipart("https://discord.com/api/webhooks/1/token", { content: "hello" }, []),
    /Could not reach Discord/i
  );
  assert.equal(calls.length, 1);
  assertBoundedTimeout(calls[0]);
});
