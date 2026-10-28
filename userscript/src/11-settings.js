async function openSettingsModal(returnFocus) {
  closeDestinationMenu();
  if (document.querySelector(`.${SETTINGS_CLASS}__backdrop`)) return;
  injectSettingsStyles();

  let destinations = [...(await loadAllDestinations())];
  const preferences = await loadPreferences();
  // One channel form is open at a time; the Add form is forced open while there are no channels.
  let editingId = null;
  let addForm = "collapsed";
  let rows = new Map();

  const backdrop = document.createElement("div");
  backdrop.className = `${SETTINGS_CLASS}__backdrop`;

  const dialog = document.createElement("div");
  dialog.className = `${SETTINGS_CLASS}__dialog`;
  applyXThemeVars(dialog);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Tweet Discord Share settings");
  dialog.tabIndex = -1;

  const header = document.createElement("div");
  header.className = `${SETTINGS_CLASS}__header`;
  const heading = document.createElement("h2");
  heading.textContent = "Tweet Discord Share settings";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = `${SETTINGS_CLASS}__close`;
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeSettingsModal);
  header.append(heading, closeBtn);

  const body = document.createElement("div");
  body.className = `${SETTINGS_CLASS}__body`;

  const channelsSection = document.createElement("section");
  channelsSection.className = `${SETTINGS_CLASS}__section`;
  const channelsTitle = document.createElement("h3");
  channelsTitle.className = `${SETTINGS_CLASS}__section-title`;
  channelsTitle.id = nextSettingsId();
  channelsTitle.textContent = "Discord channels";
  const channelCount = document.createElement("span");
  channelCount.className = `${SETTINGS_CLASS}__count`;
  channelCount.setAttribute("aria-hidden", "true");
  channelsTitle.append(channelCount);

  const emptyState = createSettingsEmptyState();
  const listEl = document.createElement("ul");
  listEl.className = `${SETTINGS_CLASS}__list`;
  listEl.setAttribute("aria-labelledby", channelsTitle.id);

  const addCard = document.createElement("div");
  addCard.className = `${SETTINGS_CLASS}__card`;
  addCard.id = nextSettingsId();
  addCard.setAttribute("role", "group");
  const addTitleEl = document.createElement("div");
  addTitleEl.className = `${SETTINGS_CLASS}__card-title`;
  addTitleEl.id = nextSettingsId();
  addTitleEl.textContent = "Add channel";
  addCard.setAttribute("aria-labelledby", addTitleEl.id);

  const addToggle = document.createElement("button");
  addToggle.type = "button";
  addToggle.className = `${SETTINGS_CLASS}__add-toggle`;
  addToggle.textContent = "+ Add channel";
  addToggle.setAttribute("aria-controls", addCard.id);
  addToggle.addEventListener("click", () => {
    addForm = "open";
    render();
    newLabelInput.focus();
  });

  const newLabelInput = document.createElement("input");
  newLabelInput.type = "text";
  newLabelInput.placeholder = "Friends server";

  const newUrlInput = document.createElement("input");
  newUrlInput.placeholder = "https://discord.com/api/webhooks/...";

  function readPendingChannel() {
    const label = newLabelInput.value.trim();
    const webhookUrl = newUrlInput.value.trim();
    if (!label) return { error: "Enter a display name.", input: newLabelInput };
    if (!isValidWebhookUrl(webhookUrl)) return { error: "Enter a valid Discord webhook URL.", input: newUrlInput };
    return { channel: { id: createDestinationId(label, new Set(destinations.map((item) => item.id))), label, webhookUrl } };
  }

  function collapseAddForm() {
    newLabelInput.value = "";
    newUrlInput.value = "";
    addForm = "collapsed";
    render();
    addToggle.focus();
  }

  const addBtn = createSettingsButton("Add to list");
  addBtn.addEventListener("click", () => {
    const { error, channel, input } = readPendingChannel();
    if (error) {
      showToast(error, "error");
      input.focus();
      return;
    }
    destinations.push(channel);
    collapseAddForm();
  });
  const discardBtn = createSettingsButton("Discard", "ghost");
  discardBtn.addEventListener("click", collapseAddForm);

  const addActions = document.createElement("div");
  addActions.className = `${SETTINGS_CLASS}__actions`;
  addActions.append(addBtn, createTestWebhookButton(() => newUrlInput.value), discardBtn);
  addCard.append(
    addTitleEl,
    createSettingsField("Display name", newLabelInput),
    createWebhookUrlField(newUrlInput),
    addActions
  );
  channelsSection.append(channelsTitle, emptyState, listEl, addToggle, addCard);

  const sharingSection = document.createElement("section");
  sharingSection.className = `${SETTINGS_CLASS}__section`;
  const sharingTitle = document.createElement("h3");
  sharingTitle.className = `${SETTINGS_CLASS}__section-title`;
  sharingTitle.textContent = "Sharing";
  const previewOption = createSettingsOption(
    "Always show preview before sending",
    "Off: one channel and no quoted post sends right away. The share panel opens with the preview collapsed.",
    preferences.alwaysShowPreview
  );
  previewOption.input.addEventListener("change", () => {
    preferences.alwaysShowPreview = previewOption.input.checked;
  });
  sharingSection.append(sharingTitle, previewOption.option);

  const hint = document.createElement("p");
  hint.className = `${SETTINGS_CLASS}__hint`;
  hint.textContent = "Channels are stored only in Violentmonkey or Tampermonkey and survive script updates. Treat webhook URLs like passwords: anyone with one can post to that channel.";
  body.append(channelsSection, sharingSection, hint);

  function createChannelRow(destination) {
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
      status.textContent = valid ? "Webhook saved" : label ? "Needs a valid webhook URL" : "Needs a display name";
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
      const opening = editingId !== destination.id;
      editingId = opening ? destination.id : null;
      render();
      (opening ? labelInput : editBtn).focus();
    });

    function setEditing(open) {
      editRegion.hidden = !open;
      editBtn.textContent = open ? "Done" : "Edit";
      editBtn.setAttribute("aria-expanded", String(open));
    }

    const removeBtn = createSettingsButton("Remove", "danger");
    removeBtn.setAttribute("aria-describedby", title.id);
    removeBtn.addEventListener("click", () => {
      destinations = destinations.filter((item) => item !== destination);
      if (editingId === destination.id) editingId = null;
      render();
      (listEl.querySelector("button") || newLabelInput).focus();
    });

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
    return { element, labelInput, urlInput, setEditing };
  }

  function render() {
    rows = new Map(destinations.map((destination) => [destination, rows.get(destination) ?? createChannelRow(destination)]));
    listEl.replaceChildren(...[...rows.values()].map((row) => row.element));
    for (const [destination, row] of rows) row.setEditing(destination.id === editingId);
    listEl.hidden = destinations.length === 0;
    emptyState.hidden = destinations.length > 0;
    channelCount.textContent = destinations.length ? String(destinations.length) : "";

    const addOpen = addForm === "open" || destinations.length === 0;
    addCard.hidden = !addOpen;
    addToggle.hidden = addOpen;
    addToggle.setAttribute("aria-expanded", String(addOpen));
    discardBtn.hidden = destinations.length === 0;
  }

  const footer = document.createElement("div");
  footer.className = `${SETTINGS_CLASS}__footer`;

  const cancelBtn = createSettingsButton("Cancel", "ghost");
  cancelBtn.addEventListener("click", closeSettingsModal);

  const saveBtn = createSettingsButton("Save", "primary");
  saveBtn.addEventListener("click", async () => {
    // The Add form only collapses once cleared, so a pending channel is always visible here.
    const pending = newLabelInput.value.trim() || newUrlInput.value.trim() ? readPendingChannel() : {};
    if (pending.error) {
      showToast(`${pending.error} Finish or clear the Add channel form before saving.`, "error");
      pending.input.focus();
      return;
    }
    const invalid = destinations.find((destination) => !sanitizeDestination(destination));
    if (invalid) {
      showToast("Fix invalid channel names or webhook URLs before saving.", "error");
      editingId = invalid.id;
      render();
      const row = rows.get(invalid);
      (invalid.label.trim() ? row.urlInput : row.labelInput).focus();
      return;
    }
    try {
      await Promise.all([
        saveAllDestinations(pending.channel ? [...destinations, pending.channel] : destinations),
        savePreferences(preferences)
      ]);
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

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeSettingsModal();
    } else if (event.key === "Tab") {
      trapFocus(dialog, event);
    }
  };
  settingsModalCleanup = () => {
    document.removeEventListener("keydown", onKeyDown);
    returnFocus();
  };
  document.addEventListener("keydown", onKeyDown);

  document.body.append(backdrop);
  render();
  (destinations.length ? dialog : newLabelInput).focus({ preventScroll: true });
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
  register("Tweet Discord Share settings…", () => {
    const previousFocus = document.activeElement;
    openSettingsModal(() => previousFocus?.focus({ preventScroll: true }));
  });
}

registerSettingsMenuCommand();
