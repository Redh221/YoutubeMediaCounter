import "./chrome-stub.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, daysBefore } from "../shared/dates.js";
import { formatDuration, setLanguage, t } from "../shared/i18n.js";
import { formatBadgeTime } from "../shared/settings.js";

test("formatBadgeTime floors and never shows zero for watched time", () => {
  assert.equal(formatBadgeTime(0), "0.0h");
  assert.equal(formatBadgeTime(1), "0.1h");
  assert.equal(formatBadgeTime(5039), "1.3h");
  assert.equal(formatBadgeTime(36000), "10h");
  assert.equal(formatBadgeTime(0, "minutes"), "0m");
  assert.equal(formatBadgeTime(59, "minutes"), "1m");
  assert.equal(formatBadgeTime(4980, "minutes"), "83m");
  assert.equal(formatBadgeTime(60000, "minutes"), "16h");
  assert.equal(formatBadgeTime(1800, "hoursMinutes"), "30m");
  assert.equal(formatBadgeTime(4980, "hoursMinutes"), "1h23");
  assert.equal(formatBadgeTime(3660, "hoursMinutes"), "1h01");
  assert.equal(formatBadgeTime(40000, "hoursMinutes"), "11h");
});

test("formatDuration and plurals", () => {
  setLanguage("en");
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(30), "< 1 min");
  assert.equal(formatDuration(3725), "1 h 2 min");
  assert.equal(t("devices", { count: 1 }), "1 device");
  assert.equal(t("devices", { count: 3 }), "3 devices");
  assert.equal(t("noSuchKey"), "noSuchKey");
});

test("dayKey and daysBefore use the local calendar", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(daysBefore("2026-03-01", 1), "2026-02-28");
  assert.equal(daysBefore("2026-01-03", 6), "2025-12-28");
});
