const status = document.querySelector("#status");
const stats = document.querySelector("#stats");
const pageTitle = document.querySelector("#page-title");
const refreshButton = document.querySelector("#refresh");

function formatDuration(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function refreshStats() {
  status.textContent = "Проверяю вкладку…";
  stats.hidden = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("youtube.com")) {
    pageTitle.textContent = "Не страница YouTube";
    status.textContent = "Перейдите на YouTube и обновите данные.";
    return;
  }

  try {
    const [result, total] = await Promise.all([
      getStatsFromTab(tab.id),
      chrome.runtime.sendMessage({ type: "GET_WATCH_TOTAL" }),
    ]);
    document.querySelector("#playing").textContent = result.playing;
    document.querySelector("#watched").textContent = formatDuration(total.watchedSeconds);
    pageTitle.textContent = result.title;
    stats.hidden = false;
    status.textContent = "Данные актуальны.";
  } catch {
    pageTitle.textContent = "Контент-скрипт недоступен";
    status.textContent = "Не удалось получить данные. Перезагрузите вкладку и повторите попытку.";
  }
}

async function getStatsFromTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "GET_PLAYING_COUNT" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/media-counter.js"],
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        playing: [...document.querySelectorAll("video")].filter(
          (video) => !video.paused && !video.ended && video.readyState >= 2,
        ).length,
        title: document.title,
      }),
    });
    return result.result;
  }
}

refreshButton.addEventListener("click", refreshStats);
refreshStats();
setInterval(refreshStats, 1000);
