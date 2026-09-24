import { BADGE_COLORS, BADGE_FORMATS, BADGE_PERIODS, THEMES, loadSettings, saveSettings } from "./settings.js";

function segmented(name, options) {
  return `
    <div class="settings-segmented">
      ${options
        .map(
          ({ value, label, example }) => `
            <label title="${label}">
              <input type="radio" name="${name}" value="${value}" aria-label="${label}" />
              <span>${example ? `<b>${example}</b>` : label}</span>
            </label>`,
        )
        .join("")}
    </div>`;
}

const TEMPLATE = `
  <form class="settings-form">
    <fieldset class="settings-group">
      <legend>Тема</legend>
      ${segmented("theme", THEMES)}
    </fieldset>

    <fieldset class="settings-group">
      <legend>Значок</legend>
      <label class="settings-switch">
        <span>Показывать время</span>
        <input type="checkbox" name="showBadge" role="switch" />
      </label>
      <div class="settings-row">
        <span>Период</span>
        ${segmented("badgePeriod", BADGE_PERIODS)}
      </div>
      <div class="settings-row">
        <span>Формат</span>
        ${segmented("badgeFormat", BADGE_FORMATS)}
      </div>
      <div class="settings-row">
        <span>Цвет</span>
        <div class="settings-swatches">
          ${BADGE_COLORS.map(
            ({ value, label }) => `
              <label class="settings-swatch" title="${label}">
                <input type="radio" name="badgeColor" value="${value}" aria-label="${label}" />
                <span style="background: ${value}"></span>
              </label>`,
          ).join("")}
        </div>
      </div>
    </fieldset>

    <fieldset class="settings-group">
      <legend>Данные</legend>
      <button type="button" data-action="reset" class="settings-button">Обнулить всё время</button>
      <div class="settings-confirm" hidden>
        <span>Стереть время и статистику каналов на всех устройствах?</span>
        <button type="button" data-action="cancel-reset" class="settings-button">Отмена</button>
        <button type="button" data-action="confirm-reset" class="settings-button settings-danger">Обнулить</button>
      </div>
      <p class="settings-note" aria-live="polite"></p>
    </fieldset>
  </form>
`;

export async function mountSettings(container) {
  container.innerHTML = TEMPLATE;
  const form = container.querySelector("form");
  const resetButton = form.querySelector('[data-action="reset"]');
  const confirmBox = form.querySelector(".settings-confirm");
  const note = form.querySelector(".settings-note");

  const settings = await loadSettings();
  form.showBadge.checked = settings.showBadge;
  form.badgePeriod.value = settings.badgePeriod;
  form.badgeFormat.value = settings.badgeFormat;
  form.badgeColor.value = settings.badgeColor;
  form.theme.value = settings.theme;

  form.addEventListener("change", (event) => {
    const { name, type, checked, value } = event.target;
    if (!name) return;
    saveSettings({ [name]: type === "checkbox" ? checked : value });
  });

  // Extension popups can't show confirm() dialogs, so the confirmation is inline.
  form.addEventListener("click", async (event) => {
    const action = event.target.dataset?.action;
    if (action === "reset") {
      resetButton.hidden = true;
      confirmBox.hidden = false;
      note.textContent = "";
    } else if (action === "cancel-reset") {
      resetButton.hidden = false;
      confirmBox.hidden = true;
    } else if (action === "confirm-reset") {
      await chrome.runtime.sendMessage({ type: "RESET_WATCH_TOTAL" });
      resetButton.hidden = false;
      confirmBox.hidden = true;
      note.textContent = "Время обнулено.";
    }
  });
}
