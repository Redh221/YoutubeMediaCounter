import { resetStorage } from "./chrome-stub.js";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { deviceKey, fromSyncItem, isDeviceKey, loadCloudState, removeAllDevices, toSyncItem } from "../background/cloud-sync.js";

const TODAY = "2026-09-30";

function stats(days, { channels = 2, epoch = 0, updated = TODAY } = {}) {
  const dailyStats = {};
  for (const day of days) {
    const entries = Array.from({ length: channels }, (_, i) => [
      `/@channel${i}`,
      { name: `Channel ${i}`, url: `https://www.youtube.com/@channel${i}`, avatar: `https://yt3.ggpht.com/${"a".repeat(80)}${i}`, seconds: 100 + i },
    ]);
    dailyStats[day] = { total: 1000, channels: Object.fromEntries(entries) };
  }
  return { watchedSeconds: 5000, dailyStats, epoch, updated };
}

function item(options = {}) {
  return toSyncItem("x", stats([options.updated ?? TODAY], options)).item;
}

beforeEach(resetStorage);

test("toSyncItem round-trips through fromSyncItem", () => {
  const { key, item } = toSyncItem("abc", stats(["2026-09-29", TODAY]));
  assert.equal(key, "device:abc");
  const back = fromSyncItem(item);
  assert.equal(back.watchedSeconds, 5000);
  assert.deepEqual(back.dailyStats[TODAY].channels["/@channel1"], {
    name: "Channel 1",
    url: "https://www.youtube.com/@channel1",
    avatar: `https://yt3.ggpht.com/${"a".repeat(80)}1`,
    seconds: 101,
  });
});

test("toSyncItem trims channels and avatars to fit the sync item quota", () => {
  const days = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", TODAY];
  const { key, item } = toSyncItem("abc", stats(days, { channels: 40 }));
  assert.ok(new TextEncoder().encode(key + JSON.stringify(item)).length <= 7900);
  assert.equal(item.days[TODAY].t, 1000);
  // The most-watched channels are the ones kept.
  assert.ok("/@channel39" in item.days[TODAY].c);
  assert.ok(!("/@channel0" in item.days[TODAY].c));
});

test("loadCloudState adds up other devices and drops items from before the last reset", async () => {
  await chrome.storage.sync.set({
    resetAt: 100,
    [deviceKey("me")]: item({ epoch: 100 }),
    [deviceKey("fresh")]: item({ epoch: 100 }),
    [deviceKey("old")]: item({ epoch: 50 }),
  });
  const state = await loadCloudState("me", TODAY);
  assert.equal(state.devices.length, 1);
  assert.equal(state.returned, false);
  assert.equal(state.ownMissing, false);
  assert.deepEqual(Object.keys(await chrome.storage.sync.get(null)).sort(), ["device:fresh", "device:me", "resetAt"]);
});

test("loadCloudState retires quiet devices and keeps their totals", async () => {
  await chrome.storage.sync.set({ [deviceKey("quiet")]: item({ updated: "2026-07-01" }) });
  const state = await loadCloudState("me", TODAY);
  assert.equal(state.devices.length, 0);
  assert.equal(state.retiredSeconds, 5000);
  const stored = await chrome.storage.sync.get(null);
  assert.ok(!(deviceKey("quiet") in stored));
  assert.deepEqual(stored.retired, { e: 0, devices: { quiet: 5000 } });
});

test("a retired device that comes back is taken out of the retired totals", async () => {
  await chrome.storage.sync.set({ retired: { e: 0, devices: { me: 5000, other: 300 } } });
  const state = await loadCloudState("me", TODAY);
  assert.equal(state.returned, true);
  assert.equal(state.ownMissing, true);
  assert.equal(state.retiredSeconds, 300);
  assert.deepEqual((await chrome.storage.sync.get("retired")).retired.devices, { other: 300 });
});

test("ownMissing reports this device's item removed by someone else", async () => {
  await chrome.storage.sync.set({ [deviceKey("other")]: item() });
  assert.equal((await loadCloudState("me", TODAY)).ownMissing, true);
  await chrome.storage.sync.set({ [deviceKey("me")]: item() });
  assert.equal((await loadCloudState("me", TODAY)).ownMissing, false);
});

test("retired totals from before the last reset are dropped", async () => {
  await chrome.storage.sync.set({ resetAt: 200, retired: { e: 100, devices: { gone: 9000 } } });
  const state = await loadCloudState("me", TODAY);
  assert.equal(state.retiredSeconds, 0);
  assert.deepEqual((await chrome.storage.sync.get("retired")).retired, { e: 200, devices: {} });
});

test("the legacy retiredDevices map is moved to the new key", async () => {
  await chrome.storage.sync.set({ resetAt: 200, retiredDevices: { gone: 700 } });
  const state = await loadCloudState("me", TODAY);
  assert.equal(state.retiredSeconds, 700);
  const stored = await chrome.storage.sync.get(null);
  assert.ok(!("retiredDevices" in stored));
  assert.deepEqual(stored.retired, { e: 200, devices: { gone: 700 } });
});

test("removeAllDevices leaves settings and resetAt alone", async () => {
  await chrome.storage.sync.set({
    settings: { theme: "dark" },
    resetAt: 1,
    [deviceKey("a")]: item(),
    retired: { e: 1, devices: {} },
    retiredDevices: {},
  });
  await removeAllDevices();
  assert.deepEqual(Object.keys(await chrome.storage.sync.get(null)).sort(), ["resetAt", "settings"]);
  assert.ok(isDeviceKey("retired") && isDeviceKey("retiredDevices") && !isDeviceKey("settings"));
});
