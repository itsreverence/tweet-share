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

function loadHttpContext(respond) {
  const calls = [];
  const delays = [];
  const context = createContext({
    Blob,
    FormData: FakeFormData,
    console,
    window: { setTimeout },
    GM: {
      xmlHttpRequest(options) {
        calls.push(options);
        queueMicrotask(() => respond(options, calls.length));
      }
    },
    __delays: delays
  });

  runInNewContext(`${source}
delay = async (ms) => __delays.push(ms);
this.exports = {
  HTTP_TIMEOUT_MS,
  parseDiscordResponse,
  request,
  requestMultipart
};`, context);

  return { ...context.exports, calls, delays };
}

test("request applies a bounded timeout and reports timeout failures", async () => {
  const { request, calls, HTTP_TIMEOUT_MS } = loadHttpContext((options) => options.ontimeout());

  await assert.rejects(() => request("POST", "https://discord.com/api/webhooks/1/token", {}), /timed out/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeout, HTTP_TIMEOUT_MS);
});

test("request retries explicit Discord rate limits using retry_after", async () => {
  const { request, calls, delays } = loadHttpContext((options, attempt) => {
    if (attempt === 1) {
      options.onload({ status: 429, responseText: '{"message":"rate limited","retry_after":0.25}' });
      return;
    }
    options.onload({ status: 204, responseText: "" });
  });

  await request("POST", "https://discord.com/api/webhooks/1/token", { content: "hello" });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [250]);
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
});
