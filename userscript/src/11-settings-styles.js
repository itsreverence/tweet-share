// Settings modal styles, injected once per page.
function injectSettingsStyles() {
  if (document.getElementById("tds-settings-style")) return;

  const style = document.createElement("style");
  style.id = "tds-settings-style";
  style.textContent = `
    ${tdsSharedSurfaceCss()}

    .${SETTINGS_CLASS}__backdrop {
      align-items: center;
      /* Do not use X gray-* tokens for overlay — e.g. --color-gray-1100 is pink on X */
      background-color: rgb(91 112 131 / 0.4);
      display: flex;
      inset: 0;
      justify-content: center;
      padding: 16px;
      position: fixed;
      z-index: 10002;
    }
    .${SETTINGS_CLASS}__dialog {
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      max-height: min(90vh, 720px);
      max-width: 520px;
      overflow: hidden;
      width: 100%;
    }
    .${SETTINGS_CLASS}__dialog:focus {
      outline: none;
    }
    .${SETTINGS_CLASS}__dialog [hidden] {
      display: none;
    }
    .${SETTINGS_CLASS}__header {
      align-items: center;
      border-bottom: 1px solid rgb(var(--tds-border));
      display: flex;
      gap: 12px;
      padding: 12px 12px 12px 20px;
    }
    .${SETTINGS_CLASS}__header h2 {
      flex: 1;
      font-size: 20px;
      font-weight: 800;
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
    .${SETTINGS_CLASS}__close:hover {
      background: rgb(var(--tds-text) / 0.1);
    }
    .${SETTINGS_CLASS}__body {
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 16px 20px 20px;
    }
    .${SETTINGS_CLASS}__section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .${SETTINGS_CLASS}__section-title {
      align-items: baseline;
      display: flex;
      font-size: 17px;
      font-weight: 800;
      gap: 8px;
      margin: 0;
    }
    .${SETTINGS_CLASS}__count {
      color: rgb(var(--tds-subtle));
      font-size: 15px;
      font-weight: 400;
    }
    .${SETTINGS_CLASS}__list {
      border: 1px solid rgb(var(--tds-border));
      border-radius: 12px;
      list-style: none;
      margin: 0;
      overflow: hidden;
      padding: 0;
    }
    .${SETTINGS_CLASS}__row + .${SETTINGS_CLASS}__row {
      border-top: 1px solid rgb(var(--tds-border));
    }
    .${SETTINGS_CLASS}__row-main {
      align-items: center;
      display: flex;
      gap: 12px;
      padding: 10px 12px;
    }
    .${SETTINGS_CLASS}__row-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .${SETTINGS_CLASS}__row-title,
    .${SETTINGS_CLASS}__row-status {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${SETTINGS_CLASS}__row-title {
      font-size: 15px;
      font-weight: 700;
    }
    .${SETTINGS_CLASS}__row-status {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
    }
    .${SETTINGS_CLASS}__row-status[data-invalid="true"] {
      color: rgb(var(--tds-red));
    }
    .${SETTINGS_CLASS}__row-edit {
      background: rgb(var(--tds-raised));
      border-top: 1px solid rgb(var(--tds-border));
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
    }
    .${SETTINGS_CLASS}__card {
      border: 1px solid rgb(var(--tds-border));
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
    }
    .${SETTINGS_CLASS}__card-title {
      font-size: 15px;
      font-weight: 700;
    }
    .${SETTINGS_CLASS}__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .${SETTINGS_CLASS}__field label {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
      font-weight: 700;
    }
    .${SETTINGS_CLASS}__field input {
      background: rgb(var(--tds-surface));
      border: 1px solid rgb(var(--tds-border));
      border-radius: 8px;
      box-sizing: border-box;
      color: rgb(var(--tds-text));
      font: inherit;
      font-size: 15px;
      padding: 10px 12px;
      width: 100%;
    }
    .${SETTINGS_CLASS}__field input::placeholder {
      color: rgb(var(--tds-subtle));
    }
    .${SETTINGS_CLASS}__field input:focus {
      border-color: rgb(var(--tds-blue));
      box-shadow: 0 0 0 1px rgb(var(--tds-blue));
      outline: none;
    }
    .${SETTINGS_CLASS}__secret {
      display: flex;
      gap: 8px;
    }
    .${SETTINGS_CLASS}__secret input {
      flex: 1;
      min-width: 0;
    }
    .${SETTINGS_CLASS}__actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .${SETTINGS_CLASS}__btn {
      align-items: center;
      background: transparent;
      border: 1px solid rgb(var(--tds-border));
      border-radius: 999px;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      justify-content: center;
      min-height: 34px;
      padding: 0 14px;
      white-space: nowrap;
    }
    .${SETTINGS_CLASS}__btn:hover {
      background: rgb(var(--tds-text) / 0.08);
    }
    .${SETTINGS_CLASS}__btn--primary {
      background: rgb(var(--tds-text));
      border-color: transparent;
      color: rgb(var(--tds-surface));
      min-height: 36px;
      padding: 0 18px;
    }
    .${SETTINGS_CLASS}__btn--primary:hover {
      background: rgb(var(--tds-text) / 0.85);
    }
    .${SETTINGS_CLASS}__btn--ghost {
      border-color: transparent;
    }
    .${SETTINGS_CLASS}__btn--danger {
      color: rgb(var(--tds-red));
    }
    .${SETTINGS_CLASS}__btn--danger:hover {
      background: rgb(var(--tds-red) / 0.1);
      border-color: rgb(var(--tds-red) / 0.5);
    }
    .${SETTINGS_CLASS}__btn:disabled {
      cursor: wait;
      opacity: 0.55;
    }
    .${SETTINGS_CLASS}__btn:focus-visible,
    .${SETTINGS_CLASS}__close:focus-visible,
    .${SETTINGS_CLASS}__add-toggle:focus-visible,
    .${SETTINGS_CLASS}__option:focus-within {
      outline: 2px solid rgb(var(--tds-blue));
      outline-offset: 2px;
    }
    .${SETTINGS_CLASS}__add-toggle {
      background: transparent;
      border: 1px dashed rgb(var(--tds-border));
      border-radius: 12px;
      color: rgb(var(--tds-blue));
      cursor: pointer;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      padding: 12px;
      text-align: left;
    }
    .${SETTINGS_CLASS}__add-toggle:hover {
      background: rgb(var(--tds-blue) / 0.08);
      border-color: rgb(var(--tds-blue));
    }
    .${SETTINGS_CLASS}__empty {
      background: rgb(var(--tds-raised));
      border-radius: 12px;
      color: rgb(var(--tds-subtle));
      font-size: 14px;
      line-height: 1.45;
      padding: 14px 16px;
    }
    .${SETTINGS_CLASS}__empty-title {
      color: rgb(var(--tds-text));
      font-size: 15px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    .${SETTINGS_CLASS}__empty-steps {
      margin: 0;
      padding-left: 1.25em;
    }
    .${SETTINGS_CLASS}__empty-steps li {
      margin: 0 0 4px;
    }
    .${SETTINGS_CLASS}__option {
      align-items: flex-start;
      border: 1px solid rgb(var(--tds-border));
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      font-size: 15px;
      gap: 12px;
      line-height: 1.4;
      padding: 12px 14px;
      user-select: none;
    }
    .${SETTINGS_CLASS}__option input {
      accent-color: rgb(var(--tds-blue));
      cursor: pointer;
      flex-shrink: 0;
      height: 18px;
      margin: 1px 0 0;
      width: 18px;
    }
    .${SETTINGS_CLASS}__option-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .${SETTINGS_CLASS}__option-detail {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
    }
    .${SETTINGS_CLASS}__hint {
      color: rgb(var(--tds-subtle));
      font-size: 13px;
      line-height: 1.45;
      margin: 0;
    }
    .${SETTINGS_CLASS}__footer {
      border-top: 1px solid rgb(var(--tds-border));
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 12px 16px;
    }
    @media ${NARROW_VIEWPORT_MEDIA} {
      .${SETTINGS_CLASS}__backdrop {
        padding: 8px;
      }
      .${SETTINGS_CLASS}__body {
        padding: 16px;
      }
      .${SETTINGS_CLASS}__row-main {
        gap: 10px;
        padding: 10px;
      }
      .${SETTINGS_CLASS}__row-main .${SETTINGS_CLASS}__btn {
        padding: 0 10px;
      }
    }
  `;
  appendWhenReady(style);
}
