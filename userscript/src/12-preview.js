function embedColorCss(color) {
  if (typeof color !== "number") return "#5865f2";
  return `#${(color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

function appendLinkText(container, value) {
  const text = String(value || "").trim();
  if (!text) return;

  const masked = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i.exec(text);
  if (masked) {
    const link = document.createElement("a");
    link.className = `${PREVIEW_CLASS}__link`;
    link.href = masked[2];
    link.textContent = masked[1];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    container.append(link);
    return;
  }

  if (/^https?:\/\//i.test(text)) {
    const link = document.createElement("a");
    link.className = `${PREVIEW_CLASS}__link`;
    link.href = text;
    link.textContent = text;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    container.append(link);
    return;
  }

  container.textContent = text;
}

function createPreviewEmbed(embed) {
  const card = document.createElement("article");
  card.className = `${PREVIEW_CLASS}__embed`;
  card.style.setProperty("--tds-preview-accent", embedColorCss(embed.color));

  if (embed.author?.name) {
    const author = document.createElement("div");
    author.className = `${PREVIEW_CLASS}__author`;

    if (embed.author.icon_url) {
      const icon = document.createElement("img");
      icon.className = `${PREVIEW_CLASS}__author-icon`;
      icon.src = embed.author.icon_url;
      icon.alt = "";
      icon.loading = "lazy";
      icon.referrerPolicy = "no-referrer";
      author.append(icon);
    }

    const name = document.createElement("span");
    name.className = `${PREVIEW_CLASS}__author-name`;
    if (embed.author.url) {
      const link = document.createElement("a");
      link.className = `${PREVIEW_CLASS}__link`;
      link.href = embed.author.url;
      link.textContent = embed.author.name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      name.append(link);
    } else {
      name.textContent = embed.author.name;
    }

    author.append(name);
    card.append(author);
  }

  if (embed.title) {
    const title = document.createElement("div");
    title.className = `${PREVIEW_CLASS}__title`;
    title.textContent = embed.title;
    card.append(title);
  }

  if (embed.description) {
    const description = document.createElement("div");
    description.className = `${PREVIEW_CLASS}__description`;
    description.textContent = embed.description;
    card.append(description);
  }

  if (embed.image?.url) {
    const imageWrap = document.createElement("div");
    imageWrap.className = `${PREVIEW_CLASS}__image-wrap`;
    const image = document.createElement("img");
    image.className = `${PREVIEW_CLASS}__image`;
    image.src = embed.image.url;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    imageWrap.append(image);
    card.append(imageWrap);
  }

  for (const field of embed.fields || []) {
    const fieldEl = document.createElement("div");
    fieldEl.className = `${PREVIEW_CLASS}__field`;

    const name = document.createElement("div");
    name.className = `${PREVIEW_CLASS}__field-name`;
    name.textContent = field.name || "";

    const value = document.createElement("div");
    value.className = `${PREVIEW_CLASS}__field-value`;
    appendLinkText(value, field.value);

    fieldEl.append(name, value);
    card.append(fieldEl);
  }

  if (embed.footer?.text) {
    const footer = document.createElement("div");
    footer.className = `${PREVIEW_CLASS}__footer`;
    footer.textContent = embed.footer.text;
    card.append(footer);
  }

  return card;
}

function previewMessageLabel(payload, index, total) {
  if (payload._messageLabel) return payload._messageLabel;
  if (total <= 1) return "";
  if (payload.content && !payload.embeds?.length) return `Message ${index + 1} of ${total} · Videos`;
  return `Message ${index + 1} of ${total} · Tweet`;
}

function appendPreviewContent(message, content) {
  const blocks = String(content || "").split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const blockEl = document.createElement("div");
    blockEl.className = `${PREVIEW_CLASS}__content-block`;

    const lines = block.split("\n");
    const titleMatch = /^\*\*(.+)\*\*$/.exec(lines[0] || "");
    if (titleMatch && lines[1] && /^https?:\/\//i.test(lines[1].trim())) {
      const title = document.createElement("div");
      title.className = `${PREVIEW_CLASS}__content-title`;
      title.textContent = titleMatch[1];
      blockEl.append(title);

      const link = document.createElement("a");
      link.className = `${PREVIEW_CLASS}__link`;
      link.href = lines[1].trim();
      link.textContent = lines[1].trim();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      blockEl.append(link);
    } else {
      blockEl.textContent = block;
    }

    message.append(blockEl);
  }
}

function createPreviewMessage(payload, index, total) {
  const message = document.createElement("div");
  message.className = `${PREVIEW_CLASS}__message`;

  const labelText = previewMessageLabel(payload, index, total);
  if (labelText) {
    const label = document.createElement("div");
    label.className = `${PREVIEW_CLASS}__message-label`;
    label.textContent = labelText;
    message.append(label);
  }

  if (payload.username || payload.avatar_url) {
    const header = document.createElement("div");
    header.className = `${PREVIEW_CLASS}__webhook`;

    if (payload.avatar_url) {
      const avatar = document.createElement("img");
      avatar.className = `${PREVIEW_CLASS}__webhook-avatar`;
      avatar.src = payload.avatar_url;
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.referrerPolicy = "no-referrer";
      header.append(avatar);
    }

    const name = document.createElement("span");
    name.className = `${PREVIEW_CLASS}__webhook-name`;
    name.textContent = payload.username || WEBHOOK_SENDER_NAME;
    header.append(name);
    message.append(header);
  }

  if (payload.content) {
    appendPreviewContent(message, payload.content);
  }

  for (const embed of payload.embeds || []) {
    message.append(createPreviewEmbed(embed));
  }

  return message;
}

function renderDiscordPreview(payloads, options = {}) {
  const host = document.createElement("div");
  host.className = PREVIEW_CLASS;
  const list = Array.isArray(payloads) ? payloads : [];

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = `${PREVIEW_CLASS}__empty`;
    empty.textContent = "Nothing to preview for this post.";
    host.append(empty);
    return host;
  }

  list.forEach((payload, index) => {
    host.append(createPreviewMessage(payload, index, list.length));
  });

  if (options.hasMediaCandidates) {
    const hint = document.createElement("div");
    hint.className = `${PREVIEW_CLASS}__attachment-hint`;
    hint.textContent = "Media uploads when eligible; unavailable or oversized video is sent as a playable link.";
    host.append(hint);
  }

  return host;
}

function previewStylesCss() {
  return `
    .${POPOVER_CLASS}--with-preview {
      min-width: min(320px, calc(100vw - 16px));
      max-width: min(400px, calc(100vw - 16px));
    }
    .${POPOVER_CLASS}__preview-wrap {
      border-top-width: 1px;
      border-top-style: solid;
      border-color: rgb(var(--tds-border, 47 51 54));
      margin: 4px 4px 8px;
      max-height: min(42vh, 360px);
      overflow: auto;
      padding: 8px 8px 4px;
    }
    .${POPOVER_CLASS}__preview-label {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      margin: 0 0 8px;
      text-transform: uppercase;
    }
    .${POPOVER_CLASS}__preview-status {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 14px;
      line-height: 1.4;
      margin: 0;
      padding: 8px 4px 12px;
    }
    .${PREVIEW_CLASS} {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .${PREVIEW_CLASS}__empty {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 14px;
      line-height: 1.4;
      margin: 0;
    }
    .${PREVIEW_CLASS}__message {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .${PREVIEW_CLASS}__message-label {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 12px;
      font-weight: 600;
    }
    .${PREVIEW_CLASS}__webhook {
      align-items: center;
      display: flex;
      gap: 8px;
    }
    .${PREVIEW_CLASS}__webhook-avatar {
      border-radius: 50%;
      height: 20px;
      object-fit: cover;
      width: 20px;
    }
    .${PREVIEW_CLASS}__webhook-name {
      color: rgb(var(--tds-text, 231 233 234));
      font-size: 13px;
      font-weight: 600;
    }
    .${PREVIEW_CLASS}__content-block {
      color: rgb(var(--tds-text, 231 233 234));
      display: flex;
      flex-direction: column;
      font-size: 14px;
      gap: 4px;
      line-height: 1.45;
      word-break: break-word;
    }
    .${PREVIEW_CLASS}__content-title {
      font-weight: 700;
    }
    .${PREVIEW_CLASS}__embed {
      background: rgb(var(--tds-text, 231 233 234) / 0.06);
      border-left: 4px solid var(--tds-preview-accent, #5865f2);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px 10px 8px;
    }
    .${PREVIEW_CLASS}__author {
      align-items: center;
      display: flex;
      gap: 8px;
    }
    .${PREVIEW_CLASS}__author-icon {
      border-radius: 50%;
      height: 20px;
      object-fit: cover;
      width: 20px;
    }
    .${PREVIEW_CLASS}__author-name {
      color: rgb(var(--tds-text, 231 233 234));
      font-size: 13px;
      font-weight: 600;
    }
    .${PREVIEW_CLASS}__title {
      color: rgb(var(--tds-text, 231 233 234));
      font-size: 14px;
      font-weight: 700;
    }
    .${PREVIEW_CLASS}__description {
      color: rgb(var(--tds-text, 231 233 234));
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .${PREVIEW_CLASS}__image-wrap {
      margin-top: 2px;
      max-width: 100%;
    }
    .${PREVIEW_CLASS}__image {
      border-radius: 4px;
      display: block;
      max-height: 200px;
      max-width: 100%;
      object-fit: contain;
    }
    .${PREVIEW_CLASS}__field {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .${PREVIEW_CLASS}__field-name {
      color: rgb(var(--tds-text, 231 233 234));
      font-size: 13px;
      font-weight: 700;
    }
    .${PREVIEW_CLASS}__field-value {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 13px;
      line-height: 1.4;
      word-break: break-word;
    }
    .${PREVIEW_CLASS}__footer {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 12px;
    }
    .${PREVIEW_CLASS}__attachment-hint {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 12px;
      line-height: 1.35;
    }
    .${PREVIEW_CLASS}__link {
      color: rgb(var(--tds-blue, 29 155 240));
      text-decoration: none;
      word-break: break-all;
    }
    .${PREVIEW_CLASS}__link:hover {
      text-decoration: underline;
    }
  `;
}
