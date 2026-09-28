import { setupI18n } from "../shared/i18n.js";
import { mountPlayer } from "../shared/player-card.js";
import { applyTheme } from "../shared/theme.js";

const params = new URLSearchParams(location.search);
// The YouTube tab reports the real system theme; see content/media-counter.js.
applyTheme({ system: params.get("scheme") });
await setupI18n();

const tabId = Number(params.get("tabId"));
mountPlayer(document.querySelector("#player"), { tabId, showOpenTab: false });
