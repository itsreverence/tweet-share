// Destination popover: share summary, quote toggle, destination selection, preview, and settings handoff.
const GEAR_ICON_PATH = "M10.54 1.75h2.92l1.57 2.36c.11.17.32.25.53.21l2.53-.59 2.17 2.17-.58 2.54c-.05.2.04.41.21.53l2.36 1.57v2.92l-2.36 1.57c-.17.12-.26.33-.21.53l.58 2.54-2.17 2.17-2.53-.59c-.21-.04-.42.04-.53.21l-1.57 2.36h-2.92l-1.58-2.36c-.11-.17-.32-.25-.52-.21l-2.54.59-2.17-2.17.58-2.54c.05-.2-.03-.41-.21-.53l-2.35-1.57v-2.92L4.1 8.97c.18-.12.26-.33.21-.53L3.73 5.9 5.9 3.73l2.54.59c.2.04.41-.04.52-.21l1.58-2.36zm1.07 2l-.98 1.47C10.05 6.08 9 6.5 7.99 6.27l-1.46-.34-.6.6.33 1.46c.24 1.01-.18 2.07-1.05 2.64l-1.46.98v.78l1.46.98c.87.57 1.29 1.63 1.05 2.64l-.33 1.46.6.6 1.46-.34c1.01-.23 2.06.19 2.64 1.05l.98 1.47h.78l.97-1.47c.58-.86 1.63-1.28 2.65-1.05l1.45.34.61-.6-.34-1.46c-.23-1.01.18-2.07 1.05-2.64l1.47-.98v-.78l-1.47-.98c-.87-.57-1.28-1.63-1.05-2.64l.34-1.46-.61-.6-1.45.34c-1.02.23-2.07-.19-2.65-1.05l-.97-1.47h-.78zM12 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5c.82 0 1.5-.67 1.5-1.5s-.68-1.5-1.5-1.5zM8.5 12c0-1.93 1.56-3.5 3.5-3.5 1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5c-1.94 0-3.5-1.57-3.5-3.5z";

function describeShare(tweet, shareOptions, messageCount) {
  const parts = [];
  if (tweet.author?.username) parts.push(`Post by @${tweet.author.username}`);
  const mediaCount = collectMediaAttachmentUrls(tweet, shareOptions).length;
  if (mediaCount) parts.push(mediaFileCount(mediaCount));
  if (shareOptions.includeQuote && hasQuoteTweet(tweet)) {
    parts.push(tweet.quote.author?.username ? `quoting @${tweet.quote.author.username}` : "with quoted post");
  }
  if (messageCount > 1) parts.push(`${messageCount} messages`);
  return parts.join(" · ") || "Ready to send";
}

function createGearButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${POPOVER_CLASS}__icon-btn`;
  button.setAttribute("aria-label", "Settings");
  button.title = "Settings";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", GEAR_ICON_PATH);
  svg.append(path);
  button.append(svg);
  return button;
}

function createDestinationItem(destination, { isDefault, isLastUsed }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `${POPOVER_CLASS}__item`;
  item.disabled = true;
  if (isDefault) item.dataset.default = "true";

  const label = document.createElement("span");
  label.className = `${POPOVER_CLASS}__item-label`;
  label.textContent = destination.label;
  item.append(createChannelAvatar(destination), label);

  if (isLastUsed) {
    // Announced as the button's description, so the name stays the channel's label.
    const badge = document.createElement("span");
    badge.className = `${POPOVER_CLASS}__badge`;
    badge.id = `${POPOVER_CLASS}-last-used`;
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "Last used";
    item.setAttribute("aria-describedby", badge.id);
    item.append(badge);
  }
  return item;
}

function openDestinationMenu(anchor, article, destinations, options = {}) {
  const { showQuoteOption = false, preferences = DEFAULT_PREFERENCES } = options;
  const lastUsedId = localStorage.getItem(DESTINATION_KEY);
  const defaultId = destinations.some((destination) => destination.id === lastUsedId) ? lastUsedId : destinations[0].id;
  // Non-modal on purpose. Tab may leave it, and Escape or a click outside closes it.
  const panel = document.createElement("div");
  panel.className = POPOVER_CLASS;
  applyXThemeVars(panel);
  panel.setAttribute("role", "dialog");
  panel.tabIndex = -1;

  let includeQuote = true;
  let preparedTweet = null;

  function shareOptions() {
    return {
      includeQuote: showQuoteOption ? includeQuote : true,
      preferences
    };
  }

  const findAnchor = trackShareButton(article, anchor);
  const returnFocus = () => returnFocusToPost(findAnchor);

  function closeAndReturnFocus() {
    closeDestinationMenu();
    returnFocus();
  }

  const header = document.createElement("div");
  header.className = `${POPOVER_CLASS}__header`;
  const titleEl = document.createElement("h2");
  titleEl.className = `${POPOVER_CLASS}__title`;
  titleEl.id = `${POPOVER_CLASS}-title`;
  titleEl.textContent = "Share to Discord";
  panel.setAttribute("aria-labelledby", titleEl.id);
  const settingsBtn = createGearButton();
  settingsBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettingsModal(returnFocus);
  });
  header.append(titleEl, settingsBtn);

  const summary = document.createElement("p");
  summary.className = `${POPOVER_CLASS}__summary`;
  summary.setAttribute("aria-live", "polite");
  summary.textContent = "Preparing post…";
  panel.append(header, summary);

  if (showQuoteOption) {
    const quoteOption = document.createElement("label");
    quoteOption.className = `${POPOVER_CLASS}__quote-option`;
    const quoteCheckbox = document.createElement("input");
    quoteCheckbox.type = "checkbox";
    quoteCheckbox.checked = true;
    quoteCheckbox.addEventListener("change", () => {
      includeQuote = quoteCheckbox.checked;
      if (preparedTweet) renderPrepared();
    });
    const quoteLabel = document.createElement("span");
    quoteLabel.textContent = "Include quoted post";
    quoteOption.append(quoteCheckbox, quoteLabel);
    panel.append(quoteOption);
  }

  const sendLabel = document.createElement("p");
  sendLabel.className = `${POPOVER_CLASS}__section-label`;
  sendLabel.id = `${POPOVER_CLASS}-send-label`;
  sendLabel.textContent = "Send to";
  const destinationsHost = document.createElement("div");
  destinationsHost.className = `${POPOVER_CLASS}__destinations`;
  destinationsHost.setAttribute("role", "group");
  destinationsHost.setAttribute("aria-labelledby", sendLabel.id);
  const destinationItems = destinations.map((destination) => {
    const item = createDestinationItem(destination, {
      isDefault: destination.id === defaultId,
      isLastUsed: destination.id === lastUsedId
    });
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!preparedTweet) return;
      closeAndReturnFocus();
      localStorage.setItem(DESTINATION_KEY, destination.id);
      runShare(article, destination.id, shareOptions(), preparedTweet);
    });
    return item;
  });
  destinationsHost.append(...destinationItems);
  destinationsHost.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    const index = destinationItems.indexOf(event.target);
    if (!step || index === -1) return;
    event.preventDefault();
    destinationItems[(index + step + destinationItems.length) % destinationItems.length].focus();
  });
  panel.append(sendLabel, destinationsHost);

  const previewToggle = document.createElement("button");
  previewToggle.type = "button";
  previewToggle.className = `${POPOVER_CLASS}__disclosure`;
  previewToggle.textContent = "Preview message";
  const previewWrap = document.createElement("div");
  previewWrap.className = `${POPOVER_CLASS}__preview-wrap`;
  previewWrap.id = `${POPOVER_CLASS}-preview`;
  previewWrap.tabIndex = 0;
  previewWrap.setAttribute("role", "region");
  previewWrap.setAttribute("aria-label", "Message preview");
  previewToggle.setAttribute("aria-controls", previewWrap.id);
  const previewStatus = document.createElement("p");
  previewStatus.className = `${POPOVER_CLASS}__preview-status`;
  previewStatus.textContent = "Loading preview…";
  previewWrap.append(previewStatus);

  function setPreviewExpanded(expanded) {
    previewToggle.setAttribute("aria-expanded", String(expanded));
    previewWrap.hidden = !expanded;
  }
  setPreviewExpanded(preferences.alwaysShowPreview);
  previewToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setPreviewExpanded(previewWrap.hidden);
    lifecycle.place();
  });
  panel.append(previewToggle, previewWrap);

  function renderPrepared() {
    const options = shareOptions();
    const attachmentUrls = collectMediaAttachmentUrls(preparedTweet, options);
    const payloads = buildDiscordPayloads(preparedTweet, { ...options, fallbackVideoUrls: [] });
    previewWrap.replaceChildren(renderDiscordPreview(payloads, { attachmentUrls }));
    summary.textContent = describeShare(preparedTweet, options, payloads.length);
    lifecycle.place();
  }

  async function loadPreview() {
    try {
      preparedTweet = await prepareShareTweet(article);
      if (!panel.isConnected) return;
      renderPrepared();
      for (const item of destinationItems) item.disabled = false;
      if (document.activeElement === panel) {
        destinationItems.find((item) => item.dataset.default === "true").focus();
      }
    } catch (error) {
      if (!panel.isConnected) return;
      console.error(error);
      const message = error.message || "Could not build a preview for this post.";
      summary.textContent = message;
      previewStatus.textContent = message;
    }
  }

  const lifecycle = showPanel(panel, { findAnchor, returnFocus });
  loadPreview();
}

function popoverStylesCss() {
  return `
    .${POPOVER_CLASS} {
      border-radius: 16px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      font-size: 15px;
      overflow-y: auto;
      position: fixed;
      width: min(360px, calc(100vw - ${PANEL_MARGIN * 2}px));
      z-index: 10000;
    }
    .${POPOVER_CLASS}--sheet {
      border-bottom-width: 0;
      border-radius: 16px 16px 0 0;
      transform: translateY(-100%);
    }
    .${POPOVER_CLASS}:focus {
      outline: none;
    }
    .${POPOVER_CLASS} > :not(.${POPOVER_CLASS}__preview-wrap) {
      flex-shrink: 0;
    }
    .${POPOVER_CLASS} [hidden] {
      display: none;
    }
    .${POPOVER_CLASS}__header {
      align-items: center;
      display: flex;
      gap: 8px;
      padding-block: 10px 0;
      padding-inline: 16px 8px;
    }
    .${POPOVER_CLASS}__title {
      flex: 1;
      font-size: 17px;
      font-weight: 800;
      margin: 0;
    }
    .${POPOVER_CLASS}__icon-btn {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: rgb(var(--tds-subtle));
      cursor: pointer;
      display: inline-flex;
      height: 34px;
      justify-content: center;
      padding: 0;
      width: 34px;
    }
    .${POPOVER_CLASS}__icon-btn svg {
      fill: currentColor;
      height: 18px;
      width: 18px;
    }
    .${POPOVER_CLASS}__summary {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
      line-height: 1.4;
      margin: 0;
      overflow: hidden;
      padding: 0 16px 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${POPOVER_CLASS}__quote-option {
      align-items: center;
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      font-size: 14px;
      gap: 10px;
      margin: 0 8px 4px;
      padding: 8px;
      user-select: none;
    }
    .${POPOVER_CLASS}__quote-option input {
      accent-color: rgb(var(--tds-blue));
      cursor: pointer;
      flex-shrink: 0;
      height: 18px;
      margin: 0;
      width: 18px;
    }
    .${POPOVER_CLASS}__section-label {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
      font-weight: 700;
      margin: 0;
      padding: 6px 16px;
    }
    .${POPOVER_CLASS}__destinations {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 12px 12px;
    }
    .${POPOVER_CLASS}__item {
      align-items: center;
      background: transparent;
      border: 1px solid rgb(var(--tds-border));
      border-radius: 12px;
      box-sizing: border-box;
      color: inherit;
      cursor: pointer;
      display: flex;
      font: inherit;
      font-weight: 700;
      gap: 12px;
      min-height: 52px;
      padding: 8px 12px;
      text-align: start;
      transition: background 0.12s ease, border-color 0.12s ease;
      width: 100%;
    }
    .${POPOVER_CLASS}__item-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${POPOVER_CLASS}__item:hover:not(:disabled) {
      background: rgb(var(--tds-blue) / 0.1);
      border-color: rgb(var(--tds-blue));
    }
    .${POPOVER_CLASS}__item[data-default="true"] {
      background: rgb(var(--tds-accent));
      border-color: rgb(var(--tds-accent));
      color: #fff;
    }
    .${POPOVER_CLASS}__item[data-default="true"]:hover:not(:disabled) {
      background: linear-gradient(rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.1)) rgb(var(--tds-accent));
      border-color: rgb(var(--tds-accent));
    }
    .${POPOVER_CLASS}__item:disabled {
      cursor: progress;
      opacity: 0.5;
    }
    /* The last-used channel is always the default, so the badge only ever sits on the accent fill. */
    .${POPOVER_CLASS}__badge {
      background: rgb(0 0 0 / 0.2);
      border-radius: 999px;
      color: #fff;
      flex-shrink: 0;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
    }
    .${POPOVER_CLASS}__item:focus-visible,
    .${POPOVER_CLASS}__icon-btn:focus-visible,
    .${POPOVER_CLASS}__disclosure:focus-visible,
    .${POPOVER_CLASS}__quote-option:focus-within {
      outline: 2px solid rgb(var(--tds-blue));
      outline-offset: 2px;
    }
    .${POPOVER_CLASS}__icon-btn:hover,
    .${POPOVER_CLASS}__quote-option:hover,
    .${POPOVER_CLASS}__disclosure:hover {
      background: rgb(var(--tds-text) / 0.07);
    }
    .${POPOVER_CLASS}__disclosure {
      align-items: center;
      background: transparent;
      border: 0;
      border-top: 1px solid rgb(var(--tds-border));
      color: rgb(var(--tds-subtle));
      cursor: pointer;
      display: flex;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      gap: 10px;
      padding: 10px 16px;
      text-align: start;
      width: 100%;
    }
    .${POPOVER_CLASS}__disclosure::before {
      border-block: 4px solid transparent;
      border-inline-start: 5px solid currentColor;
      content: "";
      transition: transform 0.12s ease;
    }
    .${POPOVER_CLASS}__disclosure[aria-expanded="true"]::before {
      transform: rotate(90deg);
    }
    .${POPOVER_CLASS}__disclosure[aria-expanded="true"]:dir(rtl)::before {
      transform: rotate(-90deg);
    }
  `;
}
