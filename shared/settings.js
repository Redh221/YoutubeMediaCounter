export const DEFAULT_SETTINGS = {
  showBadge: true,
  badgePeriod: "today",
  badgeFormat: "hours",
  badgeColor: "#e62117",
  theme: "system",
};

export const THEMES = [
  { value: "system", label: "Как в системе" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

export const BADGE_PERIODS = [
  { value: "today", label: "Сегодня" },
  { value: "week", label: "7 дней" },
];

export const BADGE_FORMATS = [
  { value: "hours", label: "Часы", example: "1.4h" },
  { value: "hoursMinutes", label: "Часы и минуты", example: "1h23" },
  { value: "minutes", label: "Минуты", example: "83m" },
];

export const BADGE_COLORS = [
  { value: "#e62117", label: "Красный" },
  { value: "#1a73e8", label: "Синий" },
  { value: "#188038", label: "Зелёный" },
  { value: "#8430ce", label: "Фиолетовый" },
  { value: "#e8710a", label: "Оранжевый" },
  { value: "#5f6368", label: "Серый" },
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

export async function saveSettings(changes) {
  const settings = await loadSettings();
  await chrome.storage.sync.set({ settings: { ...settings, ...changes } });
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
