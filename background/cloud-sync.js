// Cloud sync through chrome.storage.sync (the Google account signed in to Chrome).
// Each device writes only its own item ("device:<id>"), and readers add all devices up,
// so two devices watching at the same time never overwrite each other.

const DEVICE_PREFIX = "device:";
// Totals of devices that went quiet, keyed by device ID: { [deviceId]: watchedSeconds }.
const RETIRED_KEY = "retiredDevices";
// A device that hasn't written for this long (e.g. a reinstalled extension got a new ID) is retired:
// its total moves into RETIRED_KEY and its item is removed, so dead items don't eat the sync quota.
const STALE_DAYS = 30;
// chrome.storage.sync allows 8192 bytes per item (key included); leave some headroom.
const MAX_ITEM_BYTES = 7900;
const YOUTUBE_ORIGIN = "https://www.youtube.com";

export async function getDeviceId() {
  const { deviceId } = await chrome.storage.local.get("deviceId");
  if (deviceId) return deviceId;
  const newId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: newId });
  return newId;
}

export function deviceKey(deviceId) {
  return DEVICE_PREFIX + deviceId;
}

export function isDeviceKey(key) {
  return key.startsWith(DEVICE_PREFIX) || key === RETIRED_KEY;
}

function itemBytes(key, item) {
  return new TextEncoder().encode(key + JSON.stringify(item)).length;
}

// `epoch` is the reset (resetAt) the stats count from; `updated` is today's date key, so an item
// changes at least once a day and stays fresh while its device is in use.
function compactItem({ watchedSeconds, dailyStats, epoch, updated }, channelsPerDay, withAvatars) {
  const item = { total: watchedSeconds, e: epoch, u: updated, days: {}, meta: {} };
  for (const [day, { total, channels }] of Object.entries(dailyStats)) {
    const top = Object.entries(channels)
      .sort(([, a], [, b]) => b.seconds - a.seconds)
      .slice(0, channelsPerDay);
    item.days[day] = { t: total, c: Object.fromEntries(top.map(([id, { seconds }]) => [id, seconds])) };
    for (const [id, { name, avatar }] of top) {
      item.meta[id] = withAvatars && avatar ? [name, avatar] : [name];
    }
  }
  return item;
}

// Stores a device's stats in a compact form, trimming the least-watched channels
// (and then avatars) until it fits the per-item quota.
export function toSyncItem(deviceId, stats) {
  const key = deviceKey(deviceId);
  for (const channelsPerDay of [15, 10, 5, 3]) {
    for (const withAvatars of [true, false]) {
      const item = compactItem(stats, channelsPerDay, withAvatars);
      if (itemBytes(key, item) <= MAX_ITEM_BYTES) return { key, item };
    }
  }
  return { key, item: compactItem(stats, 0, false) };
}

// Expands a synced item back into the local { watchedSeconds, dailyStats } shape.
export function fromSyncItem(item) {
  const dailyStats = {};
  for (const [day, { t, c }] of Object.entries(item?.days ?? {})) {
    dailyStats[day] = {
      total: t,
      channels: Object.fromEntries(
        Object.entries(c).map(([id, seconds]) => {
          const [name, avatar] = item.meta?.[id] ?? [id.replace(/^\//, "")];
          return [id, { name, url: YOUTUBE_ORIGIN + id, avatar, seconds }];
        }),
      ),
    };
  }
  return { watchedSeconds: item?.total ?? 0, dailyStats };
}

// The latest day an item shows activity on. Items written before `u` existed fall back to their days.
function lastActiveDay(item) {
  return [item.u ?? "", ...Object.keys(item.days ?? {})].sort().at(-1);
}

function staleBefore(today) {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() - STALE_DAYS);
  return date.toLocaleDateString("sv");
}

/**
 * Reads the other devices' stats, and tidies the shared storage on the way:
 * - items from before the last reset (an older `e`) are dropped, so a reset can't be undone by a
 *   device that pushes old data around the same time;
 * - devices quiet for STALE_DAYS are retired (their total is kept in RETIRED_KEY);
 * - if this device was retired while it was away, it is taken back out of RETIRED_KEY
 *   (`returned: true`), since it is about to push its full total again.
 */
export async function loadCloudState(deviceId, today) {
  const stored = await chrome.storage.sync.get(null);
  const resetAt = stored.resetAt ?? 0;
  const retired = { ...stored[RETIRED_KEY] };
  const ownKey = deviceKey(deviceId);
  const cutoff = staleBefore(today);
  const devices = [];
  const toRemove = [];
  let retiredChanged = false;

  for (const [key, item] of Object.entries(stored)) {
    if (!key.startsWith(DEVICE_PREFIX) || key === ownKey) continue;
    if ((item.e ?? 0) < resetAt) {
      toRemove.push(key);
    } else if (lastActiveDay(item) < cutoff) {
      retired[key.slice(DEVICE_PREFIX.length)] = item.total ?? 0;
      retiredChanged = true;
      toRemove.push(key);
    } else {
      devices.push(fromSyncItem(item));
    }
  }

  const returned = deviceId in retired;
  if (returned) {
    delete retired[deviceId];
    retiredChanged = true;
  }
  if (retiredChanged) await chrome.storage.sync.set({ [RETIRED_KEY]: retired });
  if (toRemove.length > 0) await chrome.storage.sync.remove(toRemove);

  const retiredSeconds = Object.values(retired).reduce((sum, seconds) => sum + seconds, 0);
  return { devices, retiredSeconds, returned };
}

export async function removeAllDevices() {
  const stored = await chrome.storage.sync.get(null);
  await chrome.storage.sync.remove(Object.keys(stored).filter(isDeviceKey));
}
