import { loadSettings } from "./settings.js";

function setTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// Applies the theme from settings and keeps it in sync when it changes in another view.
export async function applyTheme() {
  setTheme((await loadSettings()).theme);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.settings) setTheme(changes.settings.newValue?.theme);
  });
}
