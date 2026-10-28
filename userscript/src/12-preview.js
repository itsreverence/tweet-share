function embedColorCss(color) {
  if (typeof color !== "number") return "#5865f2";
  return `#${(color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

function createPreviewLink(href, text) {
  const link = document.createElement("a");
  link.className = `${PREVIEW_CLASS}__link`;
  link.href = href;
  link.title = href;
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

// A masked link's label can name any site, so the preview also shows the host it really opens.
function createMaskedPreviewLink(href, label) {
  const link = createPreviewLink(href, label);
  if (label !== href) {
    const host = document.createElement("span");
    host.className = `${PREVIEW_CLASS}__link-host`;
    host.textContent = ` (${link.host})`;
    link.append(host);
  }
  return link;
}

// The inline markdown the formatter emits and post text can carry: masked links, bare URLs, and _italics_.
const PREVIEW_INLINE_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)|\b_([^_\n]+)_\b/g;

function appendPreviewInline(container, text) {
  let index = 0;
  for (const match of text.matchAll(PREVIEW_INLINE_PATTERN)) {
    const [whole, maskedLabel, maskedUrl, url, italic] = match;
    container.append(text.slice(index, match.index));
    if (italic) {
      const emphasis = document.createElement("em");
      emphasis.textContent = italic;
      container.append(emphasis);
    } else {
      container.append(maskedUrl ? createMaskedPreviewLink(maskedUrl, maskedLabel) : createPreviewLink(url, url));
    }
    index = match.index + whole.length;
  }
  container.append(text.slice(index));
}

// Discord draws a run of "> " lines as one quote with a bar beside it.
function appendPreviewMarkdown(container, value) {
  const runs = [];
  for (const line of String(value || "").split("\n")) {
    const quoted = line.startsWith("> ");
    const text = quoted ? line.slice(2) : line;
    if (runs.at(-1)?.quoted === quoted) runs.at(-1).lines.push(text);
    else runs.push({ quoted, lines: [text] });
  }
  for (const { quoted, lines } of runs) {
    if (!quoted) {
      appendPreviewInline(container, lines.join("\n"));
      continue;
    }
    const quote = document.createElement("blockquote");
    quote.className = `${PREVIEW_CLASS}__quote`;
    appendPreviewInline(quote, lines.join("\n"));
    container.append(quote);
  }
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
      name.append(createPreviewLink(embed.author.url, embed.author.name));
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
    appendPreviewMarkdown(description, embed.description);
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
    appendPreviewMarkdown(value, field.value);

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

  const avatar = document.createElement("img");
  avatar.className = `${PREVIEW_CLASS}__webhook-avatar`;
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.referrerPolicy = "no-referrer";
  if (payload.avatar_url) avatar.src = payload.avatar_url;

  const body = document.createElement("div");
  body.className = `${PREVIEW_CLASS}__message-body`;
  const header = document.createElement("div");
  header.className = `${PREVIEW_CLASS}__webhook`;
  const name = document.createElement("span");
  name.className = `${PREVIEW_CLASS}__webhook-name`;
  name.textContent = payload.username || WEBHOOK_SENDER_NAME;
  const badge = document.createElement("span");
  badge.className = `${PREVIEW_CLASS}__app-badge`;
  badge.textContent = "APP";
  header.append(name, badge);
  body.append(header);

  if (payload.content) {
    const content = document.createElement("div");
    content.className = `${PREVIEW_CLASS}__content`;
    appendPreviewMarkdown(content, payload.content);
    body.append(content);
  }

  for (const embed of payload.embeds || []) {
    body.append(createPreviewEmbed(embed));
  }

  message.append(avatar, body);
  return message;
}

function mediaFileCount(count) {
  return count === 1 ? "1 media file" : `${count} media files`;
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

  const attachmentUrls = options.attachmentUrls || [];
  if (attachmentUrls.length) {
    const hint = document.createElement("div");
    hint.className = `${PREVIEW_CLASS}__attachment-hint`;
    const videoNote = attachmentUrls.some(isPlayableTweetVideoUrl) ? " Video too large for Discord goes as a link." : "";
    hint.textContent = `${mediaFileCount(attachmentUrls.length)} attached on send.${videoNote}`;
    host.append(hint);
  }

  return host;
}

function previewStylesCss() {
  return `
    .${POPOVER_CLASS}__preview-wrap {
      flex: 1 1 auto;
      min-height: 72px;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 4px 12px 12px;
    }
    .${POPOVER_CLASS}__preview-wrap:focus-visible {
      outline: 2px solid rgb(var(--tds-blue));
      outline-offset: -2px;
    }
    .${POPOVER_CLASS}__preview-status {
      color: rgb(var(--tds-subtle));
      font-size: 14px;
      line-height: 1.4;
      margin: 0;
      padding: 8px 4px;
    }
    .${PREVIEW_CLASS} {
      background: rgb(var(--tds-raised));
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-block: 12px;
      padding-inline: 8px 12px;
    }
    .${PREVIEW_CLASS}__empty {
      color: rgb(var(--tds-subtle));
      font-size: 14px;
      line-height: 1.4;
      margin: 0;
    }
    .${PREVIEW_CLASS}__message {
      column-gap: 10px;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
    }
    .${PREVIEW_CLASS}__message-label {
      color: rgb(var(--tds-subtle));
      font-size: 11px;
      font-weight: 700;
      grid-column: 1 / -1;
      letter-spacing: 0.02em;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .${PREVIEW_CLASS}__webhook-avatar {
      background: #5865f2;
      border-radius: 50%;
      height: 32px;
      object-fit: cover;
      width: 32px;
    }
    .${PREVIEW_CLASS}__message-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .${PREVIEW_CLASS}__webhook {
      align-items: center;
      display: flex;
      gap: 6px;
      line-height: 1.2;
    }
    .${PREVIEW_CLASS}__webhook-name {
      font-size: 14px;
      font-weight: 700;
    }
    .${PREVIEW_CLASS}__app-badge {
      background: #5865f2;
      border-radius: 3px;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 4px;
    }
    .${PREVIEW_CLASS}__content,
    .${PREVIEW_CLASS}__description,
    .${PREVIEW_CLASS}__field-value {
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .${PREVIEW_CLASS}__content,
    .${PREVIEW_CLASS}__description,
    .${PREVIEW_CLASS}__title {
      font-size: 14px;
    }
    .${PREVIEW_CLASS}__embed {
      background: rgb(var(--tds-surface));
      border: 1px solid rgb(var(--tds-border));
      border-inline-start: 4px solid var(--tds-preview-accent, #5865f2);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
      padding: 8px 10px 10px;
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
    .${PREVIEW_CLASS}__author-name,
    .${PREVIEW_CLASS}__field-name {
      font-size: 13px;
      font-weight: 700;
    }
    .${PREVIEW_CLASS}__author-name .${PREVIEW_CLASS}__link {
      color: inherit;
    }
    .${PREVIEW_CLASS}__title {
      font-weight: 700;
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
    .${PREVIEW_CLASS}__field-value {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
    }
    .${PREVIEW_CLASS}__footer {
      color: rgb(var(--tds-subtle));
      font-size: 12px;
    }
    .${PREVIEW_CLASS}__attachment-hint {
      border-top: 1px solid rgb(var(--tds-border));
      color: rgb(var(--tds-subtle));
      font-size: 12px;
      line-height: 1.35;
      padding-block: 8px 0;
      padding-inline: 4px 0;
    }
    .${PREVIEW_CLASS}__link {
      color: rgb(var(--tds-link));
      text-decoration: none;
      word-break: break-all;
    }
    .${PREVIEW_CLASS}__link:hover {
      text-decoration: underline;
    }
    .${PREVIEW_CLASS}__link-host {
      color: rgb(var(--tds-subtle));
    }
    .${PREVIEW_CLASS}__quote {
      border-inline-start: 4px solid rgb(var(--tds-subtle) / 0.5);
      border-radius: 4px;
      margin: 0;
      padding-inline-start: 10px;
    }
  `;
}
