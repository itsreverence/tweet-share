const DIRECT_DESTINATIONS = [
  // Add your Discord webhooks here:
  // { id: "friends", label: "Friends server - tweets", webhookUrl: "https://discord.com/api/webhooks/..." },
  // { id: "personal", label: "Personal server - links", webhookUrl: "https://discord.com/api/webhooks/..." }
];

const MEDIA_LINK_STYLE = "preview"; // "preview" | "masked"
const DEBUG_MEDIA_EXTRACTION = false;
const DEBUG_QUOTE_EXTRACTION = false;
const BUTTON_CLASS = "tds-share-button";
const STATUS_CLASS = "tds-status";
const DESTINATION_KEY = "tds-last-destination";

const DISCORD_LIMITS = { content: 2000 };
const MESSAGE_CHUNK_LIMIT = 1900;
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
