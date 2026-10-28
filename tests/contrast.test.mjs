import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "userscript", "src");
const themeSource = ["00-config.js", "00-theme.js"].map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n");

// WCAG 2 relative luminance and contrast ratio, computed here rather than by the code under test.
const channel = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const over = (base, top, alpha) => base.map((value, i) => top[i] * alpha + value * (1 - alpha));
const rgb = (value) => value.split(/\s+/).map(Number);

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const DISCORD_BLURPLE = [88, 101, 242];

// Every text/background pair the UI draws: [where, text colour, backgrounds from the bottom up].
// A colour is a theme token or an [r, g, b]; a background layer may be [colour, alpha] over what lies beneath.
const PAIRS = [
  ["text on the panel, dialog, toast, and embeds", "text", ["surface"]],
  ["text in the preview and the open channel form", "text", ["raised"]],
  ["text on a hovered button or row", "text", ["surface", ["text", 0.1]]],
  ["text on a hovered button in the open channel form", "text", ["raised", ["text", 0.08]]],
  ["a hovered channel's name", "text", ["surface", ["blue", 0.1]]],
  ["muted text and placeholders on the panel and dialog", "subtle", ["surface"]],
  ["muted text in the preview and the open channel form", "subtle", ["raised"]],
  ["Preview message, hovered", "subtle", ["surface", ["text", 0.07]]],
  ["links in an embed", "link", ["surface"]],
  ["links in the preview", "link", ["raised"]],
  ["+ Add channel", "link", ["surface"]],
  ["+ Add channel, hovered", "link", ["surface", ["link", 0.08]]],
  ["the default channel", WHITE, ["accent"]],
  ["the default channel, hovered", WHITE, ["accent", [BLACK, 0.1]]],
  ["Last used on the default channel", WHITE, ["accent", [BLACK, 0.2]]],
  ["Last used on the hovered default channel", WHITE, ["accent", [BLACK, 0.1], [BLACK, 0.2]]],
  ["Remove, and a channel's invalid status", "danger", ["surface"]],
  ["Remove, hovered", "danger", ["surface", ["danger", 0.1]]],
  ["Save", "surface", ["text"]],
  ["Save, hovered", "surface", ["surface", ["text", 0.85]]],
  ["the info toast's icon", "surface", ["link"]],
  ["the success toast's icon", "surface", ["success"]],
  ["the error toast's icon", "surface", ["danger"]],
  ["the preview's APP badge", WHITE, [DISCORD_BLURPLE]]
];

// What X itself publishes on :root in each theme, which the userscript reads.
const X_PAGES = {
  light: { background: "rgb(255, 255, 255)", text: "15 20 25", secondary: "83 100 113" },
  dim: { background: "rgb(21, 32, 43)", text: "247 249 249", secondary: "139 152 165" },
  dark: { background: "rgb(0, 0, 0)", text: "231 233 234", secondary: "113 118 123" }
};

function themeOnPage(t, page, withXVariables) {
  const variables = withXVariables
    ? `--color-text: ${page.text}; --color-text-secondary: ${page.secondary}; --color-blue: 29 155 240; --color-red: 244 33 46; --color-green: 0 186 124;`
    : "";
  const { window } = new JSDOM(`<html style="${variables}"><body style="background-color: ${page.background}"></body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  t.after(() => window.close());
  window.eval(themeSource);
  return { ...window.eval("resolveTheme(readThemeEnvironment())") };
}

for (const [name, page] of Object.entries(X_PAGES)) {
  for (const withXVariables of [false, true]) {
    test(`in X's ${name} theme${withXVariables ? " with X's own colour variables" : ""}, every text and background pair reaches 4.5:1`, (t) => {
      const theme = themeOnPage(t, page, withXVariables);
      const color = (token) => (Array.isArray(token) ? token : rgb(theme[token]));
      const failures = [];
      for (const [where, text, layers] of PAIRS) {
        const background = layers.reduce((beneath, layer) => {
          const [token, alpha] = typeof layer === "string" || layer.length === 3 ? [layer, 1] : layer;
          return beneath ? over(beneath, color(token), alpha) : color(token);
        }, null);
        const ratio = contrast(color(text), background);
        if (ratio < 4.5) failures.push(`${where}: ${ratio.toFixed(2)}`);
      }
      assert.deepEqual(failures, [], "pairs below 4.5:1");
    });
  }
}

test("a channel avatar's white initial reaches 4.5:1 at every one of the 360 hues", () => {
  const { window } = new JSDOM("", { runScripts: "outside-only" });
  window.eval(themeSource);
  const failures = [];
  for (let hue = 0; hue < 360; hue += 1) {
    const color = window.eval(`avatarColor(${hue})`);
    const ratio = contrast(WHITE, rgb(/^rgb\((.*)\)$/.exec(color)[1]));
    if (ratio < 4.5) failures.push(`hue ${hue}: ${color} ${ratio.toFixed(2)}`);
  }
  window.close();
  assert.deepEqual(failures, []);
});

test("avatars keep their hue, so channels still look different from one another", () => {
  const { window } = new JSDOM("", { runScripts: "outside-only" });
  window.eval(themeSource);
  const colors = new Set(Array.from({ length: 12 }, (_, i) => window.eval(`avatarColor(${i * 30})`)));
  window.close();
  assert.equal(colors.size, 12, "twelve hues 30 degrees apart give twelve colours");
});
