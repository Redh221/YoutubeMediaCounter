// The "system" theme is whatever Chrome reports to pages (prefers-color-scheme), i.e. the browser's
// light/dark mode, so by default the extension looks like the browser.
export const DEFAULT_SETTINGS = {
  showBadge: true,
  badgePeriod: "today",
  badgeFormat: "hours",
  badgeColor: "#e62117",
  theme: "system",
  // "auto" follows the browser's language; see shared/i18n.js.
  language: "auto",
};

// Option labels are message keys (shared/locales), translated where they are shown.
export const THEMES = [
  { value: "system", labelKey: "themeSystem" },
  { value: "light", labelKey: "themeLight" },
  { value: "dark", labelKey: "themeDark" },
];

export const BADGE_PERIODS = [
  { value: "today", labelKey: "periodToday" },
  { value: "week", labelKey: "periodWeek" },
];

export const BADGE_FORMATS = [
  { value: "hours", labelKey: "formatHours", example: "1.4h" },
  { value: "hoursMinutes", labelKey: "formatHoursMinutes", example: "1h23" },
  { value: "minutes", labelKey: "formatMinutes", example: "83m" },
];

export const BADGE_COLORS = [
  { value: "#e62117", labelKey: "colorRed" },
  { value: "#1a73e8", labelKey: "colorBlue" },
  { value: "#188038", labelKey: "colorGreen" },
  { value: "#8430ce", labelKey: "colorPurple" },
  { value: "#e8710a", labelKey: "colorOrange" },
  { value: "#5f6368", labelKey: "colorGray" },
];

// Settings live in chrome.storage.sync so they follow the Google account across devices.
export async function loadSettings() {
  let { settings } = await chrome.storage.sync.get("settings");
  if (!settings) {
    // Settings saved before cloud sync was added.
    ({ settings } = await chrome.storage.local.get("settings"));
  }
  return { ...DEFAULT_SETTINGS, ...settings };
}

// Saves run one after another: each reads the settings the previous one wrote.
let lastSave = Promise.resolve();

export function saveSettings(changes) {
  lastSave = lastSave
    .catch(() => {})
    .then(async () => {
      const settings = await loadSettings();
      await chrome.storage.sync.set({ settings: { ...settings, ...changes } });
    });
  return lastSave;
}

// Badges fit about four characters. Any watched time shows as at least the smallest unit,
// and values are floored so the badge never runs ahead of the real total.
export function formatBadgeTime(seconds, format = DEFAULT_SETTINGS.badgeFormat) {
  const hours = seconds / 3600;
  const minutes = Math.max(Math.floor(seconds / 60), seconds > 0 ? 1 : 0);

  if (format === "minutes" && minutes < 1000) return `${minutes}m`;

  if (format === "hoursMinutes") {
    if (hours < 1) return `${minutes}m`;
    if (hours < 10) return `${Math.floor(hours)}h${String(minutes % 60).padStart(2, "0")}`;
  }

  if (hours < 10) return `${Math.max(Math.floor(hours * 10) / 10, seconds > 0 ? 0.1 : 0).toFixed(1)}h`;
  return `${Math.floor(hours)}h`;
}
