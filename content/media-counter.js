globalThis.__youtubeMediaCounterTracker?.stop();

{

  const lastPositions = new WeakMap();
  let pendingWatchedSeconds = 0;

  // Hover previews on feed pages are videos too, but they aren't what the user is watching.
  const PREVIEW_PLAYER_SELECTOR = "ytd-video-preview, #inline-player, #inline-preview-player, #video-preview";
  // The page's own player: regular videos (also the miniplayer) and the active short.
  const MAIN_PLAYER_SELECTOR = "#movie_player, #shorts-player";

  // Ads play in the main player's <video>; the player carries "ad-showing" while they do.
  function isCountable(video) {
    const player = video.closest(MAIN_PLAYER_SELECTOR);
    return Boolean(player) && !player.classList.contains("ad-showing") && !video.closest(PREVIEW_PLAYER_SELECTOR);
  }

  function isPlaying(video) {
    return !video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }

  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  // A page where the channel link belongs to the video being shown.
  function isVideoPage() {
    return location.pathname === "/watch" || isShortsPage();
  }

  function getPlayingCount() {
    return [...document.querySelectorAll("video")].filter((video) => isCountable(video) && isPlaying(video)).length;
  }

  // YouTube renders the channel link in different places for regular videos and Shorts.
  const CHANNEL_LINK_SELECTORS = [
    "ytd-watch-metadata ytd-channel-name a",
    "#owner ytd-channel-name a",
    "ytd-reel-video-renderer[is-active] ytd-channel-name a",
    "ytd-reel-video-renderer[is-active] a[href^='/@']",
    "ytd-shorts yt-reel-channel-bar-view-model a",
  ];

  const CHANNEL_AVATAR_SELECTORS = [
    "ytd-watch-metadata #owner #avatar img",
    "#owner #avatar img",
    "ytd-reel-video-renderer[is-active] #avatar img",
    "ytd-reel-video-renderer[is-active] yt-decorated-avatar-view-model img",
    "ytd-shorts yt-reel-channel-bar-view-model img",
  ];

  function getChannelAvatar() {
    for (const selector of CHANNEL_AVATAR_SELECTORS) {
      // Lazy-loaded avatars start with an empty or data: src, so only accept a real image URL.
      const src = document.querySelector(selector)?.src;
      if (src?.startsWith("https://")) return src;
    }
    return null;
  }

  function channelFromLink(href, name) {
    const url = new URL(href, location.origin);
    // The channel path (/@handle or /channel/ID) is stable; the display name can change.
    const segments = url.pathname.split("/");
    const id = segments.slice(0, segments[1]?.startsWith("@") ? 2 : 3).join("/");
    return { id, name, url: `${location.origin}${id}` };
  }

  // The channel shown on the page. It lags behind for a moment after switching videos and stays in
  // the DOM, hidden, on other pages, so watch time is attributed through getPlayingChannel().
  function getCurrentChannel() {
    for (const selector of CHANNEL_LINK_SELECTORS) {
      const link = document.querySelector(selector);
      const name = link?.textContent.trim();
      const href = link?.getAttribute("href");
      if (!name || !href) continue;
      return { ...channelFromLink(href, name), avatar: getChannelAvatar() };
    }
    return null;
  }

  // The channel of the video the player is playing, from the player's own data (player-bridge.js).
  // The page's channel link only adds the avatar, and only when it shows the same channel.
  function getPlayingChannel() {
    const owner = callPlayerBridge({ action: "get" })?.owner;
    const shown = getCurrentChannel();
    if (owner) {
      const channel = channelFromLink(owner.href, owner.name);
      return { ...channel, avatar: shown?.id === channel.id ? shown.avatar : null };
    }
    // Without the bridge, the page's link is trusted only on a video page, where it belongs to the video.
    return isVideoPage() ? shown : null;
  }

  function getMainVideo() {
    const videos = [...document.querySelectorAll("video")].filter(
      (video) =>
        video.readyState > HTMLMediaElement.HAVE_NOTHING &&
        video.closest(MAIN_PLAYER_SELECTOR) &&
        !video.closest(PREVIEW_PLAYER_SELECTOR),
    );
    return videos.find((video) => !video.paused && !video.ended) ?? videos[0] ?? null;
  }

  function getVideoInfo() {
    const url = new URL(location.href);
    const shortsId = url.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    // Off the watch page (e.g. the miniplayer on the home feed) only the player's own title link knows the video.
    const titleLink = document.querySelector("#movie_player .ytp-title-link");
    let linkedId = null;
    try {
      linkedId = titleLink?.href ? new URL(titleLink.href).searchParams.get("v") : null;
    } catch {}

    const title = isVideoPage()
      ? document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "")
      : titleLink?.textContent.trim();
    const id = url.searchParams.get("v") ?? shortsId ?? linkedId;
    return {
      title: title || "YouTube",
      channel: getCurrentChannel()?.name ?? null,
      thumbnail: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null,
    };
  }

  // Talks to content/player-bridge.js, which runs in the page's world next to YouTube's player API.
  // The answer is cleared first: without the bridge (e.g. between an update and its re-injection) an
  // old answer would otherwise look like a fresh one.
  function callPlayerBridge(command) {
    document.documentElement.removeAttribute("data-ymc-player");
    document.dispatchEvent(new CustomEvent("ymc-player-command", { detail: JSON.stringify(command) }));
    try {
      return JSON.parse(document.documentElement.getAttribute("data-ymc-player"));
    } catch {
      return null;
    }
  }

  // YouTube scales video.volume for loudness normalization, so the player's own value is preferred.
  function getVolumeState(video) {
    const bridged = callPlayerBridge({ action: "get" });
    if (bridged) return { volume: bridged.volume, muted: bridged.muted };
    return { volume: Math.round(video.volume * 100), muted: video.muted };
  }

  // "Next" in the player plays the next suggested (or playlist) video; Shorts scroll to the next short.
  function getNextButton() {
    const button = isShortsPage()
      ? document.querySelector("#navigation-button-down button")
      : document.querySelector("#movie_player .ytp-next-button");
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return null;
    return getComputedStyle(button).display === "none" ? null : button;
  }

  function getPlayerState() {
    const video = getMainVideo();
    if (!video) return { hasVideo: false };
    return {
      hasVideo: true,
      ...getVideoInfo(),
      paused: video.paused || video.ended,
      currentTime: video.currentTime,
      // Live streams report an infinite duration.
      duration: Number.isFinite(video.duration) ? video.duration : null,
      playbackRate: video.playbackRate,
      ...getVolumeState(video),
      hasNext: Boolean(getNextButton()),
    };
  }

  function controlPlayer({ action, time, volume, rate }) {
    const video = getMainVideo();
    if (!video) return;
    if (action === "toggle") {
      if (video.paused || video.ended) video.play().catch(() => {});
      else video.pause();
    } else if (action === "seek" && Number.isFinite(time)) {
      const end = Number.isFinite(video.duration) ? video.duration : time;
      video.currentTime = Math.min(Math.max(time, 0), end);
    } else if (action === "next") {
      getNextButton()?.click();
    } else if (action === "rate" && Number.isFinite(rate)) {
      // Through the player API so YouTube's own speed menu shows the same value.
      if (!callPlayerBridge({ action, rate })) video.playbackRate = rate;
    } else if (action === "volume" && Number.isFinite(volume)) {
      if (!callPlayerBridge({ action, volume })) {
        video.volume = Math.min(Math.max(volume, 0), 100) / 100;
        video.muted = volume === 0;
      }
    } else if (action === "mute") {
      if (!callPlayerBridge({ action })) video.muted = !video.muted;
    }
  }

  // Allowed on top of the expected progress for timer jitter; a bigger jump is a seek.
  const SEEK_TOLERANCE_SECONDS = 1;

  function saveWatchedTime(video) {
    const previous = lastPositions.get(video);
    const now = performance.now();
    lastPositions.set(video, { position: video.currentTime, at: now });
    if (!previous || video.seeking || !isPlaying(video) || !isCountable(video)) return;

    // Expected progress comes from the real time since the last check and the playback speed, so fast
    // playback and throttled background timers aren't mistaken for seeking.
    const advanced = video.currentTime - previous.position;
    const elapsed = (now - previous.at) / 1000;
    if (advanced <= 0 || advanced > elapsed * video.playbackRate + SEEK_TOLERANCE_SECONDS) return;

    // Real time spent watching, not video time: an hour of video at 2x counts as half an hour.
    pendingWatchedSeconds += advanced / video.playbackRate;
    const wholeSeconds = Math.floor(pendingWatchedSeconds);
    if (wholeSeconds > 0) {
      pendingWatchedSeconds -= wholeSeconds;
      chrome.runtime
        .sendMessage({ type: "ADD_WATCH_TIME", seconds: wholeSeconds, channel: getPlayingChannel() })
        .catch(() => {});
    }
  }

  function trackPlayingVideos() {
    document.querySelectorAll("video").forEach(saveWatchedTime);
  }

  // --- Always-on-top mini player (Document Picture-in-Picture) ---
  // Only the page itself can open it, and only right after a click on the page.

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PIN_BUTTON_ID = "ymc-pin-player";
  const PIN_PROMPT_ID = "ymc-pin-prompt";
  const PIN_PROMPT_MS = 15000;
  // Fits the card exactly: 74px card + 4px window padding above and below (see pip/player.html).
  const PIP_SIZE = { width: 295, height: 82 };

  const tabIdReady = chrome.runtime.sendMessage({ type: "GET_TAB_ID" }).catch(() => null);

  // Strings for the button and prompt on the page, in the language chosen in settings.
  const STRING_KEYS = ["pipUnsupported", "pinPlayer", "unpinPlayer", "pinPrompt", "close"];
  let strings = {};
  const text = (key) => strings[key] ?? key;

  async function loadStrings() {
    strings = (await chrome.runtime.sendMessage({ type: "GET_STRINGS", keys: STRING_KEYS }).catch(() => null)) ?? strings;
    updatePinButton();
  }

  const storageListener = (changes, areaName) => {
    if (areaName === "sync" && changes.settings) loadStrings();
  };
  chrome.storage.onChanged.addListener(storageListener);
  loadStrings();
  let pipWindow = null;

  function createPinIcon(size, stroke) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M9 4h6l-1 6 3 3H7l3-3zM12 13v7");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  async function togglePinnedPlayer() {
    if (pipWindow) {
      pipWindow.close();
      return;
    }
    if (!("documentPictureInPicture" in window)) {
      alert(text("pipUnsupported"));
      return;
    }
    const tabId = await tabIdReady;
    if (tabId === null) return;

    try {
      pipWindow = await documentPictureInPicture.requestWindow(PIP_SIZE);
    } catch (error) {
      // E.g. the click's user activation ran out, or the feature is turned off by policy.
      // Another click usually works, so there's nothing to tell the user.
      console.warn("YouTube Media Counter: couldn't open the pinned player", error);
      return;
    }
    const pipDocument = pipWindow.document;
    // A frame's prefers-color-scheme follows the page around it, not the system, so the real system
    // theme is handed to the card and the window gets the same scheme.
    const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    pipDocument.documentElement.style.colorScheme = scheme;
    pipDocument.body.style.cssText = "margin: 0; overflow: hidden;";
    // The card itself is an extension page, so it shares the popup's code and can use the tabs API.
    const frame = pipDocument.createElement("iframe");
    frame.src = chrome.runtime.getURL(`pip/player.html?tabId=${tabId}&scheme=${scheme}`);
    frame.style.cssText = "display: block; width: 100vw; height: 100vh; border: 0;";
    pipDocument.body.append(frame);
    pipWindow.addEventListener("pagehide", () => {
      pipWindow = null;
      updatePinButton();
    });
    updatePinButton();
  }

  function updatePinButton() {
    const button = document.getElementById(PIN_BUTTON_ID);
    if (!button) return;
    const label = pipWindow ? text("unpinPlayer") : text("pinPlayer");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.style.opacity = pipWindow ? "1" : "";
  }

  // YouTube can rebuild its controls, so the button is re-added when it goes missing.
  function ensurePinButton() {
    const controls = document.querySelector("#movie_player .ytp-right-controls");
    if (!controls || document.getElementById(PIN_BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = PIN_BUTTON_ID;
    button.className = "ytp-button";
    button.style.cssText = "display: inline-flex; align-items: center; justify-content: center; vertical-align: top;";
    button.append(createPinIcon(24, "#fff"));
    button.addEventListener("click", togglePinnedPlayer);
    controls.prepend(button);
    updatePinButton();
  }

  function removePinPrompt() {
    document.getElementById(PIN_PROMPT_ID)?.remove();
  }

  // Asked for from the popup, which can't open the window itself.
  function showPinPrompt() {
    removePinPrompt();
    const prompt = document.createElement("div");
    prompt.id = PIN_PROMPT_ID;
    prompt.style.cssText = [
      "position: fixed", "top: 72px", "right: 24px", "z-index: 2147483647",
      "display: flex", "align-items: center", "gap: 4px", "padding: 6px",
      "border-radius: 999px", "background: #e62117", "box-shadow: 0 8px 24px #0006",
      "font: 600 14px/1 Roboto, Arial, sans-serif",
    ].join(";");

    const pin = document.createElement("button");
    pin.type = "button";
    pin.style.cssText =
      "display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: 0; border-radius: 999px; background: transparent; color: #fff; font: inherit; cursor: pointer;";
    pin.append(createPinIcon(18, "#fff"), text("pinPrompt"));
    pin.addEventListener("click", () => {
      removePinPrompt();
      if (!pipWindow) togglePinnedPlayer();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", text("close"));
    close.style.cssText =
      "width: 28px; height: 28px; border: 0; border-radius: 50%; background: #0003; color: #fff; font: 20px/1 Arial, sans-serif; cursor: pointer;";
    close.addEventListener("click", removePinPrompt);

    prompt.append(pin, close);
    document.body.append(prompt);
    setTimeout(() => prompt.remove(), PIN_PROMPT_MS);
    pin.focus();
  }

  function tick() {
    // After the extension is reloaded or updated, this copy keeps running in the tab but can no longer
    // reach the extension (chrome.runtime.id is gone); a fresh copy takes over, so this one stops.
    if (!chrome.runtime?.id) {
      stop();
      return;
    }
    trackPlayingVideos();
    ensurePinButton();
  }

  // A one-second timer is more reliable than `timeupdate` on YouTube's custom player.
  tick();

  const messageListener = (message, _sender, sendResponse) => {
    if (message?.type === "GET_PLAYING_COUNT") {
      sendResponse({ playing: getPlayingCount(), title: document.title });
    } else if (message?.type === "GET_PLAYER_STATE") {
      sendResponse(getPlayerState());
    } else if (message?.type === "PLAYER_CONTROL") {
      controlPlayer(message);
      sendResponse(getPlayerState());
    } else if (message?.type === "SHOW_PIN_PROMPT") {
      showPinPrompt();
      sendResponse(true);
    }
  };

  chrome.runtime.onMessage.addListener(messageListener);
  const activeIntervalId = setInterval(tick, 1000);

  function stop() {
    clearInterval(activeIntervalId);
    document.getElementById(PIN_BUTTON_ID)?.remove();
    removePinPrompt();
    try {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.onChanged.removeListener(storageListener);
    } catch {
      // The extension context is already gone, and its listeners with it.
    }
  }

  globalThis.__youtubeMediaCounterTracker = { stop };
}
