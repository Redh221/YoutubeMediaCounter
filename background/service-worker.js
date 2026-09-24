import { formatBadgeTime, loadSettings } from "../shared/settings.js";
import { getDeviceId, isDeviceKey, loadOtherDevices, removeAllDevices, toSyncItem } from "./cloud-sync.js";

const WEEK_DAYS = 7;
const SYNC_ALARM = "cloud-sync";
// chrome.storage.sync allows ~120 writes a minute, so this device's stats are pushed once a minute.
const SYNC_PERIOD_MINUTES = 1;

let deviceId;
// This device's stats. Other devices' stats come from the cloud and are only added up for display.
let watchedSeconds = 0;
// Per-day stats keyed by local date ("2026-09-24"): { total, channels: { [channelId]: { name, url, avatar, seconds } } }.
let dailyStats = {};
let otherDevices = [];
let lastPushed = "";
let settings;

const watchTotalReady = init();

async function init() {
  const [id, stored, loadedSettings, { resetAt = 0 }] = await Promise.all([
    getDeviceId(),
    chrome.storage.local.get({ watchedSeconds: 0, dailyStats: {}, lastResetAt: 0 }),
    loadSettings(),
    chrome.storage.sync.get("resetAt"),
  ]);
  deviceId = id;
  settings = loadedSettings;
  watchedSeconds = stored.watchedSeconds;
  dailyStats = stored.dailyStats;
  // Another device reset the counter while this one was offline.
  if (resetAt > stored.lastResetAt) await clearLocalStats(resetAt);
  otherDevices = await loadOtherDevices(deviceId);
  updateBadge();

  if (!(await chrome.alarms.get(SYNC_ALARM))) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

async function clearLocalStats(resetAt) {
  watchedSeconds = 0;
  dailyStats = {};
  lastPushed = "";
  await chrome.storage.local.set({ watchedSeconds, dailyStats, lastResetAt: resetAt });
}

async function pushToCloud() {
  const { key, item } = toSyncItem(deviceId, watchedSeconds, dailyStats);
  const json = JSON.stringify(item);
  if (json === lastPushed) return;
  await chrome.storage.sync.set({ [key]: item });
  lastPushed = json;
}

function totalSeconds() {
  return otherDevices.reduce((sum, device) => sum + device.watchedSeconds, watchedSeconds);
}

function allDailyStats() {
  return [...otherDevices.map((device) => device.dailyStats), dailyStats];
}

// Watch time on all devices since the given local date (inclusive).
function secondsSince(firstDay) {
  let seconds = 0;
  for (const stats of allDailyStats()) {
    for (const [key, day] of Object.entries(stats)) {
      if (key >= firstDay) seconds += day.total;
    }
  }
  return seconds;
}

const BADGE_PERIOD_LABELS = { today: "сегодня", week: "за 7 дней" };

function badgeSeconds() {
  return secondsSince(settings.badgePeriod === "week" ? weekStartKey() : dayKey(new Date()));
}

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

  // This device goes last, so its fresher names and avatars win over synced copies.
  for (const stats of allDailyStats()) {
    for (const [key, day] of Object.entries(stats)) {
      if (key < oldestKept) continue;
      weekSeconds += day.total;
      for (const [id, { name, url, avatar, seconds }] of Object.entries(day.channels)) {
        const channel = channels.get(id) ?? { id, name, url, avatar: null, seconds: 0 };
        channel.seconds += seconds;
        channel.name = name;
        if (avatar) channel.avatar = avatar;
        channels.set(id, channel);
      }
    }
  }

  const topChannels = [...channels.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
  return { weekSeconds, topChannels, devices: otherDevices.length + 1 };
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
  const periodSeconds = badgeSeconds();
  const seconds = periodSeconds > 0 ? Math.max(Math.floor(periodSeconds), 1) : 0;
  const onYouTube = isYouTubeUrl(url);
  const showBadge = onYouTube && settings.showBadge;
  const period = BADGE_PERIOD_LABELS[settings.badgePeriod] ?? BADGE_PERIOD_LABELS.today;
  chrome.action.setBadgeText({ tabId, text: showBadge ? formatBadgeTime(seconds, settings.badgeFormat) : "" });
  chrome.action.setTitle({
    tabId,
    title: onYouTube ? `YouTube Media Counter — просмотрено ${period}: ${formatFullTime(seconds)}` : "YouTube Media Counter",
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

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name !== SYNC_ALARM) return;
  watchTotalReady.then(() => {
    // Also refreshes the badge after midnight, when "today" starts over.
    updateBadge();
    return pushToCloud();
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  watchTotalReady.then(async () => {
    if (changes.resetAt?.newValue) {
      const { lastResetAt = 0 } = await chrome.storage.local.get("lastResetAt");
      if (changes.resetAt.newValue > lastResetAt) await clearLocalStats(changes.resetAt.newValue);
    }
    if (changes.settings) settings = await loadSettings();
    if (Object.keys(changes).some(isDeviceKey)) otherDevices = await loadOtherDevices(deviceId);
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
      sendResponse({ watchedSeconds: totalSeconds() });
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
    // Resets every device: the others clear their local stats when they see the new resetAt.
    watchTotalReady
      .then(async () => {
        const resetAt = Date.now();
        await clearLocalStats(resetAt);
        otherDevices = [];
        await removeAllDevices();
        await chrome.storage.sync.set({ resetAt });
        updateBadge();
      })
      .then(() => sendResponse({ watchedSeconds: 0 }));
    return true;
  }
});
