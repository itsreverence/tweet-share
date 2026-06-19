async function openSettingsModal() {
  closeDestinationMenu();
  if (document.querySelector(`.${SETTINGS_CLASS}__backdrop`)) return;
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
    if (sanitized.length !== destinations.length) {
      showToast("Fix invalid channel names or webhook URLs before saving.", "error");
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
    }
  };
  settingsModalCleanup = () => {
    document.removeEventListener("keydown", onEscape);
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
