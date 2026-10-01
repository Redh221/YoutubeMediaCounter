import { formatDuration, setupI18n, t } from "../shared/i18n.js";
import { mountSettings } from "../shared/settings-form.js";
import { focusTab, mountPlayer, sendToTab } from "../shared/player-card.js";
import { applyTheme } from "../shared/theme.js";
import { isYouTubeUrl } from "../shared/youtube.js";

applyTheme();
await setupI18n();

const nowPlaying = document.querySelector("#now-playing");
const watched = document.querySelector("#watched");
const week = document.querySelector("#week");
const channelList = document.querySelector("#channel-list");
const channelsEmpty = document.querySelector("#channels-empty");
const errorBox = document.querySelector("#error");
const devices = document.querySelector("#devices");

function renderDevices(count) {
  devices.hidden = count < 2;
  // Just the number, to keep the watched-time card on one line; the tooltip spells it out.
  devices.textContent = String(count);
  devices.title = t("devicesTitle", { devices: t("devices", { count }) });
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
  return (await sendToTab(tabId, { type: "GET_PLAYING_COUNT" }))?.playing ?? 0;
}

function renderNowPlaying(playing) {
  nowPlaying.dataset.state = playing === null ? "off" : playing > 0 ? "playing" : "idle";
  nowPlaying.textContent =
    playing === null ? t("notYouTube") : playing > 0 ? t("playingCount", { count: playing }) : t("paused");
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onYouTube = tab?.id && isYouTubeUrl(tab.url);

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
    renderDevices(weekStats.value.devices ?? 1);
    renderChannels(weekStats.value.topChannels);
    errorBox.hidden = true;
  } else {
    errorBox.hidden = false;
    errorBox.textContent = t("backgroundError", { reason: weekStats.reason?.message ?? t("emptyResponse") });
  }
  renderNowPlaying(playing.value ?? null);
}

function showView(view) {
  const settingsOpen = view === "settings";
  document.querySelector("#main-view").hidden = settingsOpen;
  document.querySelector("#settings-view").hidden = !settingsOpen;
  document.querySelector(settingsOpen ? "#close-settings" : "#open-settings").focus();
  // Remembered in the URL: switching the language reloads the popup, which should stay in settings.
  history.replaceState(null, "", settingsOpen ? "#settings" : "#");
}

document.querySelector("#open-settings").addEventListener("click", () => showView("settings"));
document.querySelector("#close-settings").addEventListener("click", () => showView("main"));

mountSettings(document.querySelector("#settings"));
if (location.hash === "#settings") showView("settings");
refresh();
setInterval(refresh, 1000);
mountPlayer(document.querySelector("#player"), {
  onOpenTab: () => window.close(),
  // The always-on-top window can only be opened by a click on the YouTube page itself.
  // The prompt is sent first: switching tabs closes the popup and would cut this function short.
  async onPin(tab) {
    await sendToTab(tab.id, { type: "SHOW_PIN_PROMPT" });
    await focusTab(tab);
    window.close();
  },
});
