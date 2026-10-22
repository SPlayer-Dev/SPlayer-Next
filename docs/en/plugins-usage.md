# Using Plugins

Plugins can add independent catalogs, resolve playback URLs, provide lyrics and covers, or react to playback. This page explains installation and management. Authors should start with [Plugin Development](/en/plugins/development).

## Opening plugin management

Open **Settings → Plugin Management**. Each installed plugin card shows its name, version, author, runtime state, and supported sources.

## Installing a plugin

- **Plugin market:** Choose a plugin in the market and select Install.
- **Local import:** Select a `.js` file.
- **Import from URL:** Paste an HTTPS URL to a `.js` file, such as a GitHub or Gitee raw URL.

For LX and compressed script support, see [LX Compatibility](/en/plugins/lx).

## Enable, disable, and uninstall

- Newly installed plugins are enabled automatically.
- Multiple plugins may be enabled at once. Built-in source resolution follows plugin priority; tracks from independent catalogs use their owning plugin.
- A plugin can expose settings from its plugin card.
- **Uninstalling deletes the script and its local data and cannot be undone.**

States are **Ready**, **Loading**, **Error** (with a reason), and **Disabled**.

## Details and permissions

Click an installed plugin card to open its details. Under Permissions, turn each requested permission on or off:

| Permission       | What it allows                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Network          | Request external network services                                                                                           |
| Playback control | Play, pause, switch tracks, and change the queue                                                                            |
| UI extensions    | Add menus and send system notifications                                                                                     |
| Library access   | Search the local music library                                                                                              |
| Platform APIs    | Use the app’s current platform sessions to call APIs, including account actions such as liking tracks and editing playlists |

Declared permissions are enabled by default. Turn them off in the details dialog; plugin updates preserve your choices.

## Search and playback

Select **Plugins** on the search page, choose a source from the dropdown on the right, and enter a query to search songs. Sources come from enabled, ready plugins. Tracks with playback support can be played or added to the queue.

Plugin tracks are saved with the queue and remain playable after restarting the app. Disabling or uninstalling their plugin keeps the tracks in the queue, but playback reports that the source is unavailable. Enable or reinstall the same plugin to use them again.

## Troubleshooting

**Why is the plugin in Error state?**  
Read the error shown on its card. Common causes are syntax/runtime errors or an API level newer than the installed app supports.

**Can a plugin crash the app?**  
Plugins run in a separate host process. The app attempts to restart it after a crash; other plugins may be temporarily unavailable during recovery.

**Why are plugin requests slow?**  
Plugin network requests follow the system proxy. Performance depends on the destination and network conditions.
