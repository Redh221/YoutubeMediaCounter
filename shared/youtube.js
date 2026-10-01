// The YouTube pages the extension works on. Keep in sync with "matches" and "host_permissions"
// in manifest.json: other subdomains (music.youtube.com, m.youtube.com) get no content script, so they
// must not count as YouTube anywhere else either. YouTube itself redirects http to https.
export const YOUTUBE_HOSTS = ["www.youtube.com", "youtube.com"];
export const YOUTUBE_TAB_PATTERNS = YOUTUBE_HOSTS.map((host) => `https://${host}/*`);

export function isYouTubeUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && YOUTUBE_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}
