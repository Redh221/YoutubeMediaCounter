let watchedSeconds = 0;
const watchTotalReady = chrome.storage.local
  .get({ watchedSeconds: 0 })
  .then((stored) => {
    watchedSeconds = stored.watchedSeconds;
    updateBadge();
  });

function formatBadgeTime(seconds) {
  const hours = seconds / 3600;
  // One decimal below 10h (floored so the badge never runs ahead), whole hours above to fit the badge.
  // Any watched time shows at least 0.1h so the counter never looks empty.
  if (hours < 10) return `${Math.max(Math.floor(hours * 10) / 10, seconds > 0 ? 0.1 : 0).toFixed(1)}h`;
  return `${Math.floor(hours)}h`;
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
  chrome.action.setBadgeText({ tabId, text: onYouTube ? formatBadgeTime(seconds) : "" });
  chrome.action.setTitle({
    tabId,
    title: onYouTube ? `YouTube Media Counter — просмотрено: ${formatFullTime(seconds)}` : "YouTube Media Counter",
  });
}

async function updateBadge() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    updateTabBadge(tab.id, tab.url);
  }
}

chrome.action.setBadgeBackgroundColor({ color: "#e62117" });
chrome.action.setBadgeText({ text: "" });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    watchTotalReady.then(() => updateTabBadge(tabId, tab.url));
  }
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

  if (message?.type === "ADD_WATCH_TIME" && Number.isFinite(message.seconds)) {
    watchTotalReady.then(() => {
      watchedSeconds += message.seconds;
      updateBadge();
      return chrome.storage.local.set({ watchedSeconds });
    });
  }
});
