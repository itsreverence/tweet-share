// Small DOM builders for the settings modal, including the channel row.
let settingsModalCleanup = null;
let settingsIdCount = 0;

function createSettingsOption(labelText, detailText, checked) {
  const option = document.createElement("label");
  option.className = `${SETTINGS_CLASS}__option`;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const text = document.createElement("span");
  text.className = `${SETTINGS_CLASS}__option-text`;
  const label = document.createElement("span");
  label.textContent = labelText;
  text.append(label);
  if (detailText) {
    const detail = document.createElement("span");
    detail.className = `${SETTINGS_CLASS}__option-detail`;
    detail.textContent = detailText;
    text.append(detail);
  }

  option.append(input, text);
  return { option, input };
}

function closeSettingsModal() {
  if (settingsModalCleanup) {
    settingsModalCleanup();
    settingsModalCleanup = null;
  }
  document.querySelector(`.${SETTINGS_CLASS}__backdrop`)?.remove();
}

function nextSettingsId() {
  return `${SETTINGS_CLASS}-${++settingsIdCount}`;
}

function createSettingsButton(text, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${SETTINGS_CLASS}__btn${variant ? ` ${SETTINGS_CLASS}__btn--${variant}` : ""}`;
  button.textContent = text;
  return button;
}

function createSettingsField(labelText, control) {
  const fieldEl = document.createElement("div");
  fieldEl.className = `${SETTINGS_CLASS}__field`;
  const input = control.matches("input") ? control : control.querySelector("input");
  input.id ||= nextSettingsId();
  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = input.id;
  fieldEl.append(label, control);
  return fieldEl;
}

function createWebhookUrlField(input) {
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");

  const row = document.createElement("div");
  row.className = `${SETTINGS_CLASS}__secret`;

  const revealBtn = createSettingsButton("Show");
  revealBtn.setAttribute("aria-label", "Show webhook URL");
  revealBtn.setAttribute("aria-pressed", "false");
  revealBtn.addEventListener("click", () => {
    const showing = input.type !== "password";
    input.type = showing ? "password" : "text";
    revealBtn.textContent = showing ? "Show" : "Hide";
    revealBtn.setAttribute("aria-label", showing ? "Show webhook URL" : "Hide webhook URL");
    revealBtn.setAttribute("aria-pressed", String(!showing));
  });

  row.append(input, revealBtn);
  return createSettingsField("Webhook URL", row);
}

function createSettingsEmptyState() {
  const emptyEl = document.createElement("div");
  emptyEl.className = `${SETTINGS_CLASS}__empty`;

  const title = document.createElement("p");
  title.className = `${SETTINGS_CLASS}__empty-title`;
  title.textContent = "No channels yet";

  const steps = document.createElement("ol");
  steps.className = `${SETTINGS_CLASS}__empty-steps`;
  for (const text of [
    "In Discord: Edit Channel → Integrations → Webhooks → New Webhook.",
    "Copy the webhook URL and paste it below with a name you'll recognize.",
    "Test webhook, then Save. Share → Share to Discord on any post."
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    steps.append(item);
  }

  emptyEl.append(title, steps);
  return emptyEl;
}

function createTestWebhookButton(getWebhookUrl) {
  const button = createSettingsButton("Test webhook");
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = "Testing…";
    try {
      await sendWebhookTest(getWebhookUrl());
      showToast("Test message sent. Check that Discord channel.", "success");
    } catch (error) {
      showToast(error.message || "Webhook test failed.", "error");
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  });
  return button;
}

function trapFocus(dialog, event) {
  const focusable = [...dialog.querySelectorAll("button, input, a[href]")].filter((node) => {
    return !node.disabled && !node.closest("[hidden]");
  });
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const outside = !focusable.includes(document.activeElement);
  if (event.shiftKey && (outside || document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (outside || document.activeElement === last)) {
    event.preventDefault();
    first.focus();
  }
}

// A channel's summary row and its inline edit form. Edits write straight to `destination`.
// savedWebhookUrl is the URL storage holds for this channel, if any.
function createChannelRow(destination, { savedWebhookUrl, onToggleEdit, onRemove }) {
  const element = document.createElement("li");
  element.className = `${SETTINGS_CLASS}__row`;

  const main = document.createElement("div");
  main.className = `${SETTINGS_CLASS}__row-main`;
  let avatar = createChannelAvatar(destination);
  const text = document.createElement("div");
  text.className = `${SETTINGS_CLASS}__row-text`;
  const title = document.createElement("div");
  title.className = `${SETTINGS_CLASS}__row-title`;
  title.id = nextSettingsId();
  const status = document.createElement("div");
  status.className = `${SETTINGS_CLASS}__row-status`;
  text.append(title, status);

  function refresh() {
    const label = destination.label.trim();
    const valid = Boolean(sanitizeDestination(destination));
    title.textContent = label || "Untitled channel";
    if (valid) status.textContent = destination.webhookUrl === savedWebhookUrl ? "Webhook saved" : "Not saved yet";
    else status.textContent = label ? "Needs a valid webhook URL" : "Needs a display name";
    status.dataset.invalid = String(!valid);
    const freshAvatar = createChannelAvatar(destination);
    avatar.replaceWith(freshAvatar);
    avatar = freshAvatar;
  }

  const editRegion = document.createElement("div");
  editRegion.className = `${SETTINGS_CLASS}__row-edit`;
  editRegion.id = nextSettingsId();

  const editBtn = createSettingsButton("Edit");
  editBtn.setAttribute("aria-controls", editRegion.id);
  editBtn.setAttribute("aria-describedby", title.id);
  editBtn.addEventListener("click", () => {
    onToggleEdit();
    (editRegion.hidden ? editBtn : labelInput).focus();
  });

  function setEditing(open) {
    editRegion.hidden = !open;
    editBtn.textContent = open ? "Done" : "Edit";
    editBtn.setAttribute("aria-expanded", String(open));
  }

  const removeBtn = createSettingsButton("Remove", "danger");
  removeBtn.setAttribute("aria-describedby", title.id);
  removeBtn.addEventListener("click", onRemove);

  const actions = document.createElement("div");
  actions.className = `${SETTINGS_CLASS}__actions`;
  actions.append(editBtn, removeBtn);
  main.append(avatar, text, actions);

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.value = destination.label;
  labelInput.addEventListener("input", () => {
    destination.label = labelInput.value;
    refresh();
  });

  const urlInput = document.createElement("input");
  urlInput.placeholder = "https://discord.com/api/webhooks/...";
  urlInput.value = destination.webhookUrl;
  urlInput.addEventListener("input", () => {
    destination.webhookUrl = urlInput.value.trim();
    refresh();
  });

  const editActions = document.createElement("div");
  editActions.className = `${SETTINGS_CLASS}__actions`;
  editActions.append(createTestWebhookButton(() => destination.webhookUrl));
  editRegion.append(
    createSettingsField("Display name", labelInput),
    createWebhookUrlField(urlInput),
    editActions
  );

  refresh();
  element.append(main, editRegion);
  return { element, editBtn, labelInput, urlInput, setEditing };
}
