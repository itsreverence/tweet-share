function injectSettingsStyles() {
  if (document.getElementById("tds-settings-style")) return;

  const style = document.createElement("style");
  style.id = "tds-settings-style";
  style.textContent = `
    ${tdsSharedSurfaceCss()}

    .${SETTINGS_CLASS}__backdrop {
      position: fixed;
      inset: 0;
      z-index: 10002;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      /* Do not use X gray-* tokens for overlay — e.g. --color-gray-1100 is pink on X */
      background-color: rgba(0, 0, 0, 0.65);
    }
    .${SETTINGS_CLASS}__dialog {
      border-radius: var(--border-radius-x-large, 20px);
      max-height: min(90vh, 720px);
      max-width: 520px;
      overflow: hidden;
      width: 100%;
      display: flex;
      flex-direction: column;
    }
    .${SETTINGS_CLASS}__header {
      align-items: center;
      border-bottom-width: 1px;
      border-bottom-style: solid;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 16px 18px;
    }
    .${SETTINGS_CLASS}__header h2 {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
    }
    .${SETTINGS_CLASS}__close {
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: inherit;
      cursor: pointer;
      font-size: 22px;
      height: 36px;
      line-height: 1;
      width: 36px;
    }
    .${SETTINGS_CLASS}__body {
      overflow: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .${SETTINGS_CLASS}__hint {
      font-size: 15px;
      line-height: 1.45;
      margin: 0;
    }
    .${SETTINGS_CLASS}__list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .${SETTINGS_CLASS}__card {
      border-width: 1px;
      border-style: solid;
      border-radius: var(--border-radius-large, 16px);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .${SETTINGS_CLASS}__card-head {
      align-items: flex-start;
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }
    .${SETTINGS_CLASS}__card-title {
      font-size: 15px;
      font-weight: 700;
    }
    .${SETTINGS_CLASS}__card-id {
      font-size: 13px;
    }
    .${SETTINGS_CLASS}__field input {
      border-radius: var(--border-radius-medium, 8px);
      box-sizing: border-box;
      font: inherit;
      font-size: 15px;
      padding: 12px;
      width: 100%;
    }
    .${SETTINGS_CLASS}__remove {
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      flex-shrink: 0;
      font: inherit;
      font-size: 15px;
      padding: 8px 12px;
    }
    .${SETTINGS_CLASS}__footer {
      border-top-width: 1px;
      border-top-style: solid;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 14px 18px;
    }
    .${SETTINGS_CLASS}__btn {
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      min-height: 36px;
      padding: 0 16px;
    }
    .${SETTINGS_CLASS}__btn--ghost {
      background: transparent;
      color: inherit;
    }
    .${SETTINGS_CLASS}__empty {
      font-size: 15px;
      padding: 8px 0;
    }
    .${SETTINGS_CLASS}__section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 0;
    }
    .${SETTINGS_CLASS}__option {
      align-items: flex-start;
      cursor: pointer;
      display: flex;
      font-size: 15px;
      gap: 10px;
      line-height: 1.45;
      user-select: none;
    }
    .${SETTINGS_CLASS}__option input {
      accent-color: rgb(var(--tds-blue, 29 155 240));
      cursor: pointer;
      flex-shrink: 0;
      height: 16px;
      margin-top: 3px;
      width: 16px;
    }
    .${SETTINGS_CLASS}__option-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .${SETTINGS_CLASS}__option-detail {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 14px;
    }
  `;
  appendWhenReady(style);
}

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
  document.querySelector(`.${SETTINGS_CLASS}__backdrop`)?.remove();
}

function createSettingsField(labelText, input) {
  const fieldEl = document.createElement("div");
  fieldEl.className = `${SETTINGS_CLASS}__field`;
  const label = document.createElement("label");
  label.textContent = labelText;
  fieldEl.append(label, input);
  return fieldEl;
}

async function openSettingsModal() {
  closeDestinationMenu();
  injectSettingsStyles();

  let destinations = [...(await loadAllDestinations())];
  let preferences = await loadPreferences();
  const backdrop = document.createElement("div");
  backdrop.className = `${SETTINGS_CLASS}__backdrop`;

  const dialog = document.createElement("div");
  dialog.className = `${SETTINGS_CLASS}__dialog`;
  applyXThemeVars(dialog);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Tweet Share settings");

  const header = document.createElement("div");
  header.className = `${SETTINGS_CLASS}__header`;
  const heading = document.createElement("h2");
  heading.textContent = "Tweet Share settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = `${SETTINGS_CLASS}__close`;
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeSettingsModal);
  header.append(heading, closeBtn);

  const body = document.createElement("div");
  body.className = `${SETTINGS_CLASS}__body`;

  const sharingTitle = document.createElement("h3");
  sharingTitle.className = `${SETTINGS_CLASS}__section-title`;
  sharingTitle.textContent = "Sharing";

  const attachMediaOption = createSettingsOption(
    "Upload media to Discord",
    "Best playback. Files over 8 MB are sent as links instead.",
    preferences.attachMedia
  );
  attachMediaOption.input.addEventListener("change", () => {
    preferences.attachMedia = attachMediaOption.input.checked;
  });

  const previewOption = createSettingsOption(
    "Always show preview before sending",
    "Turn off to send instantly when you have one channel and the post has no quote.",
    preferences.alwaysShowPreview
  );
  previewOption.input.addEventListener("change", () => {
    preferences.alwaysShowPreview = previewOption.input.checked;
  });

  const sharingCard = document.createElement("div");
  sharingCard.className = `${SETTINGS_CLASS}__card`;
  sharingCard.append(
    sharingTitle,
    attachMediaOption.option,
    previewOption.option
  );
  body.append(sharingCard);

  const channelsTitle = document.createElement("h3");
  channelsTitle.className = `${SETTINGS_CLASS}__section-title`;
  channelsTitle.textContent = "Discord channels";

  const hint = document.createElement("p");
  hint.className = `${SETTINGS_CLASS}__hint`;
  hint.textContent = "Create webhooks in Discord: Channel settings → Integrations → Webhooks. Channels and preferences are saved in Violentmonkey (or Tampermonkey) and persist across script updates — do not put webhook URLs in the script source.";
  body.append(channelsTitle, hint);

  const listEl = document.createElement("div");
  listEl.className = `${SETTINGS_CLASS}__list`;
  body.append(listEl);

  function renderList() {
    listEl.replaceChildren();
    if (destinations.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = `${SETTINGS_CLASS}__empty`;
      emptyEl.textContent = "No channels yet. Add one below.";
      listEl.append(emptyEl);
      return;
    }

    destinations.forEach((destination, index) => {
      const card = document.createElement("div");
      card.className = `${SETTINGS_CLASS}__card`;

      const head = document.createElement("div");
      head.className = `${SETTINGS_CLASS}__card-head`;

      const meta = document.createElement("div");
      const titleEl = document.createElement("div");
      titleEl.className = `${SETTINGS_CLASS}__card-title`;
      titleEl.textContent = destination.label;
      const idEl = document.createElement("div");
      idEl.className = `${SETTINGS_CLASS}__card-id`;
      idEl.textContent = destination.id;
      meta.append(titleEl, idEl);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = `${SETTINGS_CLASS}__remove`;
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        destinations = destinations.filter((_, itemIndex) => itemIndex !== index);
        renderList();
      });
      head.append(meta, removeBtn);

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = destination.label;
      labelInput.addEventListener("input", () => {
        destinations[index].label = labelInput.value;
      });

      const urlInput = document.createElement("input");
      urlInput.type = "url";
      urlInput.placeholder = "https://discord.com/api/webhooks/...";
      urlInput.value = destination.webhookUrl;
      urlInput.addEventListener("input", () => {
        destinations[index].webhookUrl = urlInput.value.trim();
      });

      card.append(head, createSettingsField("Display name", labelInput), createSettingsField("Webhook URL", urlInput));
      listEl.append(card);
    });
  }

  const addSection = document.createElement("div");
  addSection.className = `${SETTINGS_CLASS}__card`;
  const addTitleEl = document.createElement("div");
  addTitleEl.className = `${SETTINGS_CLASS}__card-title`;
  addTitleEl.textContent = "Add channel";

  const newLabelInput = document.createElement("input");
  newLabelInput.type = "text";
  newLabelInput.placeholder = "Friends server";

  const newUrlInput = document.createElement("input");
  newUrlInput.type = "url";
  newUrlInput.placeholder = "https://discord.com/api/webhooks/...";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = `${SETTINGS_CLASS}__btn ${SETTINGS_CLASS}__btn--ghost`;
  addBtn.textContent = "Add to list";
  addBtn.addEventListener("click", () => {
    const label = newLabelInput.value.trim();
    const webhookUrl = newUrlInput.value.trim();
    if (!label) {
      showToast("Enter a display name.", "error");
      return;
    }
    if (!isValidWebhookUrl(webhookUrl)) {
      showToast("Enter a valid Discord webhook URL.", "error");
      return;
    }
    const existingIds = new Set(destinations.map((item) => item.id));
    destinations.push({
      id: createDestinationId(label, existingIds),
      label,
      webhookUrl
    });
    newLabelInput.value = "";
    newUrlInput.value = "";
    renderList();
  });

  addSection.append(
    addTitleEl,
    createSettingsField("Display name", newLabelInput),
    createSettingsField("Webhook URL", newUrlInput),
    addBtn
  );
  body.append(addSection);

  const footer = document.createElement("div");
  footer.className = `${SETTINGS_CLASS}__footer`;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = `${SETTINGS_CLASS}__btn ${SETTINGS_CLASS}__btn--ghost`;
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closeSettingsModal);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = `${SETTINGS_CLASS}__btn ${SETTINGS_CLASS}__btn--primary`;
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    const sanitized = sanitizeDestinations(destinations);
    if (sanitized.length === 0 && destinations.length > 0) {
      showToast("Fix invalid names or webhook URLs before saving.", "error");
      return;
    }
    try {
      await Promise.all([saveAllDestinations(sanitized), savePreferences(preferences)]);
      showToast("Settings saved.", "success");
      closeSettingsModal();
      refreshShareButtons();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  footer.append(cancelBtn, saveBtn);
  dialog.append(header, body, footer);
  backdrop.append(dialog);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeSettingsModal();
  });

  const onEscape = (event) => {
    if (event.key === "Escape") {
      closeSettingsModal();
      document.removeEventListener("keydown", onEscape);
    }
  };
  document.addEventListener("keydown", onEscape);

  document.body.append(backdrop);
  renderList();
  newLabelInput.focus();
}

function refreshShareButtons() {
  removeLegacyDiscordButtons();
}

function registerSettingsMenuCommand() {
  const register = typeof GM !== "undefined" && typeof GM.registerMenuCommand === "function"
    ? GM.registerMenuCommand.bind(GM)
    : typeof GM_registerMenuCommand === "function"
      ? GM_registerMenuCommand
      : null;

  if (!register) return;
  register("Tweet Share settings…", () => openSettingsModal());
}

registerSettingsMenuCommand();
