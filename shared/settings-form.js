import { LANGUAGES, languageLabel, t } from "./i18n.js";
import { BADGE_COLORS, BADGE_FORMATS, BADGE_PERIODS, THEMES, loadSettings, saveSettings } from "./settings.js";

function segmented(name, options) {
  return `
    <div class="settings-segmented">
      ${options
        .map(({ value, labelKey, example }) => ({ value, label: t(labelKey), example }))
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

// Built on mount, after the interface language is known.
const template = () => `
  <form class="settings-form">
    <fieldset class="settings-group">
      <legend>${t("theme")}</legend>
      ${segmented("theme", THEMES)}
    </fieldset>

    <fieldset class="settings-group">
      <legend>${t("language")}</legend>
      <select name="language" class="settings-select" aria-label="${t("language")}">
        <option value="auto">${t("languageAuto")}</option>
        ${LANGUAGES.map((language) => `<option value="${language.code}">${languageLabel(language)}</option>`).join("")}
      </select>
    </fieldset>

    <fieldset class="settings-group">
      <legend>${t("badge")}</legend>
      <label class="settings-switch">
        <span>${t("showTime")}</span>
        <input type="checkbox" name="showBadge" role="switch" />
      </label>
      <div class="settings-row">
        <span>${t("period")}</span>
        ${segmented("badgePeriod", BADGE_PERIODS)}
      </div>
      <div class="settings-row">
        <span>${t("format")}</span>
        ${segmented("badgeFormat", BADGE_FORMATS)}
      </div>
      <div class="settings-row">
        <span>${t("color")}</span>
        <div class="settings-swatches">
          ${BADGE_COLORS.map(({ value, labelKey }) => ({ value, label: t(labelKey) })).map(
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
      <legend>${t("data")}</legend>
      <button type="button" data-action="reset" class="settings-button">${t("resetAll")}</button>
      <div class="settings-confirm" hidden>
        <span>${t("resetConfirm")}</span>
        <button type="button" data-action="cancel-reset" class="settings-button">${t("cancel")}</button>
        <button type="button" data-action="confirm-reset" class="settings-button settings-danger">${t("reset")}</button>
      </div>
      <p class="settings-note" aria-live="polite"></p>
    </fieldset>
  </form>
`;

export async function mountSettings(container) {
  container.innerHTML = template();
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
  form.language.value = settings.language;

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
      note.textContent = t("resetDone");
    }
  });
}
