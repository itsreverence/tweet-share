// Simple person outline (head + shoulders), readable at menu size.
const PERSON_ICON_PATHS = [
  "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
  "M12 11a4 4 0 0 1 0-8 4 4 0 0 1 0 8z",
];

let pendingShareArticle = null;
function articleHasQuotableTweet(article) {
  try {
    return hasQuoteTweet(extractTweet(article));
  } catch {
    return false;
  }
}

async function prepareShareTweet(article) {
  const tweet = await enrichTweetMedia(extractTweet(article));
  if (DEBUG_MEDIA_EXTRACTION) {
    console.group("Tweet Discord Share media debug");
    console.log(tweet);
    console.log("Detected direct video URLs", directVideoUrlsFromDocument());
    console.log("Cached video variants", Object.fromEntries(VIDEO_VARIANT_CACHE));
    console.groupEnd();
  }
  return tweet;
}

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
      preferences,
      attachMedia: preferences.attachMedia !== false
    };
  }

  function refreshPreview() {
    if (!preparedTweet) return;
    const options = shareOptions();
    previewBody.replaceChildren(renderDiscordPreview(buildDiscordPayloads(preparedTweet, options), {
      attachmentCount: options.attachMedia
        ? Math.min(collectMediaAttachmentUrls(preparedTweet, options).length, ATTACHMENT_MAX_COUNT)
        : 0
    }));
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
      const options = shareOptions();
      previewBody.replaceChildren(renderDiscordPreview(buildDiscordPayloads(preparedTweet, options), {
        attachmentCount: options.attachMedia
          ? Math.min(collectMediaAttachmentUrls(preparedTweet, options).length, ATTACHMENT_MAX_COUNT)
          : 0
      }));
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

async function runShare(article, destinationId, options = {}, preparedTweet = null) {
  showToast(preparedTweet ? "Sending…" : "Preparing…", "info");

  try {
    const tweet = preparedTweet ?? await prepareShareTweet(article);
    await shareToDestination(destinationId, tweet, options);
    showToast(`Sent to ${await destinationLabel(destinationId)}`, "success");
  } catch (error) {
    console.error(error);
    showToast(error.message, "error");
  }
}

async function startDiscordShare(article, anchor) {
  const [destinations, preferences] = await Promise.all([getDestinations(), loadPreferences()]);
  if (destinations.length === 0) {
    closeXOverlay();
    openSettingsModal();
    return;
  }

  const showQuoteOption = articleHasQuotableTweet(article);
  if (destinations.length === 1 && !showQuoteOption && !preferences.alwaysShowPreview) {
    closeXOverlay();
    await runShare(article, destinations[0].id, {
      includeQuote: true,
      preferences,
      attachMedia: preferences.attachMedia !== false
    }, null);
    return;
  }

  closeXOverlay();
  window.setTimeout(
    () => openDestinationMenu(anchor, article, destinations, { showQuoteOption, preferences }),
    50
  );
}

function findShareButton(root) {
  return root.querySelector('[data-testid="share"]')
    || [...root.querySelectorAll("button")].find((button) => /share/i.test(button.getAttribute("aria-label") || ""));
}

function captureShareArticle(event) {
  const shareButton = event.target.closest('[data-testid="share"], button[aria-label*="Share" i]');
  if (!shareButton) return;
  pendingShareArticle = shareButton.closest("article");
}

function isXShareMenu(node) {
  if (!node || node.getAttribute("role") !== "menu") return false;
  const text = [...node.querySelectorAll('[role="menuitem"]')]
    .map((item) => item.textContent || "")
    .join(" ")
    .toLowerCase();
  return text.includes("copy link")
    || text.includes("share post")
    || text.includes("embed post")
    || text.includes("send via");
}

function getMenuItemLabelSpans(menuItem) {
  return [...menuItem.querySelectorAll("span")].filter((node) => {
    return !node.closest("svg") && node.textContent.trim().length > 0;
  });
}

function findMenuItemLabelElement(item, referenceItem) {
  const itemSpans = getMenuItemLabelSpans(item);
  if (!referenceItem) {
    return itemSpans.find((node) => node.children.length === 0) || itemSpans[0] || null;
  }

  const refSpans = getMenuItemLabelSpans(referenceItem);
  const refLabel = refSpans.find((node) => node.children.length === 0) || refSpans[refSpans.length - 1];
  if (!refLabel) {
    return itemSpans[0] || null;
  }

  const refIndex = refSpans.indexOf(refLabel);
  if (refIndex >= 0 && itemSpans[refIndex]) {
    return itemSpans[refIndex];
  }

  return itemSpans.find((node) => node.children.length === 0) || itemSpans[0] || null;
}

function applyPersonIconToSvg(svg, referenceSvg) {
  const refPath = referenceSvg?.querySelector("path");
  if (!svg) return false;

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.replaceChildren();

  for (const d of PERSON_ICON_PATHS) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    if (refPath) {
      for (const attr of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]) {
        const val = refPath.getAttribute(attr);
        if (val != null) path.setAttribute(attr, val);
      }
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    svg.append(path);
  }

  if (referenceSvg) {
    for (const attr of ["fill", "stroke", "stroke-width"]) {
      const val = referenceSvg.getAttribute(attr);
      if (val != null) svg.setAttribute(attr, val);
    }
  }

  return true;
}

function replaceMenuItemIcon(item, referenceItem) {
  return applyPersonIconToSvg(item.querySelector("svg"), referenceItem?.querySelector("svg"));
}

function replaceMenuItemText(item, text, referenceItem) {
  const label = findMenuItemLabelElement(item, referenceItem);
  if (label) {
    label.textContent = text;
    return true;
  }

  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.trim().length > 1 && !node.parentElement?.closest("svg")) {
      node.textContent = text;
      return true;
    }
  }

  return false;
}

function findShareMenuTemplate(menu) {
  const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((item) => {
    return !item.classList.contains(SHARE_MENU_ITEM_CLASS);
  });

  return items.find((item) => /share post/i.test(item.textContent || ""))
    || items.find((item) => /copy link/i.test(item.textContent || ""))
    || items[0]
    || null;
}

function wireDiscordMenuItem(item) {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const article = pendingShareArticle;
    if (!article) {
      showToast("Could not find the post. Try opening Share again.", "error");
      return;
    }
    startDiscordShare(article, item);
  });

  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      item.click();
    }
  });
}

function createDiscordMenuItem(template) {
  const item = template ? template.cloneNode(true) : document.createElement("div");
  item.setAttribute("role", "menuitem");
  item.tabIndex = 0;
  item.classList.add(SHARE_MENU_ITEM_CLASS);

  replaceMenuItemText(item, "Share to Discord", template);
  replaceMenuItemIcon(item, template);

  wireDiscordMenuItem(item);
  return item;
}

function injectDiscordShareMenuItem(menu) {
  if (menu.querySelector(`.${SHARE_MENU_ITEM_CLASS}`)) return;

  const template = findShareMenuTemplate(menu);
  const item = createDiscordMenuItem(template);
  const firstItem = menu.querySelector(`[role="menuitem"]:not(.${SHARE_MENU_ITEM_CLASS})`);

  if (firstItem?.parentElement) {
    firstItem.parentElement.insertBefore(item, firstItem);
    return;
  }

  menu.append(item);
}

function scanShareMenus() {
  document.querySelectorAll('[role="menu"]').forEach((menu) => {
    if (isXShareMenu(menu)) {
      injectDiscordShareMenuItem(menu);
    }
  });
}

function removeLegacyDiscordButtons() {
  document.querySelectorAll(".tds-action-slot, .tds-share-button").forEach((node) => node.remove());
}

function installShareMenuIntegration() {
  document.addEventListener("click", captureShareArticle, true);

  const observer = new MutationObserver(() => scanShareMenus());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanShareMenus();
}

function startUi() {
  injectStyles();
  installNetworkCapture();
  removeLegacyDiscordButtons();
  installShareMenuIntegration();
}

startUi();
