function storageGet(key, defaultValue) {
  return new Promise((resolve) => {
    if (typeof GM !== "undefined" && typeof GM.getValue === "function") {
      GM.getValue(key, defaultValue).then(resolve).catch(() => resolve(defaultValue));
      return;
    }
    if (typeof GM_getValue === "function") {
      try {
        const value = GM_getValue(key, defaultValue);
        if (value && typeof value.then === "function") {
          value.then(resolve).catch(() => resolve(defaultValue));
          return;
        }
        resolve(value ?? defaultValue);
      } catch {
        resolve(defaultValue);
      }
      return;
    }
    resolve(defaultValue);
  });
}

function storageSet(key, value) {
  return new Promise((resolve, reject) => {
    if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
      GM.setValue(key, value).then(resolve).catch(reject);
      return;
    }
    if (typeof GM_setValue === "function") {
      try {
        const result = GM_setValue(key, value);
        if (result && typeof result.then === "function") {
          result.then(resolve).catch(reject);
          return;
        }
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }
    reject(new Error("Extension storage is unavailable."));
  });
}

function slugifyId(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `channel-${Date.now().toString(36)}`;
}

function sanitizeDestination(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const label = String(entry.label || "").trim();
  const webhookUrl = String(entry.webhookUrl || "").trim();
  if (!id || !label || !webhookUrl) return null;
  if (!WEBHOOK_URL_PATTERN.test(webhookUrl)) return null;
  return { id, label, webhookUrl };
}

function sanitizeDestinations(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(sanitizeDestination).filter(Boolean);
}

async function readStoredDestinations() {
  const stored = await storageGet(DESTINATIONS_STORAGE_KEY, null);
  return sanitizeDestinations(stored);
}

async function loadAllDestinations() {
  return readStoredDestinations();
}

async function saveAllDestinations(destinations) {
  const sanitized = sanitizeDestinations(destinations);
  await storageSet(DESTINATIONS_STORAGE_KEY, sanitized);
  return sanitized;
}

async function getDestinations() {
  const destinations = await loadAllDestinations();
  return destinations.map(({ id, label }) => ({ id, label }));
}

async function getDestinationById(destinationId) {
  const destinations = await loadAllDestinations();
  return destinations.find((item) => item.id === destinationId) || null;
}

async function destinationLabel(destinationId) {
  const destination = await getDestinationById(destinationId);
  return destination?.label || "Discord";
}

function isValidWebhookUrl(url) {
  return WEBHOOK_URL_PATTERN.test(String(url || "").trim());
}

function createDestinationId(label, existingIds) {
  const base = slugifyId(label);
  if (!existingIds.has(base)) return base;
  let index = 2;
  while (existingIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
