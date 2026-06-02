const MEDIA_LINK_STYLE = "preview"; // "preview" | "masked"
const DEBUG_MEDIA_EXTRACTION = false;
const DEBUG_QUOTE_EXTRACTION = false;
const SHARE_MENU_ITEM_CLASS = "tds-share-menu-item";
const POPOVER_CLASS = "tds-popover";
const TOAST_HOST_CLASS = "tds-toast-host";
const TOAST_CLASS = "tds-toast";
const SETTINGS_CLASS = "tds-settings";
const PREVIEW_CLASS = "tds-preview";
const DESTINATION_KEY = "tds-last-destination";
const DESTINATIONS_STORAGE_KEY = "tds-destinations";
const WEBHOOK_URL_PATTERN = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/i;
const TOAST_DURATION_MS = 4000;

const DISCORD_LIMITS = { content: 2000 };
const MESSAGE_CHUNK_LIMIT = 1900;
const DISCORD_EMBED_LIMITS = {
  embedsPerMessage: 10,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fieldsPerEmbed: 25,
  authorName: 256,
  title: 256,
  footer: 2048,
  totalEmbedChars: 6000
};
const EMBED_COLOR_MAIN = 0x1da1f2;
const EMBED_COLOR_QUOTE = 0x536471;
const WEBHOOK_SEND_DELAY_MS = 750;
const CACHE_MAX_ENTRIES = 300;

const VIDEO_VARIANT_CACHE = new Map();
const TWEET_CACHE = new Map();
const USER_CACHE = new Map();

function trimCache(cache, maxEntries = CACHE_MAX_ENTRIES) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

// X.com exposes RGB tuples on :root (e.g. --color-text: 231 233 234).
const TDS_FONT = 'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const TDS_RGB_PATTERN = /^\d+\s+\d+\s+\d+$/;

function readXRgb(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return TDS_RGB_PATTERN.test(value) ? value : fallback;
}

function subtleTextRgb(backgroundRgb) {
  const secondary = getComputedStyle(document.documentElement).getPropertyValue("--color-text-secondary").trim();
  if (TDS_RGB_PATTERN.test(secondary)) return secondary;

  const [red, green, blue] = backgroundRgb.split(/\s+/).map(Number);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.55 ? "83 100 113" : "113 118 123";
}

function applyXThemeVars(element) {
  const surface = readXRgb("--color-background", "0 0 0");
  const text = readXRgb("--color-text", "231 233 234");
  const border = readXRgb("--color-border", "47 51 54");
  const blue = readXRgb("--color-blue", "29 155 240");
  const green = readXRgb("--color-green", "0 186 124");
  const red = readXRgb("--color-red", "244 33 46");

  element.style.setProperty("--tds-surface", surface);
  element.style.setProperty("--tds-text", text);
  element.style.setProperty("--tds-subtle", subtleTextRgb(surface));
  element.style.setProperty("--tds-border", border);
  element.style.setProperty("--tds-blue", blue);
  element.style.setProperty("--tds-green", green);
  element.style.setProperty("--tds-red", red);
}

function tdsSharedSurfaceCss() {
  return `
    .${POPOVER_CLASS},
    .${TOAST_CLASS},
    .${SETTINGS_CLASS}__dialog {
      background: rgb(var(--tds-surface, 0 0 0));
      border: 1px solid rgb(var(--tds-border, 47 51 54));
      color: rgb(var(--tds-text, 231 233 234));
      font-family: ${TDS_FONT};
    }
    .${POPOVER_CLASS} {
      border-radius: var(--border-radius-large, 16px);
      box-shadow: var(--box-shadow-elevated, rgb(101 119 134 / 20%) 0 0 15px);
    }
    .${POPOVER_CLASS}__title,
    .${SETTINGS_CLASS}__hint,
    .${SETTINGS_CLASS}__card-id,
    .${SETTINGS_CLASS}__empty,
    .${SETTINGS_CLASS}__field label {
      color: rgb(var(--tds-subtle, 113 118 123));
    }
    .${POPOVER_CLASS}__item:hover,
    .${POPOVER_CLASS}__item:focus-visible,
    .${POPOVER_CLASS}__manage:hover,
    .${POPOVER_CLASS}__manage:focus-visible,
    .${SETTINGS_CLASS}__close:hover,
    .${SETTINGS_CLASS}__btn--ghost:hover {
      background: rgb(var(--tds-blue, 29 155 240) / 0.1);
    }
    .${POPOVER_CLASS}__item[data-last="true"]::after,
    .${POPOVER_CLASS}__manage {
      color: rgb(var(--tds-blue, 29 155 240));
    }
    .${POPOVER_CLASS}__footer,
    .${SETTINGS_CLASS}__header,
    .${SETTINGS_CLASS}__footer,
    .${SETTINGS_CLASS}__card {
      border-color: rgb(var(--tds-border, 47 51 54));
    }
    .${TOAST_CLASS} {
      border-radius: var(--border-radius-large, 16px);
      box-shadow: var(--box-shadow-elevated, rgb(101 119 134 / 20%) 0 0 15px);
    }
    .${TOAST_CLASS}[data-state="success"] {
      border-left: 3px solid rgb(var(--tds-green, 0 186 124));
    }
    .${TOAST_CLASS}[data-state="error"] {
      border-left: 3px solid rgb(var(--tds-red, 244 33 46));
    }
    .${TOAST_CLASS}[data-state="info"] {
      border-left: 3px solid rgb(var(--tds-blue, 29 155 240));
    }
    .${SETTINGS_CLASS}__dialog {
      box-shadow: var(--box-shadow-elevated, rgb(101 119 134 / 20%) 0 0 15px);
    }
    .${SETTINGS_CLASS}__field input {
      background: rgb(var(--tds-surface, 0 0 0));
      border: 1px solid rgb(var(--tds-border, 47 51 54));
      color: rgb(var(--tds-text, 231 233 234));
    }
    .${SETTINGS_CLASS}__field input::placeholder {
      color: rgb(var(--tds-subtle, 113 118 123));
    }
    .${SETTINGS_CLASS}__field input:focus {
      border-color: rgb(var(--tds-blue, 29 155 240));
      outline: none;
    }
    .${SETTINGS_CLASS}__remove {
      color: rgb(var(--tds-red, 244 33 46));
    }
    .${SETTINGS_CLASS}__remove:hover {
      background: rgb(var(--tds-red, 244 33 46) / 0.1);
    }
    .${SETTINGS_CLASS}__btn--primary {
      background: rgb(var(--tds-blue, 29 155 240));
      color: #fff;
    }
    .${SETTINGS_CLASS}__btn--primary:hover {
      background: rgb(var(--tds-blue, 29 155 240) / 0.85);
    }
  `;
}
