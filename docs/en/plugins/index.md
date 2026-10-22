# Plugin overview and architecture

Plugins are JavaScript files that use the injected `splayer` object to extend SPlayer-Next.

| Guide                                         | Contents                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Plugin Development](/en/plugins/development) | First plugin, development workflow, and Agent resources                                     |
| [Common APIs](/en/plugins/api)                | HTTP requests, music search, platform APIs, notifications, storage, settings, and utilities |
| [Source resolution](/en/plugins/source)       | Independent catalog search, playback URLs, lyrics, covers, and comments                     |
| [Playback control](/en/plugins/control)       | Playback events, player controls, queues, and play modes                                    |
| [Plugin API Levels](/en/plugins/changelog)    | Capabilities introduced at each API level                                                   |
| [Plugin updates](/en/plugins/update)          | Version metadata and update delivery                                                        |
| [LX Compatibility](/en/plugins/lx)            | Importing LX scripts, supported APIs, and update alerts                                     |

For installation and permission settings, see [Using Plugins](/en/plugins-usage).

## Architecture

### Process model

All enabled plugins share a dedicated Electron utility process, with a separate `node:vm` context for each plugin. The main process manages plugins, checks permissions, and handles network requests, storage, platform APIs, and playback control. Plugins call these services through `splayer`; messages are routed by plugin ID.

```text
Application UI
    ↕ IPC
Main process
    ├─ Plugin registry, permissions, and lifecycle
    ├─ Playback, platform APIs, network, and storage
    ↕ Messages routed by plugin ID
Plugin host process
    ├─ Plugin A: vm context, handlers, timers
    └─ Plugin B: vm context, handlers, timers
```

Plugins execute outside the UI thread but share the host event loop. Blocking code affects other plugins, and a host exit requires all enabled plugins to reload. `splayer.storage` scopes data by plugin ID; `node:vm` does not provide a security boundary against malicious code.

### Interaction flow

The host initiates source requests. The search page calls the selected source's search handler and converts results into tracks; the player then calls URL, lyric, and cover handlers. Independent sources are routed using the plugin ID and source key saved in the track. Built-in sources follow plugin priority. Network and storage calls made by handlers run in the main process.

```text
Search page → Source search handler → Track → Playback queue
Player → Track source handler → Playback URL / metadata
```

The application pushes track, lyric, and playback changes to plugins subscribed to those events. Playback commands from plugins are checked in the main process and forwarded to the player.

```text
Playback state change → Subscribed plugin callbacks
Plugin playback call → Main-process validation → Player → State events
```

### Lifecycle

```text
Install → Parse manifest → Enable → Create context → Execute and register → Ready
Disable → Clear handlers and timers → Dispose plugin context
Uninstall → Stop plugin → Delete script and private data
Host exit → Restart host → Reload enabled plugins
```

| State      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `unloaded` | Installed but not loaded                                            |
| `loading`  | Starting or waiting to reload                                       |
| `ready`    | Available to handle requests                                        |
| `error`    | Load failure or exhausted host restart attempts, with error details |
| `disabled` | Disabled by the user                                                |

Disabling one plugin does not restart the host or other plugins. If the host crashes or becomes unresponsive, the application retries after 2, 8, and 30 seconds, then marks plugins as `error` if retries are exhausted.

### Runtime

The host injects `splayer`, `Buffer`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `btoa`, `atob`, promises, microtasks, timers, and `console`. Node module imports, `require`, DOM, and Electron APIs are not provided.

| Limit                              | Value                   |
| ---------------------------------- | ----------------------- |
| Host startup / plugin load timeout | 10 seconds each         |
| Top-level synchronous execution    | 10 seconds              |
| Default / maximum request timeout  | 15 / 60 seconds         |
| Remote script import size          | 9,000,000 bytes maximum |

Register capabilities and handlers during initialization. Keep network requests and other slow work asynchronous.

## Manifest

Declare metadata in a leading JSDoc comment:

```js
/**
 * @name Example
 * @id you.example
 * @version 1.0.0
 * @description Example plugin
 * @author you
 * @apiLevel 2
 */
splayer.register({ events: ["trackChange"] });
splayer.player.on("trackChange", ({ track }) => {
  if (track) splayer.log.info(track.title);
});
```

Save the file as `example.js` and use **Settings → Plugin Management → Local import**.

| Field          | Description                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@name`        | Display name; generated from the script if omitted                                                                           |
| `@id`          | Stable plugin identity, such as `you.example`; derived from the name if omitted                                              |
| `@version`     | Plugin version; defaults to `0.0.0`                                                                                          |
| `@description` | Short description                                                                                                            |
| `@author`      | Author                                                                                                                       |
| `@homepage`    | Homepage URL                                                                                                                 |
| `@apiLevel`    | Minimum host API level required; defaults to `1`. See [Plugin API Levels](/en/plugins/changelog) for capability requirements |
| `@grant`       | Requested permissions, separated by spaces or commas                                                                         |
| `@updateUrl`   | Latest script URL; see [Plugin updates](/en/plugins/update)                                                                  |
| `@changelog`   | Plugin release notes                                                                                                         |

Declare `@name`, `@id`, and `@version` explicitly. Keep `@id` stable across releases: importing the same identity replaces the installed script.

## Permissions

Declare required permissions in the header, for example `@grant network control`. Declared permissions are enabled by default; users can turn them off in plugin details. `network` is included by default.

| Permission | Methods                                                         |
| ---------- | --------------------------------------------------------------- |
| `network`  | `request`, `music.searchOnline`                                 |
| `control`  | Player commands and queries; `player.on` requires no permission |
| `ui`       | Track menus, `notify`                                           |
| `library`  | `music.searchLibrary`                                           |
| `api`      | `api.call`, using the application's current account session     |

## Data storage

```text
{userData}/app-data/plugins/
├─ scripts/        Installed scripts
├─ data/           Private data scoped by plugin ID
└─ manifest.json   Installed plugin metadata
```

Permission choices, enabled state, settings, and priority are stored in the application configuration. Copy the complete `app-data` directory when moving a portable installation.

## Debugging

Use `splayer.log` or `console` to write to the application log under `{userData}/app-data/logs/`. Re-import the modified script to reload it.

Promise-based calls reject on permission or parameter errors. Platform API business responses are described under [api.call](/en/plugins/api#platform-api). Legacy player methods returning `void` do not report failures to the caller.

| Error code                  | Meaning                                    |
| --------------------------- | ------------------------------------------ |
| `PLUGIN_PERMISSION_DENIED`  | Required permission is unavailable         |
| `PLUGIN_API_LEVEL_MISMATCH` | The plugin requires a newer host API level |
| `PLUGIN_INVALID_MANIFEST`   | Invalid header metadata                    |
| `PLUGIN_SCRIPT_ERROR`       | Script syntax or execution error           |
| `PLUGIN_LOAD_TIMEOUT`       | Plugin initialization timed out            |
| `PLUGIN_ACTION_UNSUPPORTED` | No handler for the requested action        |
| `PLUGIN_HANDLER_ERROR`      | An action handler threw an error           |
| `PLUGIN_REQUEST_TIMEOUT`    | Request timed out                          |
| `PLUGIN_CANCELLED`          | Request cancelled                          |
| `PLUGIN_NETWORK_ERROR`      | Network request failed                     |
| `PLUGIN_URL_NOT_ALLOWED`    | Unsupported URL scheme                     |
| `PLUGIN_NOT_READY`          | Plugin is not ready                        |
| `PLUGIN_NOT_FOUND`          | Plugin is not installed                    |
| `PLUGIN_DISABLED`           | Plugin is disabled                         |
| `PLUGIN_WORKER_CRASHED`     | Plugin host process exited                 |
| `PLUGIN_UNKNOWN`            | Other failure; inspect the error message   |

## Publishing

Submit your script through the New Plugin or Update Plugin issue template in [SPlayer-Dev/plugins](https://github.com/SPlayer-Dev/plugins). After validation and maintainer review, it becomes available in the plugin market.
