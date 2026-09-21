let watchedSeconds = 0;
const watchTotalReady = chrome.storage.local
  .get({ watchedSeconds: 0 })
  .then((stored) => {
    watchedSeconds = stored.watchedSeconds;
    updateBadge();
  });

function formatBadgeTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#e62117" });
  chrome.action.setBadgeText({ text: formatBadgeTime(Math.floor(watchedSeconds)) });
  chrome.action.setTitle({ title: `YouTube Media Counter — просмотрено: ${formatBadgeTime(Math.floor(watchedSeconds))}` });
}

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
