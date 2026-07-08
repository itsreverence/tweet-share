import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "userscript", "src");

function loadPreferencesContext() {
  const storage = new Map();
  const code = ["00-config.js", "10-destinations.js", "10-preferences.js"]
    .map((name) => readFileSync(path.join(srcDir, name), "utf8"))
    .join("\n");

  const context = {
    console,
    GM: {
      getValue(key, defaultValue) {
        return Promise.resolve(storage.has(key) ? storage.get(key) : defaultValue);
      },
      setValue(key, value) {
        storage.set(key, value);
        return Promise.resolve();
      }
    }
  };

  runInNewContext(
    `${code}\nthis.exports = { sanitizePreferences, loadPreferences, savePreferences, DEFAULT_PREFERENCES };`,
    context
  );
  return { ...context.exports, storage };
}

const { sanitizePreferences, loadPreferences, savePreferences, DEFAULT_PREFERENCES, storage } =
  loadPreferencesContext();

test("sanitizePreferences applies defaults and drops removed keys", () => {
  assert.deepEqual({ ...sanitizePreferences(null) }, { ...DEFAULT_PREFERENCES });
  assert.deepEqual({ ...sanitizePreferences({ includeQuote: false, attachMedia: true, quoteLayout: "card" }) }, {
    alwaysShowPreview: true
  });
  assert.deepEqual({ ...sanitizePreferences({ alwaysShowPreview: false, attachMedia: false }) }, {
    alwaysShowPreview: false
  });
});

test("preferences persist through storage", async () => {
  await savePreferences({
    includeQuote: false,
    alwaysShowPreview: false,
    attachMedia: true,
    quoteLayout: "card"
  });
  const loaded = await loadPreferences();
  assert.equal(loaded.alwaysShowPreview, false);
  assert.equal(Object.hasOwn(loaded, "attachMedia"), false);
  assert.deepEqual({ ...storage.get("tds-preferences") }, {
    alwaysShowPreview: false
  });
});
