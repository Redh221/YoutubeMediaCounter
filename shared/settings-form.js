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
      <legend>${t("appearance")}</legend>
      <div role="group" aria-label="${t("theme")}">${segmented("theme", THEMES)}</div>
      <label class="settings-row">
        <span>${t("language")}</span>
        <select name="language" class="settings-select">
          <option value="auto">${t("languageAuto")}</option>
          ${LANGUAGES.map((language) => `<option value="${language.code}">${languageLabel(language)}</option>`).join("")}
        </select>
      </label>
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
      <label class="settings-switch" title="${t("syncHint")}">
        <span>${t("syncDevices")}</span>
        <input type="checkbox" name="syncEnabled" role="switch" />
      </label>
      <button type="button" data-action="reset" class="settings-button">${t("resetAll")}</button>
      <div class="settings-confirm" hidden>
        <span data-ref="reset-question"></span>
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

  const resetQuestion = form.querySelector('[data-ref="reset-question"]');

  // The background script answers null (or not at all) when the request failed.
  async function askBackground(message) {
    const response = await chrome.runtime.sendMessage(message).catch(() => null);
    if (!response) note.textContent = t("backgroundError", { reason: t("emptyResponse") });
    return response;
  }

  const [settings, { syncEnabled }] = await Promise.all([
    loadSettings(),
    chrome.storage.local.get({ syncEnabled: true }),
  ]);
  form.syncEnabled.checked = syncEnabled;
  form.showBadge.checked = settings.showBadge;
  form.badgePeriod.value = settings.badgePeriod;
  form.badgeFormat.value = settings.badgeFormat;
  form.badgeColor.value = settings.badgeColor;
  form.theme.value = settings.theme;
  form.language.value = settings.language;

  // The switch is per device, so it lives in storage.local; keep the popup and the options page in step.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.syncEnabled) form.syncEnabled.checked = changes.syncEnabled.newValue;
  });

  form.addEventListener("change", (event) => {
    const { name, type, checked, value } = event.target;
    if (!name) return;
    // Sync is a per-device switch, kept apart from the settings that follow the Google account.
    if (name === "syncEnabled") {
      note.textContent = "";
      askBackground({ type: "SET_SYNC_ENABLED", enabled: checked }).then((response) => {
        form.syncEnabled.checked = response ? response.syncEnabled : !checked;
      });
      return;
    }
    saveSettings({ [name]: type === "checkbox" ? checked : value });
  });

  // Extension popups can't show confirm() dialogs, so the confirmation is inline.
  form.addEventListener("click", async (event) => {
    const action = event.target.dataset?.action;
    if (action === "reset") {
      resetQuestion.textContent = form.syncEnabled.checked ? t("resetConfirm") : t("resetConfirmLocal");
      resetButton.hidden = true;
      confirmBox.hidden = false;
      note.textContent = "";
    } else if (action === "cancel-reset") {
      resetButton.hidden = false;
      confirmBox.hidden = true;
    } else if (action === "confirm-reset") {
      const response = await askBackground({ type: "RESET_WATCH_TOTAL" });
      resetButton.hidden = false;
      confirmBox.hidden = true;
      if (response) note.textContent = t("resetDone");
    }
  });
}
