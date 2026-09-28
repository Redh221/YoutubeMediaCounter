// Interface language. Chrome's own chrome.i18n always follows the browser language and can't be
// switched, so the strings live here and the language comes from settings ("auto" = the browser's).
import de from "./locales/de.js";
import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import kk from "./locales/kk.js";
import pt from "./locales/pt.js";
import ru from "./locales/ru.js";
import uk from "./locales/uk.js";
import { loadSettings } from "./settings.js";

const MESSAGES = { en, ru, uk, kk, de, es, fr, pt };
const FALLBACK = "en";

// Shown in the language picker as "Native name (English name)".
export const LANGUAGES = [
  { code: "en", name: "English", englishName: "English" },
  { code: "ru", name: "Русский", englishName: "Russian" },
  { code: "uk", name: "Українська", englishName: "Ukrainian" },
  { code: "kk", name: "Қазақша", englishName: "Kazakh" },
  { code: "de", name: "Deutsch", englishName: "German" },
  { code: "es", name: "Español", englishName: "Spanish" },
  { code: "fr", name: "Français", englishName: "French" },
  { code: "pt", name: "Português", englishName: "Portuguese" },
];

export function languageLabel({ name, englishName }) {
  return name === englishName ? name : `${name} (${englishName})`;
}

export function resolveLanguage(setting) {
  if (setting && setting !== "auto" && MESSAGES[setting]) return setting;
  const browser = chrome.i18n.getUILanguage().toLowerCase().split(/[-_]/)[0];
  return MESSAGES[browser] ? browser : FALLBACK;
}

let language = resolveLanguage("auto");

export function currentLanguage() {
  return language;
}

export function setLanguage(setting) {
  language = resolveLanguage(setting);
  return language;
}

// t("key", { name: value }) fills {name} placeholders. Entries with plural forms take `count`.
export function t(key, params = {}) {
  let message = MESSAGES[language][key] ?? MESSAGES[FALLBACK][key] ?? key;
  if (typeof message === "object") {
    const form = new Intl.PluralRules(language).select(params.count ?? 0);
    message = message[form] ?? message.other;
  }
  return message.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function formatDuration(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return t("durationHoursMinutes", { hours, minutes });
  if (totalMinutes > 0) return t("durationMinutes", { minutes });
  return seconds > 0 ? t("durationUnderMinute") : t("durationMinutes", { minutes: 0 });
}

// Static page text: data-i18n (text), data-i18n-title and data-i18n-aria-label hold message keys.
export function localizePage(root = document) {
  document.documentElement.lang = language;
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle);
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
}

// For extension pages: picks the language from settings, translates the static text and reloads
// the page when the language changes, so every view switches together.
export async function setupI18n() {
  const { language: setting } = await loadSettings();
  setLanguage(setting);
  localizePage();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.settings) return;
    if (resolveLanguage(changes.settings.newValue?.language) !== language) location.reload();
  });
}
