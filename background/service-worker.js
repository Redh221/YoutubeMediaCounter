import { formatBadgeTime, loadSettings } from "../shared/settings.js";

const WEEK_DAYS = 7;

let watchedSeconds = 0;
// Per-day stats keyed by local date ("2026-09-24"): { total, channels: { [channelId]: { name, url, seconds } } }.
let dailyStats = {};
let settings;
const watchTotalReady = Promise.all([
  chrome.storage.local.get({ watchedSeconds: 0, dailyStats: {} }),
  loadSettings(),
]).then(([stored, loadedSettings]) => {
  watchedSeconds = stored.watchedSeconds;
  dailyStats = stored.dailyStats;
  settings = loadedSettings;
  updateBadge();
});

function dayKey(date) {
  return date.toLocaleDateString("sv");
}

function weekStartKey() {
  const date = new Date();
  date.setDate(date.getDate() - (WEEK_DAYS - 1));
  return dayKey(date);
}

function addDailyTime(seconds, channel) {
  const day = (dailyStats[dayKey(new Date())] ??= { total: 0, channels: {} });
  day.total += seconds;
  if (channel?.id) {
    const entry = (day.channels[channel.id] ??= { name: channel.name, url: channel.url, seconds: 0 });
    entry.name = channel.name;
    if (channel.avatar) entry.avatar = channel.avatar;
    entry.seconds += seconds;
  }

  const oldestKept = weekStartKey();
  for (const key of Object.keys(dailyStats)) {
    if (key < oldestKept) delete dailyStats[key];
  }
}

function getWeekStats(limit = 5) {
  const oldestKept = weekStartKey();
  const channels = new Map();
  let weekSeconds = 0;

  for (const [key, day] of Object.entries(dailyStats)) {
    if (key < oldestKept) continue;
    weekSeconds += day.total;
    for (const [id, { name, url, avatar, seconds }] of Object.entries(day.channels)) {
      const channel = channels.get(id) ?? { id, name, url, avatar: null, seconds: 0 };
      channel.seconds += seconds;
      // Days are iterated oldest first, so the latest display name and avatar win.
      channel.name = name;
      if (avatar) channel.avatar = avatar;
      channels.set(id, channel);
    }
  }

  const topChannels = [...channels.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
  return { weekSeconds, topChannels };
}

function isYouTubeUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function formatFullTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

// The global badge stays empty; YouTube tabs get a tab-specific badge, so it only shows on YouTube.
function updateTabBadge(tabId, url) {
  const seconds = watchedSeconds > 0 ? Math.max(Math.floor(watchedSeconds), 1) : 0;
  const onYouTube = isYouTubeUrl(url);
  const showBadge = onYouTube && settings.showBadge;
  chrome.action.setBadgeText({ tabId, text: showBadge ? formatBadgeTime(seconds, settings.badgeFormat) : "" });
  chrome.action.setTitle({
    tabId,
    title: onYouTube ? `YouTube Media Counter — просмотрено: ${formatFullTime(seconds)}` : "YouTube Media Counter",
  });
}

async function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: settings.badgeColor });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    updateTabBadge(tab.id, tab.url);
  }
}

chrome.action.setBadgeText({ text: "" });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    watchTotalReady.then(() => updateTabBadge(tabId, tab.url));
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) return;
  watchTotalReady
    .then(loadSettings)
    .then((loadedSettings) => {
      settings = loadedSettings;
      updateBadge();
    });
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    console.info("YouTube Media Counter installed");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_WATCH_TOTAL") {
    watchTotalReady.then(() => {
      sendResponse({ watchedSeconds });
    });
    return true;
  }

  if (message?.type === "GET_WEEK_STATS") {
    watchTotalReady.then(() => {
      sendResponse(getWeekStats());
    });
    return true;
  }

  if (message?.type === "ADD_WATCH_TIME" && Number.isFinite(message.seconds)) {
    watchTotalReady.then(() => {
      watchedSeconds += message.seconds;
      addDailyTime(message.seconds, message.channel);
      updateBadge();
      return chrome.storage.local.set({ watchedSeconds, dailyStats });
    });
  }

  if (message?.type === "RESET_WATCH_TOTAL") {
    watchTotalReady
      .then(() => {
        watchedSeconds = 0;
        dailyStats = {};
        updateBadge();
        return chrome.storage.local.set({ watchedSeconds, dailyStats });
      })
      .then(() => sendResponse({ watchedSeconds }));
    return true;
  }
});
