import { mountSettings } from "../shared/settings-form.js";
import { applyTheme } from "../shared/theme.js";

applyTheme();
mountSettings(document.querySelector("#settings"));
