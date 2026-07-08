// Destination popover: preview, quote toggle, destination selection, and settings handoff.
function setDestinationItemsDisabled(items, disabled) {
  for (const item of items) {
    item.disabled = disabled;
    item.setAttribute("aria-disabled", disabled ? "true" : "false");
    if (disabled) {
      item.style.opacity = "0.55";
      item.style.pointerEvents = "none";
    } else {
      item.style.opacity = "";
      item.style.pointerEvents = "";
    }
  }
}

function openDestinationMenu(anchor, article, destinations, options = {}) {
  const { showQuoteOption = false, preferences = DEFAULT_PREFERENCES } = options;
  closeDestinationMenu();

  const last = localStorage.getItem(DESTINATION_KEY);
  const menu = document.createElement("div");
  menu.className = `${POPOVER_CLASS} ${POPOVER_CLASS}--with-preview`;
  applyXThemeVars(menu);
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Share to Discord");

  const titleEl = document.createElement("div");
  titleEl.className = `${POPOVER_CLASS}__title`;
  titleEl.textContent = "Share to Discord";
  menu.append(titleEl);

  const destinationsHost = document.createElement("div");

  const previewWrap = document.createElement("div");
  previewWrap.className = `${POPOVER_CLASS}__preview-wrap`;
  const previewLabel = document.createElement("p");
  previewLabel.className = `${POPOVER_CLASS}__preview-label`;
  previewLabel.textContent = "Preview";
  const previewBody = document.createElement("div");
  const previewStatus = document.createElement("p");
  previewStatus.className = `${POPOVER_CLASS}__preview-status`;
  previewStatus.textContent = "Loading preview…";
  previewBody.append(previewStatus);
  previewWrap.append(previewLabel, previewBody);

  let includeQuote = true;
  let preparedTweet = null;
  let loadGeneration = 0;
  const destinationItems = [];

  function shareOptions() {
    return {
      includeQuote: showQuoteOption ? includeQuote : true,
      preferences
    };
  }

  function refreshPreview() {
    if (!preparedTweet) return;
    previewBody.replaceChildren(renderDiscordPreview(buildDiscordPayloads(preparedTweet, shareOptions())));
    positionPopover(menu, anchor);
  }

  async function loadPreview() {
    const generation = ++loadGeneration;
    setDestinationItemsDisabled(destinationItems, true);
    previewBody.replaceChildren();
    previewStatus.textContent = "Loading preview…";
    previewBody.append(previewStatus);

    try {
      preparedTweet = await prepareShareTweet(article);
      if (generation !== loadGeneration) return;
      previewBody.replaceChildren(renderDiscordPreview(buildDiscordPayloads(preparedTweet, shareOptions())));
      setDestinationItemsDisabled(destinationItems, false);
      positionPopover(menu, anchor);
    } catch (error) {
      if (generation !== loadGeneration) return;
      console.error(error);
      previewStatus.textContent = error.message || "Could not build a preview for this post.";
      previewBody.replaceChildren(previewStatus);
      setDestinationItemsDisabled(destinationItems, true);
    }
  }

  if (showQuoteOption) {
    const quoteOption = document.createElement("label");
    quoteOption.className = `${POPOVER_CLASS}__quote-option`;

    const quoteCheckbox = document.createElement("input");
    quoteCheckbox.type = "checkbox";
    quoteCheckbox.checked = true;
    quoteCheckbox.addEventListener("change", () => {
      includeQuote = quoteCheckbox.checked;
      refreshPreview();
    });

    const quoteLabel = document.createElement("span");
    quoteLabel.textContent = "Include quoted tweet";

    quoteOption.append(quoteCheckbox, quoteLabel);
    menu.append(quoteOption);
  }

  menu.append(previewWrap, destinationsHost);

  destinations.forEach((destination) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `${POPOVER_CLASS}__item`;
    item.setAttribute("role", "menuitem");
    item.textContent = destination.label;
    item.disabled = true;
    item.setAttribute("aria-disabled", "true");
    item.style.opacity = "0.55";
    item.style.pointerEvents = "none";
    if (destination.id === last) {
      item.dataset.last = "true";
    }
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!preparedTweet) return;
      closeDestinationMenu();
      localStorage.setItem(DESTINATION_KEY, destination.id);
      runShare(article, destination.id, shareOptions(), preparedTweet);
    });
    destinationsHost.append(item);
    destinationItems.push(item);
  });

  const footer = document.createElement("div");
  footer.className = `${POPOVER_CLASS}__footer`;
  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = `${POPOVER_CLASS}__manage`;
  manageBtn.textContent = "Settings…";
  manageBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeDestinationMenu();
    openSettingsModal();
  });
  footer.append(manageBtn);
  menu.append(footer);

  positionPopover(menu, anchor);
  activePopover = menu;
  loadPreview();

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeDestinationMenu();
    }
  };

  const onPointerDown = (event) => {
    if (!menu.contains(event.target) && event.target !== anchor && !anchor.contains?.(event.target)) {
      closeDestinationMenu();
    }
  };

  window.setTimeout(() => {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
  }, 0);

  activePopoverCleanup = () => {
    loadGeneration += 1;
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}
