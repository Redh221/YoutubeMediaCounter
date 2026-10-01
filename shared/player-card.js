import { t } from "./i18n.js";
import { YOUTUBE_TAB_PATTERNS } from "./youtube.js";

// Media card that controls a YouTube tab's player through the content script.
// Used in the popup and in the always-on-top Picture-in-Picture window.

const REFRESH_MS = 1000;
const WHEEL_VOLUME_STEP = 5;
// Speeds YouTube offers; the speed button moves one step up or down this list.
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// How long after the last wheel tick the tab's reported volume may overwrite the slider again.
const WHEEL_SETTLE_MS = 400;

// Built on mount, after the interface language is known.
const template = () => `
  <div class="player-head">
    <span class="player-thumb"><img data-ref="thumb" alt="" referrerpolicy="no-referrer" /></span>
    <div class="player-info">
      <strong data-ref="title" class="player-title"></strong>
      <span data-ref="channel" class="player-channel"></span>
    </div>
    <div class="player-actions">
      <button data-ref="pin" class="icon-button" type="button" aria-label="${t("pinOnTop")}" title="${t("pinOnTop")}" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>
      </button>
      <button data-ref="open" class="icon-button" type="button" aria-label="${t("openTab")}" title="${t("openTab")}">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
      </button>
    </div>
  </div>
  <div class="player-progress">
    <button data-ref="toggle" class="player-button player-toggle" type="button" aria-label="${t("play")}" title="${t("play")}">
      <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>
      <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>
    </button>
    <div data-ref="volumeArea" class="player-volume">
      <button data-ref="mute" class="player-button player-mute" type="button" aria-label="${t("mute")}" title="${t("mute")}">
        <svg class="icon-sound" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>
        <svg class="icon-muted" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>
      </button>
      <input data-ref="volume" class="player-seek player-volume-slider" type="range" min="0" max="100" step="1" value="100" aria-label="${t("volume")}" />
    </div>
    <span data-ref="current" class="player-time">0:00</span>
    <input data-ref="seek" class="player-seek" type="range" min="0" max="0" step="any" value="0" aria-label="${t("position")}" />
    <span data-ref="duration" class="player-time">0:00</span>
    <button data-ref="next" class="player-button" type="button" aria-label="${t("nextVideo")}" title="${t("nextVideo")}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.3v11.4a1 1 0 0 0 1.5.8l8.6-5.7a1 1 0 0 0 0-1.6L6.5 5.5A1 1 0 0 0 5 6.3z" fill="currentColor"/><rect x="16.5" y="5" width="2.5" height="14" rx="1" fill="currentColor"/></svg>
    </button>
    <button data-ref="rate" class="player-rate" type="button" aria-label="${t("speed")}" title="${t("speedHint")}">1×</button>
  </div>
`;

// When each tab last got the content scripts injected by sendToTab().
const injectedAt = new Map();
const REINJECT_AFTER_MS = 10000;

export async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The content script isn't there yet (e.g. a tab that couldn't be injected on install). A tab
    // that still doesn't answer isn't injected again on every call.
    if (Date.now() - (injectedAt.get(tabId) ?? 0) < REINJECT_AFTER_MS) return null;
    injectedAt.set(tabId, Date.now());
    await Promise.all([
      chrome.scripting.executeScript({ target: { tabId }, files: ["content/media-counter.js"] }),
      chrome.scripting.executeScript({ target: { tabId }, files: ["content/player-bridge.js"], world: "MAIN" }),
    ]).catch(() => {});
    return null;
  }
}

export async function focusTab({ id, windowId }) {
  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabs.update(id, { active: true });
}

function formatClock(seconds) {
  const total = Math.max(Math.floor(seconds), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

// Prefer the tab already on screen, then one that is playing, then the active tab, then the latest used.
function pickPlayerTab(candidates, shownTabId, currentWindowId) {
  const score = ({ tab, state }) => [
    tab.id === shownTabId ? 1 : 0,
    state.paused ? 0 : 1,
    tab.active && tab.windowId === currentWindowId ? 1 : 0,
    tab.lastAccessed ?? 0,
  ];
  const compare = (a, b) => {
    const [scoreA, scoreB] = [score(a), score(b)];
    const index = scoreA.findIndex((value, i) => value !== scoreB[i]);
    return index === -1 ? 0 : scoreB[index] - scoreA[index];
  };
  return candidates.sort(compare)[0] ?? null;
}

/**
 * Renders the card into `root` and keeps it in sync.
 * `tabId` pins the card to one tab; without it the card picks the best YouTube tab itself.
 * `onPin(tab)` shows the pin button; `onOpenTab(tab)` runs after the tab gets focus.
 * `showOpenTab: false` hides the open-tab button (the pinned window has Chrome's own "back to tab").
 */
export function mountPlayer(root, { tabId = null, onPin = null, onOpenTab = null, showOpenTab = true } = {}) {
  root.classList.add("player");
  root.hidden = true;
  root.innerHTML = template();
  const refs = Object.fromEntries([...root.querySelectorAll("[data-ref]")].map((el) => [el.dataset.ref, el]));
  refs.pin.hidden = !onPin;
  refs.open.hidden = !showOpenTab;

  // The shown player: its tab, the last state the tab reported, and when it arrived (for smooth progress).
  let player = null;
  let seekDragging = false;
  let volumeDragging = false;
  // State requests started before the last command may carry the old paused/position values.
  let lastControlAt = 0;

  function playerTime() {
    const { state, receivedAt } = player;
    if (state.paused) return state.currentTime;
    const time = state.currentTime + ((performance.now() - receivedAt) / 1000) * state.playbackRate;
    return state.duration === null ? time : Math.min(time, state.duration);
  }

  function setPlayerState(tab, state) {
    player = state?.hasVideo ? { tab, state, receivedAt: performance.now() } : null;
    render();
  }

  function render() {
    root.hidden = !player;
    if (!player) return;
    const { state } = player;

    if (refs.title.textContent !== state.title) {
      refs.title.textContent = state.title;
      refs.title.title = state.title;
    }
    refs.channel.textContent = state.channel ?? "YouTube";
    refs.thumb.hidden = !state.thumbnail;
    if (state.thumbnail && refs.thumb.getAttribute("src") !== state.thumbnail) refs.thumb.src = state.thumbnail;

    root.dataset.state = state.paused ? "paused" : "playing";
    const toggleLabel = state.paused ? t("play") : t("pause");
    refs.toggle.setAttribute("aria-label", toggleLabel);
    refs.toggle.title = toggleLabel;

    const live = state.duration === null;
    root.classList.toggle("is-live", live);
    refs.duration.textContent = live ? "LIVE" : formatClock(state.duration);
    refs.seek.disabled = live;
    refs.seek.max = live ? 0 : state.duration;
    refs.next.disabled = !state.hasNext;
    refs.rate.textContent = `${state.playbackRate}×`;
    refs.rate.classList.toggle("is-changed", state.playbackRate !== 1);
    renderVolume();
    renderProgress();
  }

  function renderVolume() {
    const { volume, muted } = player.state;
    const shown = muted ? 0 : volume;
    root.dataset.muted = String(muted || volume === 0);
    const muteLabel = muted || volume === 0 ? t("unmute") : t("mute");
    refs.mute.setAttribute("aria-label", muteLabel);
    refs.mute.title = muteLabel;
    if (volumeDragging) return;
    refs.volume.value = shown;
    refs.volume.style.setProperty("--progress", `${shown}%`);
  }

  function renderProgress() {
    if (!player || seekDragging) return;
    const time = playerTime();
    refs.current.textContent = formatClock(time);
    if (player.state.duration !== null) {
      refs.seek.value = time;
      refs.seek.style.setProperty("--progress", `${(time / (player.state.duration || 1)) * 100}%`);
    }
  }

  function animateProgress() {
    renderProgress();
    requestAnimationFrame(animateProgress);
  }

  async function findTab() {
    if (tabId !== null) {
      const tab = await chrome.tabs.get(tabId);
      return { tab, state: await sendToTab(tab.id, { type: "GET_PLAYER_STATE" }) };
    }

    const [tabs, currentWindow] = await Promise.all([
      chrome.tabs.query({ url: YOUTUBE_TAB_PATTERNS }),
      chrome.windows.getCurrent(),
    ]);
    const results = await Promise.all(
      tabs
        .filter((tab) => !tab.discarded)
        .map(async (tab) => ({ tab, state: await sendToTab(tab.id, { type: "GET_PLAYER_STATE" }) })),
    );
    return pickPlayerTab(
      results.filter(({ state }) => state?.hasVideo),
      player?.tab.id,
      currentWindow.id,
    );
  }

  async function refresh() {
    const startedAt = performance.now();
    const found = await findTab().catch(() => null);
    if (startedAt < lastControlAt) return;
    setPlayerState(found?.tab, found?.state);
  }

  async function control(command) {
    if (!player) return;
    lastControlAt = performance.now();
    const state = await sendToTab(player.tab.id, { type: "PLAYER_CONTROL", ...command });
    if (state?.hasVideo) setPlayerState(player.tab, state);
  }

  refs.toggle.addEventListener("click", () => control({ action: "toggle" }));

  refs.mute.addEventListener("click", () => control({ action: "mute" }));
  refs.next.addEventListener("click", () => control({ action: "next" }));

  function stepRate(direction) {
    if (!player) return;
    const current = player.state.playbackRate;
    const rate =
      direction > 0
        ? PLAYBACK_RATES.find((value) => value > current)
        : PLAYBACK_RATES.findLast((value) => value < current);
    if (rate !== undefined) control({ action: "rate", rate });
  }
  // Left click speeds up, right click slows down, the wheel does either.
  refs.rate.addEventListener("click", () => stepRate(1));
  refs.rate.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    stepRate(-1);
  });
  refs.rate.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      stepRate(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  // Dragging fires many input events; only one volume command is in flight, and the latest value wins.
  let volumeInFlight = false;
  let pendingVolume = null;
  async function sendVolume() {
    if (volumeInFlight || pendingVolume === null) return;
    volumeInFlight = true;
    const volume = pendingVolume;
    pendingVolume = null;
    await control({ action: "volume", volume });
    volumeInFlight = false;
    sendVolume();
  }
  function setVolume(volume) {
    pendingVolume = volume;
    refs.volume.style.setProperty("--progress", `${volume}%`);
    sendVolume();
  }
  refs.volume.addEventListener("input", () => {
    volumeDragging = true;
    setVolume(refs.volume.valueAsNumber);
  });

  let wheelTimer = null;
  refs.volumeArea.addEventListener(
    "wheel",
    (event) => {
      if (!player || event.deltaY === 0) return;
      event.preventDefault();
      volumeDragging = true;
      const step = event.deltaY < 0 ? WHEEL_VOLUME_STEP : -WHEEL_VOLUME_STEP;
      refs.volume.value = Math.min(Math.max(refs.volume.valueAsNumber + step, 0), 100);
      setVolume(refs.volume.valueAsNumber);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        volumeDragging = false;
      }, WHEEL_SETTLE_MS);
    },
    { passive: false },
  );
  refs.volume.addEventListener("change", () => {
    volumeDragging = false;
  });

  refs.seek.addEventListener("input", () => {
    seekDragging = true;
    refs.current.textContent = formatClock(refs.seek.valueAsNumber);
    refs.seek.style.setProperty("--progress", `${(refs.seek.valueAsNumber / (refs.seek.max || 1)) * 100}%`);
  });
  refs.seek.addEventListener("change", async () => {
    await control({ action: "seek", time: refs.seek.valueAsNumber });
    seekDragging = false;
    renderProgress();
  });

  refs.open.addEventListener("click", async () => {
    if (!player) return;
    await focusTab(player.tab);
    onOpenTab?.(player.tab);
  });
  refs.pin.addEventListener("click", () => player && onPin(player.tab));

  refresh();
  setInterval(refresh, REFRESH_MS);
  requestAnimationFrame(animateProgress);
}
