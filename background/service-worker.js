import { formatDuration, setLanguage, t } from "../shared/i18n.js";
import { formatBadgeTime, loadSettings } from "../shared/settings.js";
import { YOUTUBE_TAB_PATTERNS, isYouTubeUrl } from "../shared/youtube.js";
import { deviceKey, getDeviceId, isDeviceKey, loadCloudState, removeAllDevices, toSyncItem } from "./cloud-sync.js";

const WEEK_DAYS = 7;
// The content script sends whole seconds about once a second; a throttled background tab can
// send up to a minute or so at once. Anything outside this range is not real watch time.
const MAX_SECONDS_PER_MESSAGE = 600;
const INIT_ATTEMPTS = 3;
const SYNC_ALARM = "cloud-sync";
// chrome.storage.sync allows ~120 writes a minute, so this device's stats are pushed once a minute.
const SYNC_PERIOD_MINUTES = 1;

let deviceId;
// This device's stats. Other devices' stats come from the cloud and are only added up for display.
let watchedSeconds = 0;
// Per-day stats keyed by local date ("2026-09-24"): { total, channels: { [channelId]: { name, url, avatar, seconds } } }.
let dailyStats = {};
let otherDevices = [];
// Total of devices retired from sync after going quiet (see cloud-sync.js).
let retiredSeconds = 0;
// The reset (resetAt) this device's stats count from; synced items from older resets are ignored.
let epoch = 0;
// Per device (chrome.storage.local): with sync off this device neither shares its stats nor sees others'.
let syncEnabled = true;
let lastPushed = "";
let settings;

// Everything waits for init(). If it fails (e.g. storage errors), it is retried a few times, and the
// next event tries again instead of leaving the worker broken until the browser restarts.
let initPromise = null;

function ready() {
  initPromise ??= initWithRetry().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

async function initWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await init();
    } catch (error) {
      console.error(`YouTube Media Counter: start-up failed (attempt ${attempt})`, error);
      if (attempt >= INIT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

ready().catch(() => {});

async function init() {
  const [id, stored, loadedSettings, { resetAt = 0 }] = await Promise.all([
    getDeviceId(),
    chrome.storage.local.get({ watchedSeconds: 0, dailyStats: {}, lastResetAt: 0, syncEnabled: true }),
    loadSettings(),
    chrome.storage.sync.get("resetAt"),
  ]);
  deviceId = id;
  settings = loadedSettings;
  setLanguage(settings.language);
  watchedSeconds = stored.watchedSeconds;
  dailyStats = stored.dailyStats;
  syncEnabled = stored.syncEnabled;
  epoch = stored.lastResetAt;
  if (syncEnabled) {
    // Another device reset the counter while this one was offline.
    if (resetAt > stored.lastResetAt) await clearLocalStats(resetAt);
    await refreshCloud();
  }
  updateBadge();

  if (!(await chrome.alarms.get(SYNC_ALARM))) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

async function clearLocalStats(resetAt) {
  watchedSeconds = 0;
  dailyStats = {};
  epoch = resetAt;
  lastPushed = "";
  await chrome.storage.local.set({ watchedSeconds, dailyStats, lastResetAt: resetAt });
}

async function refreshCloud() {
  const state = await loadCloudState(deviceId, dayKey(new Date()));
  otherDevices = state.devices;
  retiredSeconds = state.retiredSeconds;
  // Other devices retired this one while it was away; its own item has to come back.
  if (state.returned) {
    lastPushed = "";
    await pushToCloud();
  }
}

async function pushToCloud() {
  if (!syncEnabled) return;
  const { key, item } = toSyncItem(deviceId, { watchedSeconds, dailyStats, epoch, updated: dayKey(new Date()) });
  const json = JSON.stringify(item);
  if (json === lastPushed) return;
  await chrome.storage.sync.set({ [key]: item });
  lastPushed = json;
}

async function setSyncEnabled(enabled) {
  if (enabled === syncEnabled) return;
  syncEnabled = enabled;
  lastPushed = "";
  await chrome.storage.local.set({ syncEnabled });

  if (enabled) {
    // A reset made elsewhere while this device was out of sync must not wipe what it counted meanwhile.
    const [{ resetAt = 0 }, { lastResetAt = 0 }] = await Promise.all([
      chrome.storage.sync.get("resetAt"),
      chrome.storage.local.get("lastResetAt"),
    ]);
    epoch = Math.max(resetAt, lastResetAt);
    await chrome.storage.local.set({ lastResetAt: epoch });
    await pushToCloud();
    await refreshCloud();
  } else {
    // Other devices stop counting this one, and this one stops counting them.
    otherDevices = [];
    retiredSeconds = 0;
    await chrome.storage.sync.remove(deviceKey(deviceId));
  }
  updateBadge();
}

function totalSeconds() {
  return otherDevices.reduce((sum, device) => sum + device.watchedSeconds, watchedSeconds + retiredSeconds);
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

// What each tab's badge and title were last set to. Watch time arrives every second while the badge
// text only changes about once a minute, so the action API is called only when something changed.
const shownBadges = new Map();
let shownBadgeColor = null;

// The global badge stays empty; YouTube tabs get a tab-specific badge, so it only shows on YouTube.
function updateTabBadge(tabId, url, seconds = badgeSeconds()) {
  const onYouTube = isYouTubeUrl(url);
  const text = onYouTube && settings.showBadge ? formatBadgeTime(seconds, settings.badgeFormat) : "";
  const title = onYouTube
    ? t(settings.badgePeriod === "week" ? "badgeTitleWeek" : "badgeTitleToday", { time: formatDuration(seconds) })
    : "YouTube Media Counter";
  const shown = `${text}\n${title}`;
  if (shownBadges.get(tabId) === shown) return;
  shownBadges.set(tabId, shown);
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title });
}

// Only YouTube tabs carry a badge; other tabs are handled when they navigate (tabs.onUpdated).
async function updateBadge() {
  if (shownBadgeColor !== settings.badgeColor) {
    shownBadgeColor = settings.badgeColor;
    chrome.action.setBadgeBackgroundColor({ color: settings.badgeColor });
  }
  const seconds = badgeSeconds();
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TAB_PATTERNS });
  for (const tab of tabs) {
    updateTabBadge(tab.id, tab.url, seconds);
  }
}

chrome.action.setBadgeText({ text: "" });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    ready().then(() => updateTabBadge(tabId, tab.url));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => shownBadges.delete(tabId));

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name !== SYNC_ALARM) return;
  ready().then(() => {
    // Also refreshes the badge after midnight, when "today" starts over.
    updateBadge();
    return pushToCloud();
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  ready().then(async () => {
    // Settings follow the Google account either way; the sync switch only covers the stats.
    if (changes.settings) {
      settings = await loadSettings();
      setLanguage(settings.language);
    }
    if (syncEnabled) {
      if (changes.resetAt?.newValue) {
        const { lastResetAt = 0 } = await chrome.storage.local.get("lastResetAt");
        if (changes.resetAt.newValue > lastResetAt) await clearLocalStats(changes.resetAt.newValue);
      }
      if (Object.keys(changes).some(isDeviceKey)) await refreshCloud();
    }
    updateBadge();
  });
});

// Manifest content scripts only start with pages loaded from now on, so YouTube tabs that are
// already open get them on install and update (an update also cuts off the old copies there).
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { INSTALL, UPDATE } = chrome.runtime.OnInstalledReason;
  if (reason !== INSTALL && reason !== UPDATE) return;
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TAB_PATTERNS });
  for (const { id: tabId, discarded } of tabs) {
    if (discarded) continue;
    chrome.scripting
      .executeScript({ target: { tabId }, files: ["content/player-bridge.js"], world: "MAIN" })
      .catch(() => {});
    chrome.scripting.executeScript({ target: { tabId }, files: ["content/media-counter.js"] }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content scripts can't see their own tab ID; the pinned player needs it to address the tab.
  if (message?.type === "GET_TAB_ID") {
    sendResponse(sender.tab?.id ?? null);
    return;
  }

  // Content scripts can't import the translations, so they ask for the strings they need.
  if (message?.type === "GET_STRINGS" && Array.isArray(message.keys)) {
    // Settings are re-read here: the tab asks right after a language change, possibly before this
    // worker's own storage listener has caught up.
    loadSettings().then(({ language }) => {
      setLanguage(language);
      sendResponse(Object.fromEntries(message.keys.map((key) => [key, t(key)])));
    });
    return true;
  }

  // A failed start-up answers null, which the popup shows as an error.
  if (message?.type === "GET_WATCH_TOTAL") {
    ready().then(
      () => sendResponse({ watchedSeconds: totalSeconds() }),
      () => sendResponse(null),
    );
    return true;
  }

  if (message?.type === "GET_WEEK_STATS") {
    ready().then(
      () => sendResponse(getWeekStats()),
      () => sendResponse(null),
    );
    return true;
  }

  if (message?.type === "ADD_WATCH_TIME") {
    const { seconds, channel } = message;
    // Only YouTube tabs report watch time, in whole seconds.
    if (!isYouTubeUrl(sender.tab?.url) || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS_PER_MESSAGE) {
      return;
    }
    const validChannel = typeof channel?.id === "string" && typeof channel.name === "string" ? channel : null;
    ready().then(() => {
      watchedSeconds += seconds;
      addDailyTime(seconds, validChannel);
      updateBadge();
      return chrome.storage.local.set({ watchedSeconds, dailyStats });
    });
  }

  if (message?.type === "SET_SYNC_ENABLED") {
    ready()
      .then(() => setSyncEnabled(Boolean(message.enabled)))
      .then(() => sendResponse({ syncEnabled }));
    return true;
  }

  if (message?.type === "RESET_WATCH_TOTAL") {
    // With sync on, resets every device: the others clear their local stats when they see the new
    // resetAt. resetAt is written first, so anything a device pushes meanwhile carries an older epoch
    // and is ignored. With sync off, only this device's stats are cleared.
    ready()
      .then(async () => {
        const resetAt = Date.now();
        await clearLocalStats(resetAt);
        if (syncEnabled) {
          otherDevices = [];
          retiredSeconds = 0;
          await chrome.storage.sync.set({ resetAt });
          await removeAllDevices();
        }
        updateBadge();
      })
      .then(() => sendResponse({ watchedSeconds: 0 }));
    return true;
  }
});
