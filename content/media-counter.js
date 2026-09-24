globalThis.__youtubeMediaCounterTracker?.stop();

{

  const lastPositions = new WeakMap();
  let pendingWatchedSeconds = 0;

  function getPlayingCount() {
    return [...document.querySelectorAll("video")].filter(
      (video) => !video.paused && !video.ended && video.readyState > HTMLMediaElement.HAVE_CURRENT_DATA,
    ).length;
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

  function getCurrentChannel() {
    for (const selector of CHANNEL_LINK_SELECTORS) {
      const link = document.querySelector(selector);
      const name = link?.textContent.trim();
      const href = link?.getAttribute("href");
      if (!name || !href) continue;
      const url = new URL(href, location.origin);
      // The channel path (/@handle or /channel/ID) is stable; the display name can change.
      const segments = url.pathname.split("/");
      const id = segments.slice(0, segments[1]?.startsWith("@") ? 2 : 3).join("/");
      return { id, name, url: `${url.origin}${id}`, avatar: getChannelAvatar() };
    }
    return null;
  }

  function saveWatchedTime(video) {
    const previousPosition = lastPositions.get(video);
    lastPositions.set(video, video.currentTime);

    if (
      previousPosition === undefined ||
      video.paused ||
      video.ended ||
      video.seeking ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) return;

    const watchedSeconds = video.currentTime - previousPosition;
    // Large time jumps are most likely seeking, not viewing.
    if (watchedSeconds > 0 && watchedSeconds <= 3) {
      pendingWatchedSeconds += watchedSeconds;
      const wholeSeconds = Math.floor(pendingWatchedSeconds);
      if (wholeSeconds > 0) {
        pendingWatchedSeconds -= wholeSeconds;
        chrome.runtime.sendMessage({ type: "ADD_WATCH_TIME", seconds: wholeSeconds, channel: getCurrentChannel() });
      }
    }
  }

  function trackPlayingVideos() {
    document.querySelectorAll("video").forEach(saveWatchedTime);
  }

  // A one-second timer is more reliable than `timeupdate` on YouTube's custom player.
  trackPlayingVideos();

  const messageListener = (message, _sender, sendResponse) => {
    if (message?.type === "GET_PLAYING_COUNT") {
      sendResponse({ playing: getPlayingCount(), title: document.title });
    }
  };

  chrome.runtime.onMessage.addListener(messageListener);
  const activeIntervalId = setInterval(trackPlayingVideos, 1000);

  globalThis.__youtubeMediaCounterTracker = {
    stop() {
      clearInterval(activeIntervalId);
      chrome.runtime.onMessage.removeListener(messageListener);
    },
  };
}
