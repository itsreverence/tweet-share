// Settings modal surface helpers: styles and small DOM builders.
function injectSettingsStyles() {
  if (document.getElementById("tds-settings-style")) return;

  const style = document.createElement("style");
  style.id = "tds-settings-style";
  style.textContent = `
    ${tdsSharedSurfaceCss()}

    .${SETTINGS_CLASS}__backdrop {
      position: fixed;
      inset: 0;
      z-index: 10002;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      /* Do not use X gray-* tokens for overlay — e.g. --color-gray-1100 is pink on X */
      background-color: rgba(0, 0, 0, 0.65);
    }
    .${SETTINGS_CLASS}__dialog {
      border-radius: var(--border-radius-x-large, 20px);
      max-height: min(90vh, 720px);
      max-width: 520px;
      overflow: hidden;
      width: 100%;
      display: flex;
      flex-direction: column;
    }
    .${SETTINGS_CLASS}__header {
      align-items: center;
      border-bottom-width: 1px;
      border-bottom-style: solid;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 16px 18px;
    }
    .${SETTINGS_CLASS}__header h2 {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
    }
    .${SETTINGS_CLASS}__close {
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: inherit;
      cursor: pointer;
      font-size: 22px;
      height: 36px;
      line-height: 1;
      width: 36px;
    }
    .${SETTINGS_CLASS}__body {
      overflow: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .${SETTINGS_CLASS}__hint {
      font-size: 15px;
      line-height: 1.45;
      margin: 0;
    }
    .${SETTINGS_CLASS}__list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .${SETTINGS_CLASS}__card {
      border-width: 1px;
      border-style: solid;
      border-radius: var(--border-radius-large, 16px);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .${SETTINGS_CLASS}__card-head {
      align-items: flex-start;
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }
    .${SETTINGS_CLASS}__card-title {
      font-size: 15px;
      font-weight: 700;
    }
    .${SETTINGS_CLASS}__card-id {
      font-size: 13px;
    }
    .${SETTINGS_CLASS}__field input {
      border-radius: var(--border-radius-medium, 8px);
      box-sizing: border-box;
      font: inherit;
      font-size: 15px;
      padding: 12px;
      width: 100%;
    }
    .${SETTINGS_CLASS}__remove {
      background: transparent;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      flex-shrink: 0;
      font: inherit;
      font-size: 15px;
      padding: 8px 12px;
    }
    .${SETTINGS_CLASS}__footer {
      border-top-width: 1px;
      border-top-style: solid;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 14px 18px;
    }
    .${SETTINGS_CLASS}__btn {
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      min-height: 36px;
      padding: 0 16px;
    }
    .${SETTINGS_CLASS}__btn--ghost {
      background: transparent;
      color: inherit;
    }
    .${SETTINGS_CLASS}__empty {
      font-size: 15px;
      padding: 8px 0;
    }
    .${SETTINGS_CLASS}__section-title {
      font-size: 17px;
      font-weight: 700;
      margin: 0;
    }
    .${SETTINGS_CLASS}__option {
      align-items: flex-start;
      cursor: pointer;
      display: flex;
      font-size: 15px;
      gap: 10px;
      line-height: 1.45;
      user-select: none;
    }
    .${SETTINGS_CLASS}__option input {
      accent-color: rgb(var(--tds-blue, 29 155 240));
      cursor: pointer;
      flex-shrink: 0;
      height: 16px;
      margin-top: 3px;
      width: 16px;
    }
    .${SETTINGS_CLASS}__option-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .${SETTINGS_CLASS}__option-detail {
      color: rgb(var(--tds-subtle, 113 118 123));
      font-size: 14px;
    }
  `;
  appendWhenReady(style);
}

function createSettingsOption(labelText, detailText, checked) {
  const option = document.createElement("label");
  option.className = `${SETTINGS_CLASS}__option`;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const text = document.createElement("span");
  text.className = `${SETTINGS_CLASS}__option-text`;
  const label = document.createElement("span");
  label.textContent = labelText;
  text.append(label);
  if (detailText) {
    const detail = document.createElement("span");
    detail.className = `${SETTINGS_CLASS}__option-detail`;
    detail.textContent = detailText;
    text.append(detail);
  }

  option.append(input, text);
  return { option, input };
}

function closeSettingsModal() {
  document.querySelector(`.${SETTINGS_CLASS}__backdrop`)?.remove();
}

function createSettingsField(labelText, input) {
  const fieldEl = document.createElement("div");
  fieldEl.className = `${SETTINGS_CLASS}__field`;
  const label = document.createElement("label");
  label.textContent = labelText;
  fieldEl.append(label, input);
  return fieldEl;
}
