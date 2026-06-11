const PREFERENCES_STORAGE_KEY = "tds-preferences";

const DEFAULT_PREFERENCES = {
  alwaysShowPreview: true,
  attachMedia: true
};

function sanitizePreferences(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    alwaysShowPreview: input.alwaysShowPreview !== false,
    attachMedia: input.attachMedia !== false
  };
}

async function loadPreferences() {
  const stored = await storageGet(PREFERENCES_STORAGE_KEY, null);
  return sanitizePreferences(stored);
}

async function savePreferences(preferences) {
  const sanitized = sanitizePreferences(preferences);
  await storageSet(PREFERENCES_STORAGE_KEY, sanitized);
  return sanitized;
}
