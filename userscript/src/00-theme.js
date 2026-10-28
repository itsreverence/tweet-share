// Colors are RGB tuples ("231 233 234"), the format X publishes on :root (e.g. --color-text).
const TDS_FONT = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const TDS_RGB_PATTERN = /^\d+\s+\d+\s+\d+$/;

const THEME_PALETTES = {
  light: { surface: "255 255 255", raised: "247 249 249", text: "15 20 25", subtle: "83 100 113", border: "207 217 222", shadow: "101 119 134" },
  dim: { surface: "21 32 43", raised: "30 39 50", text: "247 249 249", subtle: "139 152 165", border: "56 68 77", shadow: "255 255 255" },
  dark: { surface: "0 0 0", raised: "22 24 28", text: "231 233 234", subtle: "113 118 123", border: "47 51 54", shadow: "255 255 255" }
};
const THEME_ACCENTS = { blue: "29 155 240", green: "0 186 124", red: "244 33 46" };
// Only text and accent colors come from X's variables; the page background picks the rest of the palette.
const X_THEME_VARIABLES = {
  text: "--color-text",
  subtle: "--color-text-secondary",
  blue: "--color-blue",
  green: "--color-green",
  red: "--color-red"
};

function themeNameForBackground([red, green, blue]) {
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  if (luminance > 0.55) return "light";
  return luminance > 0.06 ? "dim" : "dark";
}

// `variables` holds the X tokens the page defines; `pageBackground` is [r, g, b] or null.
function resolveTheme({ variables = {}, pageBackground = null } = {}) {
  const palette = THEME_PALETTES[pageBackground ? themeNameForBackground(pageBackground) : "dark"];
  return { ...palette, ...THEME_ACCENTS, ...variables };
}

function pageBackgroundRgb() {
  for (const node of [document.body, document.documentElement]) {
    if (!node) continue;
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(getComputedStyle(node).backgroundColor);
    if (match && Number(match[4] ?? 1) > 0) return match.slice(1, 4).map(Number);
  }
  return null;
}

function readThemeEnvironment() {
  const rootStyle = getComputedStyle(document.documentElement);
  const variables = {};
  for (const [token, name] of Object.entries(X_THEME_VARIABLES)) {
    const value = rootStyle.getPropertyValue(name).trim();
    if (TDS_RGB_PATTERN.test(value)) variables[token] = value;
  }
  return { variables, pageBackground: pageBackgroundRgb() };
}

function applyXThemeVars(element) {
  for (const [token, value] of Object.entries(resolveTheme(readThemeEnvironment()))) {
    element.style.setProperty(`--tds-${token}`, value);
  }
}

function tdsSharedSurfaceCss() {
  return `
    .${POPOVER_CLASS},
    .${TOAST_CLASS},
    .${SETTINGS_CLASS}__dialog {
      background: rgb(var(--tds-surface));
      border: 1px solid rgb(var(--tds-border));
      box-shadow: rgb(var(--tds-shadow) / 0.2) 0 0 15px, rgb(var(--tds-shadow) / 0.15) 0 0 3px 1px;
      color: rgb(var(--tds-text));
      font-family: ${TDS_FONT};
    }
  `;
}
