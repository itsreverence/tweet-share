// Shared UI surface helpers: styles, toasts, and popover positioning.
let activePopover = null;
let activePopoverCleanup = null;

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
      right: 16px;
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
      padding: 12px 14px 12px 40px;
      pointer-events: auto;
      position: relative;
    }
    .${TOAST_CLASS}::before {
      border-radius: 999px;
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      height: 18px;
      left: 12px;
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
  if (activePopoverCleanup) {
    activePopoverCleanup();
    activePopoverCleanup = null;
  }
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

const PANEL_MARGIN = 8;
const SHEET_MAX_WIDTH = 500;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

// Rects and sizes are in viewport pixels; maxHeight caps the panel so only its preview scrolls.
function placePanel({ anchorRect, panelSize, viewport }) {
  if (viewport.width < SHEET_MAX_WIDTH) {
    const maxHeight = Math.round(viewport.height * 0.85);
    return { mode: "sheet", top: Math.round(viewport.height - Math.min(panelSize.height, maxHeight)), left: 0, maxHeight };
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

function positionPopover(panel, anchor) {
  panel.style.maxHeight = "";
  if (!panel.isConnected) {
    document.body.append(panel);
  }

  const { width, height } = panel.getBoundingClientRect();
  const placement = placePanel({
    anchorRect: anchor.getBoundingClientRect(),
    panelSize: { width, height },
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
  panel.dataset.placement = placement.mode;
  panel.style.top = `${placement.top}px`;
  panel.style.left = `${placement.left}px`;
  panel.style.maxHeight = `${placement.maxHeight}px`;
}

function createChannelAvatar(destination) {
  const avatar = document.createElement("span");
  avatar.className = AVATAR_CLASS;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = [...destination.label.trim()][0]?.toUpperCase() || "#";
  let hash = 0;
  for (const char of destination.id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  avatar.style.setProperty("--tds-hue", String(hash % 360));
  return avatar;
}
