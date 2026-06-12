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
    ${previewStylesCss()}

    .${SHARE_MENU_ITEM_CLASS} {
      cursor: pointer;
    }

    .${POPOVER_CLASS} {
      position: fixed;
      z-index: 10000;
      min-width: 220px;
      max-width: min(320px, calc(100vw - 16px));
      padding: 4px;
      font-size: 15px;
    }
    .${POPOVER_CLASS}__title {
      font-size: 13px;
      font-weight: 700;
      padding: 8px 12px 4px;
    }
    .${POPOVER_CLASS}__item {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 8px;
      color: inherit;
      cursor: pointer;
      display: flex;
      font: inherit;
      gap: 8px;
      padding: 10px 12px;
      text-align: left;
      width: 100%;
    }
    .${POPOVER_CLASS}__item:hover,
    .${POPOVER_CLASS}__item:focus-visible,
    .${POPOVER_CLASS}__manage:hover,
    .${POPOVER_CLASS}__manage:focus-visible {
      outline: none;
    }
    .${POPOVER_CLASS}__item[data-last="true"]::after {
      content: "Last used";
      font-size: 11px;
      margin-left: auto;
    }
    .${POPOVER_CLASS}__quote-option {
      align-items: center;
      cursor: pointer;
      display: flex;
      font-size: 14px;
      gap: 8px;
      margin: 2px 4px 6px;
      padding: 8px 12px;
      user-select: none;
    }
    .${POPOVER_CLASS}__quote-option input {
      accent-color: var(--color-primary, #1d9bf0);
      cursor: pointer;
      flex-shrink: 0;
      height: 16px;
      width: 16px;
    }
    .${POPOVER_CLASS}__footer {
      border-top-width: 1px;
      border-top-style: solid;
      margin-top: 4px;
      padding-top: 4px;
    }
    .${POPOVER_CLASS}__manage {
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      font-weight: 400;
      padding: 12px;
      text-align: left;
      width: 100%;
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
      border-radius: var(--border-radius-large, 16px);
      border-left-width: 3px;
      border-left-style: solid;
      font-size: 15px;
      line-height: 1.35;
      padding: 12px 14px;
      pointer-events: auto;
      animation: tds-toast-in 0.2s ease;
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

function positionPopover(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  menu.style.visibility = "hidden";
  menu.style.left = "0";
  menu.style.top = "0";
  if (!menu.isConnected) {
    document.body.append(menu);
  }

  const menuRect = menu.getBoundingClientRect();
  let top = rect.top - menuRect.height - margin;
  if (top < margin) {
    top = rect.bottom + margin;
  }

  let left = rect.left + rect.width / 2 - menuRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.visibility = "visible";
}
