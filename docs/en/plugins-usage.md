# Using Plugins

Plugins can extend **music sources** (resolve playable track URLs) and **control** (react to playback and control the player). This page is for plugin users. Authors should start with [Plugin Development](/en/plugins/).

## Opening plugin management

Open **Settings → Plugin Management**. Each installed plugin card shows its name, version, author, runtime state, and supported sources.

## Installing a plugin

- **Local import:** Select a `.js` file.
- **Import from URL:** Paste an `http(s)` URL to a `.js` file, such as a GitHub or Gitee raw URL.

Scripts distributed with a `gz_` prefix are detected and decompressed automatically.

## Enable, disable, and uninstall

- Newly installed plugins are enabled automatically.
- Multiple plugins may be enabled at once. If several support the same source, SPlayer-Next selects one by priority.
- A control plugin can expose settings from its plugin card.
- **Uninstalling deletes the script and its local data and cannot be undone.**

States are **Ready**, **Loading**, **Error** (with a reason), and **Disabled**.

## LX plugin compatibility

SPlayer-Next supports [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `user_api` scripts. Most public LX scripts can be imported directly, though scripts using uncommon or newer LX APIs may fail to load.

## Troubleshooting

**Why is the plugin in Error state?**  
Read the error shown on its card. Common causes are syntax/runtime errors or an API level newer than the installed app supports.

**Can a plugin crash the app?**  
Plugins run in an isolated host process. Failures are contained and the host is restarted automatically.

**Why are plugin requests slow?**  
Plugin network requests follow the system proxy. Performance depends on the destination and network conditions.
