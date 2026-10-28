import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "userscript", "src");
const themeSource = ["00-config.js", "00-theme.js"].map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");
const context = {};
runInNewContext(`${themeSource}\nthis.resolveTheme = resolveTheme;`, context);
const resolveTheme = (environment) => ({ ...context.resolveTheme(environment) });

// The theme the userscript reads off a page, as X would paint it.
function themeOnPage(t, html) {
  const { window } = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => window.close());
  window.eval(themeSource);
  return { ...window.eval("resolveTheme(readThemeEnvironment())") };
}

test("a white page with no X variables gets the light palette", () => {
  const theme = resolveTheme({ pageBackground: [255, 255, 255] });
  assert.equal(theme.surface, "255 255 255");
  assert.equal(theme.text, "15 20 25");
  assert.equal(theme.subtle, "83 100 113");
  assert.equal(theme.shadow, "101 119 134", "light surfaces cast X's gray shadow, not a white glow");
});

test("X's dim navy page gets the dim palette", () => {
  const theme = resolveTheme({ pageBackground: [21, 32, 43] });
  assert.equal(theme.surface, "21 32 43");
  assert.equal(theme.text, "247 249 249");
  assert.equal(theme.border, "56 68 77");
});

test("a black page gets the dark palette", () => {
  const theme = resolveTheme({ pageBackground: [0, 0, 0] });
  assert.equal(theme.surface, "0 0 0");
  assert.equal(theme.text, "231 233 234");
  assert.equal(theme.shadow, "255 255 255");
});

test("with nothing to read, the dark palette and X's accents apply", () => {
  assert.deepEqual(resolveTheme({}), resolveTheme({ pageBackground: [0, 0, 0] }));
  const theme = resolveTheme();
  assert.deepEqual([theme.blue, theme.green, theme.red], ["29 155 240", "0 186 124", "244 33 46"]);
});

test("X's text and accent variables refine the palette the page background picks", () => {
  const theme = resolveTheme({ variables: { text: "1 2 3", blue: "120 86 255" }, pageBackground: [255, 255, 255] });
  assert.equal(theme.text, "1 2 3", "X's text color is used as is");
  assert.equal(theme.blue, "120 86 255", "X's accent color is used as is");
  assert.equal(theme.surface, "255 255 255", "the surface follows the page background");
  assert.equal(theme.border, "207 217 222", "tokens X does not supply come from the light palette");
  assert.equal(theme.red, "244 33 46");
});

for (const [what, html, palette] of [
  ["a white body", `<body style="background-color: rgb(255, 255, 255)"></body>`, { surface: "255 255 255", text: "15 20 25", border: "207 217 222" }],
  ["X's dim navy body", `<body style="background-color: rgb(21, 32, 43)"></body>`, { surface: "21 32 43", text: "247 249 249", border: "56 68 77" }],
  ["a black body", `<body style="background-color: rgb(0, 0, 0)"></body>`, { surface: "0 0 0", text: "231 233 234", border: "47 51 54" }],
  ["a transparent body on a white page", `<html style="background-color: #fff"><body></body></html>`, { surface: "255 255 255", text: "15 20 25", border: "207 217 222" }]
]) {
  test(`${what} gets the matching palette`, (t) => {
    const theme = themeOnPage(t, html);
    assert.deepEqual({ surface: theme.surface, text: theme.text, border: theme.border }, palette);
  });
}

test("the page background picks the palette even when X's background variable disagrees", (t) => {
  const theme = themeOnPage(t, `<html style="--color-background: 255 255 255; --color-border: 239 243 244">
    <body style="background-color: rgb(21, 32, 43)"></body></html>`);
  assert.equal(theme.surface, "21 32 43", "the dim body wins over a white --color-background");
  assert.equal(theme.border, "56 68 77", "the border comes from the dim palette, not X's variable");
});

test("X's text and accent variables on the page apply over the palette", (t) => {
  const theme = themeOnPage(t, `<html><head><style>
    :root { --color-text: 1 2 3; --color-text-secondary: 4 5 6; --color-blue: 120 86 255; }
    body { background-color: rgb(0, 0, 0); }
  </style></head><body></body></html>`);
  assert.deepEqual([theme.text, theme.subtle, theme.blue], ["1 2 3", "4 5 6", "120 86 255"]);
  assert.equal(theme.surface, "0 0 0");
});
