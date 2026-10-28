import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "userscript", "src");
const context = {};
runInNewContext(
  `${["00-config.js", "00-theme.js"].map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n")}
this.resolveTheme = resolveTheme;`,
  context
);
const resolveTheme = (environment) => ({ ...context.resolveTheme(environment) });

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

test("X's CSS variables win over the page background and fill only the tokens they define", () => {
  const theme = resolveTheme({
    variables: { surface: "21 32 43", text: "1 2 3", blue: "120 86 255" },
    pageBackground: [255, 255, 255]
  });
  assert.equal(theme.surface, "21 32 43");
  assert.equal(theme.text, "1 2 3", "X's text color is used as is");
  assert.equal(theme.blue, "120 86 255", "X's accent color is used as is");
  assert.equal(theme.border, "56 68 77", "missing tokens come from the palette X's background implies (dim)");
  assert.equal(theme.red, "244 33 46");
});
