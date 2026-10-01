# Privacy Policy — YouTube Media Counter

_Last updated: October 1, 2026_

YouTube Media Counter is a Chrome extension that counts how long you watch YouTube and lets you control the YouTube player from the extension's popup or a small always-on-top window. This policy explains what data the extension handles and where it goes.

## What the extension collects

While a video plays in YouTube's main player, the extension records:

- **Watch time**: how many seconds you watched, per calendar day, plus a running total.
- **Channels you watched**: for each day, the channel's name, its YouTube address (for example `/@channelname`), the address of its avatar image, and how long you watched it.

It keeps only the last 7 days of per-day details. It does **not** record the titles or addresses of the videos you watch, your searches, comments, or anything you do on other websites.

It also stores your settings (badge, theme, language) and a random identifier for each browser install, used to tell your devices apart when syncing.

## Where the data is stored

- **On your device**, in Chrome's extension storage (`chrome.storage.local`).
- **In your Google account**, through Chrome Sync (`chrome.storage.sync`), if you are signed in to Chrome with sync turned on. This is how your watch time adds up across your devices. You can turn this off for any device with the "Sync across devices" switch in the extension's settings; that device then stops sharing its data and removes its copy from sync.

The extension has no server of its own. It does not send your data to the developer or to any third party, and it contains no analytics, advertising or tracking code.

To show the player card and channel avatars, the extension loads video thumbnails and avatar images directly from YouTube's image servers (`i.ytimg.com`, `yt3.ggpht.com`), the same images the YouTube page itself shows.

## How the data is used

Only to show you your own statistics: the time on the extension's badge, the totals and the weekly top channels in the popup. The data is not sold, not used for advertising, and not used to determine creditworthiness or for any purpose unrelated to these features.

## Deleting your data

- **Settings → Reset all time** deletes your watch history; with sync on, on all your devices.
- Uninstalling the extension deletes everything it stored on that device.
- Data synced to your Google account can also be cleared from Chrome's sync settings.

## Permissions

- **Access to youtube.com**: to measure watch time and control the player on YouTube pages.
- **storage**: to keep your statistics and settings.
- **alarms**: to sync your statistics to your other devices once a minute.
- **scripting**: to start the extension on YouTube tabs that were already open when it was installed or updated.

## Contact

Questions about this policy: open an issue at https://github.com/Redh221/YoutubeMediaCounter/issues.
