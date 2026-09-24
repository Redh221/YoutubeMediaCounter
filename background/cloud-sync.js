// Cloud sync through chrome.storage.sync (the Google account signed in to Chrome).
// Each device writes only its own item ("device:<id>"), and readers add all devices up,
// so two devices watching at the same time never overwrite each other.

const DEVICE_PREFIX = "device:";
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

export function isDeviceKey(key) {
  return key.startsWith(DEVICE_PREFIX);
}

function itemBytes(key, item) {
  return new TextEncoder().encode(key + JSON.stringify(item)).length;
}

function compactItem(watchedSeconds, dailyStats, channelsPerDay, withAvatars) {
  const item = { total: watchedSeconds, days: {}, meta: {} };
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
export function toSyncItem(deviceId, watchedSeconds, dailyStats) {
  const key = DEVICE_PREFIX + deviceId;
  for (const channelsPerDay of [15, 10, 5, 3]) {
    for (const withAvatars of [true, false]) {
      const item = compactItem(watchedSeconds, dailyStats, channelsPerDay, withAvatars);
      if (itemBytes(key, item) <= MAX_ITEM_BYTES) return { key, item };
    }
  }
  return { key, item: compactItem(watchedSeconds, dailyStats, 0, false) };
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

export async function loadOtherDevices(deviceId) {
  const stored = await chrome.storage.sync.get(null);
  return Object.entries(stored)
    .filter(([key]) => isDeviceKey(key) && key !== DEVICE_PREFIX + deviceId)
    .map(([, item]) => fromSyncItem(item));
}

export async function removeAllDevices() {
  const stored = await chrome.storage.sync.get(null);
  await chrome.storage.sync.remove(Object.keys(stored).filter(isDeviceKey));
}
