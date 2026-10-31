const MEDIA_LINK_STYLE = "preview"; // "preview" | "masked"
const DEBUG_MEDIA_EXTRACTION = false;
const DEBUG_QUOTE_EXTRACTION = false;
const SHARE_MENU_ITEM_CLASS = "tds-share-menu-item";
const POPOVER_CLASS = "tds-popover";
const AVATAR_CLASS = "tds-avatar";
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
// Discord rejects webhook usernames containing "discord" (case-insensitive).
const WEBHOOK_SENDER_NAME = "Tweet Share";
// Self-hosted in repo so Discord's servers can fetch it reliably (Wikimedia often fails).
const WEBHOOK_SENDER_AVATAR_URL =
  "https://raw.githubusercontent.com/itsreverence/tweet-share/master/assets/webhook-avatar-v2.png";
const WEBHOOK_SEND_DELAY_MS = 750;
const CACHE_MAX_ENTRIES = 300;

const VIDEO_VARIANT_CACHE = new Map();
const TEXT_CUT_OFF_NOTE = "[Post cut off. Open on X for the rest.]";
const TWEET_CACHE = new Map();
const USER_CACHE = new Map();
const captureStatus = { state: "not started", responsesRead: 0 };

function trimCache(cache, maxEntries = CACHE_MAX_ENTRIES) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}
