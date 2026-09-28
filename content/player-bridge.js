// Runs in the page's own world, where YouTube's player API lives (the content script can't reach it).
// The content script sends a command as a DOM event and reads the result back from an attribute:
// dispatchEvent is synchronous, so the answer is there as soon as the call returns.
if (!window.__youtubeMediaCounterBridge) {
  window.__youtubeMediaCounterBridge = true;

  const COMMAND_EVENT = "ymc-player-command";
  const RESULT_ATTRIBUTE = "data-ymc-player";

  function getPlayer() {
    const selector = location.pathname.startsWith("/shorts/") ? "#shorts-player" : "#movie_player";
    const player = document.querySelector(selector);
    return typeof player?.getVolume === "function" ? player : null;
  }

  document.addEventListener(COMMAND_EVENT, (event) => {
    const player = getPlayer();
    if (!player) {
      document.documentElement.removeAttribute(RESULT_ATTRIBUTE);
      return;
    }

    const { action, volume, rate } = JSON.parse(event.detail || "{}");
    if (action === "volume" && Number.isFinite(volume)) {
      player.setVolume(Math.min(Math.max(Math.round(volume), 0), 100));
      if (volume > 0) player.unMute();
      else player.mute();
    } else if (action === "mute") {
      if (player.isMuted()) player.unMute();
      else player.mute();
    } else if (action === "rate" && Number.isFinite(rate)) {
      player.setPlaybackRate(rate);
    }

    document.documentElement.setAttribute(
      RESULT_ATTRIBUTE,
      JSON.stringify({ volume: player.getVolume(), muted: player.isMuted() }),
    );
  });
}
