// A minimal in-memory `chrome` for running the extension's modules under Node.

function createStorageArea() {
  let data = {};
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, key in data ? structuredClone(data[key]) : fallback]),
      );
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const key of [keys].flat()) delete data[key];
    },
    clear() {
      data = {};
    },
  };
}

globalThis.chrome = {
  i18n: { getUILanguage: () => "en-US" },
  storage: { local: createStorageArea(), sync: createStorageArea() },
};

export function resetStorage() {
  chrome.storage.local.clear();
  chrome.storage.sync.clear();
}
