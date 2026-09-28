import { setupI18n } from "../shared/i18n.js";
import { mountSettings } from "../shared/settings-form.js";
import { applyTheme } from "../shared/theme.js";

applyTheme();
await setupI18n();
mountSettings(document.querySelector("#settings"));
