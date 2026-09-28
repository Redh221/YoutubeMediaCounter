import { loadSettings } from "./settings.js";

let systemTheme = null;

function setTheme(theme) {
  if (theme === "system" && systemTheme) theme = systemTheme;
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// Applies the theme from settings and keeps it in sync when it changes in another view.
// `system` ("light" | "dark") stands in for the system theme where prefers-color-scheme can't be trusted:
// in a frame it follows the embedding page instead of the system.
export async function applyTheme({ system = null } = {}) {
  systemTheme = system;
  setTheme((await loadSettings()).theme);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.settings) setTheme(changes.settings.newValue?.theme);
  });
}
