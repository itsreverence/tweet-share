// Shared UI surface helpers: styles, toasts, and popover positioning.
let activePanel = null;

function appendWhenReady(node) {
  if (document.documentElement) {
    document.documentElement.append(node);
    return;
  }

  document.addEventListener("DOMContentLoaded", () => document.documentElement.append(node), { once: true });
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    ${tdsSharedSurfaceCss()}
    ${popoverStylesCss()}
    ${previewStylesCss()}

    .${SHARE_MENU_ITEM_CLASS} {
      cursor: pointer;
    }

    .${AVATAR_CLASS} {
      align-items: center;
      background: hsl(var(--tds-hue) 60% 45%);
      border-radius: 10px;
      color: #fff;
      display: inline-flex;
      flex-shrink: 0;
      font-size: 15px;
      font-weight: 800;
      height: 34px;
      justify-content: center;
      width: 34px;
    }

    .${TOAST_HOST_CLASS} {
      position: fixed;
      inset-inline-end: 16px;
      bottom: 16px;
      z-index: 10001;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
      max-width: min(360px, calc(100vw - 32px));
    }
    .${TOAST_CLASS} {
      animation: tds-toast-in 0.2s ease;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
      padding-block: 12px;
      padding-inline: 40px 14px;
      pointer-events: auto;
      position: relative;
    }
    .${TOAST_CLASS}::before {
      border-radius: 999px;
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      height: 18px;
      inset-inline-start: 12px;
      line-height: 18px;
      position: absolute;
      text-align: center;
      top: 13px;
      width: 18px;
    }
    /* The "/ ''" alt text keeps the icon glyph out of what screen readers announce. */
    .${TOAST_CLASS}[data-state="success"]::before {
      background: rgb(var(--tds-green));
      content: "✓";
      content: "✓" / "";
    }
    .${TOAST_CLASS}[data-state="error"]::before {
      background: rgb(var(--tds-red));
      content: "!";
      content: "!" / "";
    }
    .${TOAST_CLASS}[data-state="info"]::before {
      background: rgb(var(--tds-blue));
      content: "…";
      content: "…" / "";
      line-height: 14px;
    }
    @keyframes tds-toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  appendWhenReady(style);
}

function getToastHost() {
  let host = document.querySelector(`.${TOAST_HOST_CLASS}`);
  if (!host) {
    host = document.createElement("div");
    host.className = TOAST_HOST_CLASS;
    appendWhenReady(host);
  }
  return host;
}

function showToast(message, state = "info") {
  const host = getToastHost();
  const toastEl = document.createElement("div");
  toastEl.className = TOAST_CLASS;
  applyXThemeVars(toastEl);
  toastEl.dataset.state = state;
  toastEl.setAttribute("role", state === "error" ? "alert" : "status");
  toastEl.textContent = message;
  host.append(toastEl);

  window.setTimeout(() => {
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateY(4px)";
    toastEl.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    window.setTimeout(() => toastEl.remove(), 220);
  }, TOAST_DURATION_MS);
}

function closeXOverlay() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

function closeDestinationMenu() {
  activePanel?.close();
}

const PANEL_MARGIN = 8;
const NARROW_VIEWPORT_WIDTH = 500;
const NARROW_VIEWPORT_MEDIA = `(max-width: ${NARROW_VIEWPORT_WIDTH - 0.02}px)`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

// What the user sees, in the coordinates of getBoundingClientRect and fixed positioning. Pinch zoom shrinks and moves it.
function visibleViewport() {
  const visual = window.visualViewport;
  return visual
    ? new DOMRect(visual.offsetLeft, visual.offsetTop, visual.width, visual.height)
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

function rectsOverlap(a, b) {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

// Rects and sizes are in viewport pixels; maxHeight caps the panel so only its preview scrolls.
// A sheet has no top or left, because the narrow-viewport CSS pins it to the bottom edge, clear of the scrollbar.
function placePanel({ anchorRect, panelSize, viewport }) {
  if (viewport.width < NARROW_VIEWPORT_WIDTH) {
    return { mode: "sheet", maxHeight: Math.round(viewport.height * 0.85) };
  }

  const maxHeight = viewport.height - PANEL_MARGIN * 2;
  const height = Math.min(panelSize.height, maxHeight);
  const left = clamp(
    anchorRect.left + anchorRect.width / 2 - panelSize.width / 2,
    PANEL_MARGIN,
    viewport.width - panelSize.width - PANEL_MARGIN
  );
  let mode = "clamped";
  let top = anchorRect.top + anchorRect.height / 2 - height / 2;
  if (panelSize.height <= anchorRect.top - PANEL_MARGIN * 2) {
    mode = "above";
    top = anchorRect.top - PANEL_MARGIN - panelSize.height;
  } else if (panelSize.height <= viewport.height - anchorRect.bottom - PANEL_MARGIN * 2) {
    mode = "below";
    top = anchorRect.bottom + PANEL_MARGIN;
  }
  top = clamp(top, PANEL_MARGIN, viewport.height - height - PANEL_MARGIN);
  return { mode, top: Math.round(top), left: Math.round(left), maxHeight };
}

function positionPopover(panel, anchorRect) {
  panel.style.maxHeight = "";
  if (!panel.isConnected) {
    document.body.append(panel);
  }

  const { width, height } = panel.getBoundingClientRect();
  const placement = placePanel({
    anchorRect,
    panelSize: { width, height },
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
  const sheet = placement.mode === "sheet";
  panel.style.top = sheet ? "" : `${placement.top}px`;
  panel.style.left = sheet ? "" : `${placement.left}px`;
  panel.style.maxHeight = `${placement.maxHeight}px`;
}

// Escape is the panel's only while focus is in it, on its Share button, or nowhere, so Escape elsewhere on X is left alone.
// When X re-renders the post away, the panel keeps the place its Share button last had.
function showPanel(panel, { findAnchor, returnFocus }) {
  closeDestinationMenu();
  let anchorRect = new DOMRect();
  const place = () => {
    anchorRect = findAnchor()?.getBoundingClientRect() ?? anchorRect;
    positionPopover(panel, anchorRect);
  };
  const ownsFocus = (node) => node === document.body || panel.contains(node) || node === findAnchor();
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !ownsFocus(document.activeElement)) return;
    close();
    returnFocus();
  };
  const onPointerDown = (event) => {
    if (!panel.contains(event.target) && !findAnchor()?.contains(event.target)) close();
  };
  const listeners = [
    [document, "keydown", onKeyDown, false],
    [document, "pointerdown", onPointerDown, true],
    [window, "resize", place, false],
    [window, "orientationchange", place, false],
    [window.visualViewport, "resize", place, false]
  ].filter(([target]) => target);

  function close() {
    for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
    panel.remove();
    activePanel = null;
  }

  for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
  place();
  panel.focus({ preventScroll: true });
  activePanel = { place, close, ownsFocus, returnFocus };
  return activePanel;
}

// The first character a reader sees, so a flag or a family emoji stays whole.
function firstGrapheme(text) {
  if (!Intl.Segmenter) return [...text][0];
  return new Intl.Segmenter().segment(text)[Symbol.iterator]().next().value?.segment;
}

function createChannelAvatar(destination) {
  const avatar = document.createElement("span");
  avatar.className = AVATAR_CLASS;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = firstGrapheme(destination.label.trim())?.toUpperCase() || "#";
  let hash = 0;
  for (const char of destination.id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  avatar.style.setProperty("--tds-hue", String(hash % 360));
  return avatar;
}
