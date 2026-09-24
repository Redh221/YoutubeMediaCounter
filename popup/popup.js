import { mountSettings } from "../shared/settings-form.js";
import { applyTheme } from "../shared/theme.js";

applyTheme();

const nowPlaying = document.querySelector("#now-playing");
const watched = document.querySelector("#watched");
const week = document.querySelector("#week");
const channelList = document.querySelector("#channel-list");
const channelsEmpty = document.querySelector("#channels-empty");
const errorBox = document.querySelector("#error");

function formatDuration(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (totalMinutes > 0) return `${minutes} мин`;
  return seconds > 0 ? "< 1 мин" : "0 мин";
}

function createAvatar(name, avatar) {
  const wrapper = document.createElement("span");
  wrapper.className = "channel-avatar";
  const showInitial = () => {
    wrapper.textContent = [...name.trim()][0]?.toUpperCase() ?? "?";
  };

  if (avatar) {
    const image = document.createElement("img");
    image.src = avatar;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", showInitial, { once: true });
    wrapper.append(image);
  } else {
    showInitial();
  }
  return wrapper;
}

let renderedChannels = "";

function renderChannels(channels) {
  // The popup refreshes every second; rebuilding unchanged rows would reload the avatars.
  const channelsKey = JSON.stringify(channels);
  if (channelsKey === renderedChannels) return;
  renderedChannels = channelsKey;

  channelsEmpty.hidden = channels.length > 0;
  const maxSeconds = channels[0]?.seconds ?? 1;

  channelList.replaceChildren(
    ...channels.map(({ name, url, avatar, seconds }) => {
      const item = document.createElement("li");
      item.className = "channel";
      item.style.setProperty("--share", `${(seconds / maxSeconds) * 100}%`);

      const link = document.createElement("a");
      link.className = "channel-name";
      link.href = url;
      link.textContent = name;
      link.title = name;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        chrome.tabs.create({ url });
      });

      const time = document.createElement("span");
      time.className = "channel-time";
      time.textContent = formatDuration(seconds);

      item.append(createAvatar(name, avatar), link, time);
      return item;
    }),
  );
}

async function getPlayingCount(tabId) {
  try {
    const { playing } = await chrome.tabs.sendMessage(tabId, { type: "GET_PLAYING_COUNT" });
    return playing;
  } catch {
    // The content script isn't there yet (e.g. the tab was open before the extension loaded).
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/media-counter.js"] });
    return 0;
  }
}

function renderNowPlaying(playing) {
  nowPlaying.dataset.state = playing === null ? "off" : playing > 0 ? "playing" : "idle";
  nowPlaying.textContent =
    playing === null ? "Не YouTube" : playing > 0 ? `Играет: ${playing}` : "На паузе";
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onYouTube = tab?.id && /^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab.url ?? "");

  // Each part renders on its own so one failing request doesn't blank the whole popup.
  const [total, weekStats, playing] = await Promise.allSettled([
    chrome.runtime.sendMessage({ type: "GET_WATCH_TOTAL" }),
    chrome.runtime.sendMessage({ type: "GET_WEEK_STATS" }),
    onYouTube ? getPlayingCount(tab.id).catch(() => 0) : null,
  ]);

  if (total.status === "fulfilled" && total.value) {
    watched.textContent = formatDuration(total.value.watchedSeconds);
  }
  if (weekStats.status === "fulfilled" && weekStats.value) {
    week.textContent = formatDuration(weekStats.value.weekSeconds);
    renderChannels(weekStats.value.topChannels);
    errorBox.hidden = true;
  } else {
    errorBox.hidden = false;
    errorBox.textContent = `Фоновый скрипт не ответил: ${weekStats.reason?.message ?? "пустой ответ"}. Перезагрузите расширение на chrome://extensions.`;
  }
  renderNowPlaying(playing.value ?? null);
}

function showView(view) {
  const settingsOpen = view === "settings";
  document.querySelector("#main-view").hidden = settingsOpen;
  document.querySelector("#settings-view").hidden = !settingsOpen;
  document.querySelector(settingsOpen ? "#close-settings" : "#open-settings").focus();
}

document.querySelector("#open-settings").addEventListener("click", () => showView("settings"));
document.querySelector("#close-settings").addEventListener("click", () => showView("main"));

mountSettings(document.querySelector("#settings"));
refresh();
setInterval(refresh, 1000);
