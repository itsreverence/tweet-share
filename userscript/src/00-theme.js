// Colors are RGB tuples ("231 233 234"), the format X publishes on :root (e.g. --color-text).
const TDS_FONT = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const TDS_RGB_PATTERN = /^\d+\s+\d+\s+\d+$/;

// X's colours, moved only as far as needed for 4.5:1 on every background each one meets, hover tints included:
// subtle (muted text), link (blue text), danger and success (red and green text and icons), and accent (filled under white text).
const THEME_PALETTES = {
  light: {
    surface: "255 255 255", raised: "247 249 249", text: "15 20 25", subtle: "83 100 113", border: "207 217 222", shadow: "101 119 134",
    link: "12 113 181", danger: "210 10 23", success: "0 132 88", accent: "13 120 192"
  },
  dim: {
    surface: "21 32 43", raised: "30 39 50", text: "247 249 249", subtle: "139 152 165", border: "56 68 77", shadow: "255 255 255",
    link: "29 155 240", danger: "247 89 99", success: "0 186 124", accent: "13 120 192"
  },
  dark: {
    surface: "0 0 0", raised: "22 24 28", text: "231 233 234", subtle: "125 131 136", border: "47 51 54", shadow: "255 255 255",
    link: "29 155 240", danger: "244 33 46", success: "0 186 124", accent: "13 120 192"
  }
};
// The blue of focus rings and borders, which carry no text.
const THEME_ACCENTS = { blue: "29 155 240" };
// The page background picks the palette. X's variables refine only its text colour and that blue,
// so none of them can pull a colour text is drawn in or on below 4.5:1.
const X_THEME_VARIABLES = {
  text: "--color-text",
  blue: "--color-blue"
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

function relativeLuminance([red, green, blue]) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function hslToRgb(hue, saturation, lightness) {
  const chroma = (saturation / 100) * Math.min(lightness / 100, 1 - lightness / 100);
  const channel = (offset) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness / 100 - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

// Yellows and greens are bright at any given lightness, so each hue darkens only until white initials reach 4.5:1.
function avatarColor(hue) {
  let rgb;
  for (let lightness = 45; lightness > 0; lightness -= 1) {
    rgb = hslToRgb(hue, 60, lightness);
    if (1.05 / (relativeLuminance(rgb) + 0.05) >= 4.5) break;
  }
  return `rgb(${rgb.join(" ")})`;
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
