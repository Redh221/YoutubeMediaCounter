globalThis.__youtubeMediaCounterTracker?.stop();

{

  const lastPositions = new WeakMap();
  let pendingWatchedSeconds = 0;

  function getPlayingCount() {
    return [...document.querySelectorAll("video")].filter(
      (video) => !video.paused && !video.ended && video.readyState > HTMLMediaElement.HAVE_CURRENT_DATA,
    ).length;
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
        chrome.runtime.sendMessage({ type: "ADD_WATCH_TIME", seconds: wholeSeconds });
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
