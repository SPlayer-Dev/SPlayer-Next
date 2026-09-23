# Plugin Overview and Architecture

SPlayer-Next runs third-party JavaScript plugins in isolated sandboxes. A plugin interacts with the application only through the injected global `splayer` object.

- [Source plugins](/en/plugins/source) resolve playable URLs and can provide fallback lyrics, covers, and comments.
- [Control plugins](/en/plugins/control) receive playback events, control the player, expose settings, and add track menu items.
- [Plugin updates](/en/plugins/update) describes update metadata and in-place upgrades.

End users should see [Using Plugins](/en/plugins-usage).

## Plugin types

| Type                                  | `@type`   | Purpose                                               |
| ------------------------------------- | --------- | ----------------------------------------------------- |
| [Source plugin](/en/plugins/source)   | `source`  | Provide playable URLs and metadata fallbacks          |
| [Control plugin](/en/plugins/control) | `control` | Subscribe to events and extend playback or UI control |

A script has one type, selected by `@type`; the default is `source`.

## Publishing to the plugin market

Submit a plugin to [SPlayer-Dev/plugins](https://github.com/SPlayer-Dev/plugins) through the New Plugin issue template. Automated checks validate the manifest and conventions, a pull request is generated for maintainer review, and merging rebuilds the market index.

Use the Update Plugin template for a new version. Keep `@id` unchanged so users can update in place. See [Plugin Updates](/en/plugins/update).

## Architecture

### Process model

All enabled plugins share a dedicated plugin-host process. Each plugin runs in its own `node:vm` context. The process boundary prevents scripts from reading application memory or another plugin's data.

```text
┌──────────── SPlayer-Next main process / UI ────────────┐
│        Player · plugin manager · network · storage     │
└─────────────────────────┬──────────────────────────────┘
                          │ messages routed by pluginId
               ┌──────────▼───────────┐
               │ plugin host process  │
               │  ┌────────┐ ┌──────┐ │
               │  │Plugin A│ │Plugin B│ │ separate vm contexts
               │  └────────┘ └──────┘ │
               └──────────────────────┘
```

- One plugin error does not crash the main UI or audio playback.
- Do not block or create infinite loops. Plugins share the host event loop, so one blocked script can force the watchdog to restart the entire host.
- Persist plugin-private data only through `splayer.storage`.

### Interaction models

A **source plugin is called** when the player needs a URL or metadata. A **control plugin is notified** about track, lyric, and playback changes and may call `splayer.player.*` in return.

### Lifecycle and states

```text
install → parse manifest → enable → create vm → run → register() → ready
        → host crash → reload all enabled plugins → ready
        → disable → dispose context → disabled
        → uninstall → remove script and local data
```

| State      | Meaning                                       |
| ---------- | --------------------------------------------- |
| `loading`  | Started and waiting for registration          |
| `ready`    | Available                                     |
| `error`    | Load/runtime failure or repeated host crashes |
| `disabled` | Disabled by the user                          |

The host restarts after crashes or hangs using 2s, 8s, and 30s backoff. After three consecutive failures it enters `error`. A single plugin runtime failure affects only that plugin.

## Manifest

Metadata is declared in a leading JSDoc block:

```js
/**
 * @name        Example
 * @id          you.example
 * @version     1.0.0
 * @description Example plugin
 * @author      you
 * @homepage    https://example.com
 * @type        source
 * @apiLevel    2
 */
```

| Field          | Required | Description                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `@name`        |          | Display name, max 24 characters; a compatibility name is generated if omitted  |
| `@version`     |          | Version; defaults to `0.0.0`                                                   |
| `@id`          |          | Stable identity, preferably reverse-domain style; derived from name if omitted |
| `@description` |          | Summary                                                                        |
| `@author`      |          | Author                                                                         |
| `@homepage`    |          | Homepage URL                                                                   |
| `@grant`       |          | Comma-separated `network`, `control`, and `ui` permissions                     |
| `@type`        |          | `source` (default) or `control`; explicit declaration recommended              |
| `@apiLevel`    |          | Required host API level; current level is `3`                                  |
| `@updateUrl`   |          | Update script URL                                                              |
| `@changelog`   |          | Release notes                                                                  |

::: warning Stable identity
Native SPlayer plugins should explicitly declare `@name`, `@version`, and `@id`; the plugin market validates them. Identity uses `@id` when present and otherwise derives from the name. Re-importing the same identity replaces the existing plugin. Change the version and code for a release, not the ID or fallback name.
:::

## Permissions

| Permission | Gated API             | Capability        |
| ---------- | --------------------- | ----------------- |
| `network`  | `splayer.request`     | HTTP requests     |
| `control`  | `splayer.player.*`    | Control playback  |
| `ui`       | `register({ menus })` | Add UI menu items |

- Source plugins receive `network` automatically.
- Control plugins must declare each sensitive capability through `@grant`.
- Without permission, requests fail with `PLUGIN_PERMISSION_DENIED`, player controls are ignored, and menu declarations are discarded.

## API levels

Capabilities accumulate: a higher level includes all lower levels.

| Level | New capabilities                                                                          |
| ----- | ----------------------------------------------------------------------------------------- |
| `1`   | Source registration, `musicUrl`, `musicSearch`, `musicLyric`, `musicPic`, and common APIs |
| `2`   | Playback events/control, settings, `onSettingChange`, menus, and `menuClick`              |
| `3`   | `musicComment`; the host searches for a candidate before requesting comments              |

The current host level is **3**. A plugin requiring a newer level is rejected with `PLUGIN_API_LEVEL_MISMATCH`. Declare the lowest level actually used. Control plugins require at least level 2; comment plugins require level 3.

## Sandbox environment

- No Node built-ins, `require`, `import`, DOM, or Electron API.
- Available globals include `splayer`, `Buffer`, URL APIs, text encoders, Base64 APIs, promises, microtasks, timers, and a forwarded `console`.
- Network access is available only through `splayer.request` and only for HTTP(S).
- Top-level synchronous execution has a five-second limit. Put expensive work in asynchronous handlers.

## Common APIs

### Properties

| Property             | Type     | Description               |
| -------------------- | -------- | ------------------------- |
| `splayer.pluginId`   | `string` | Assigned plugin ID        |
| `splayer.apiLevel`   | `number` | Host API level            |
| `splayer.locale`     | `string` | UI locale such as `en-US` |
| `splayer.appVersion` | `string` | Application version       |

### `splayer.request(url, options?)`

Sends an HTTP(S) request through the system proxy.

| Option         | Type                                  | Default  | Description               |
| -------------- | ------------------------------------- | -------- | ------------------------- |
| `method`       | `"GET" \| "POST"`                     | `"GET"`  | HTTP method               |
| `headers`      | `Record<string, string>`              | —        | Request headers           |
| `body`         | `string \| ArrayBuffer \| Uint8Array` | —        | Request body              |
| `timeout`      | `number`                              | `15000`  | Milliseconds, max `60000` |
| `responseType` | `"text" \| "json" \| "arraybuffer"`   | `"text"` | Response parsing          |

The promise resolves to `{ status, headers, body }`. An array-buffer response is exposed as `Uint8Array`.

```js
const response = await splayer.request("https://api.example.com/song?id=1", {
  headers: { "User-Agent": "..." },
  responseType: "json",
});
console.log(response.status, response.body);
```

### `splayer.storage`

Private per-plugin key-value storage, removed when the plugin is uninstalled.

| Method                    | Result               |
| ------------------------- | -------------------- |
| `storage.get(key)`        | `Promise<T \| null>` |
| `storage.set(key, value)` | `Promise<void>`      |
| `storage.remove(key)`     | `Promise<void>`      |
| `storage.keys()`          | `Promise<string[]>`  |

### `splayer.getSetting(key)`

Synchronously reads a plugin setting or returns `undefined`. Control plugins declare settings during registration.

### `splayer.log`

`debug`, `info`, `warn`, and `error` methods are forwarded to the host log. `console.*` uses the same channel.

### `splayer.utils`

| Namespace      | Methods                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `utils.crypto` | `md5`, `sha1`, `sha256`, `hmac`, `randomBytes`, `aesEncrypt`, `aesDecrypt`, `rsaEncrypt` |
| `utils.buffer` | `from`, `bufToString`, `concat`                                                          |
| `utils.base64` | `encode`, `decode`                                                                       |
| `utils.zlib`   | `inflate`, `deflate`, `gunzip`, `gzip`                                                   |

## Limits and security

| Limit                   | Value      |
| ----------------------- | ---------- |
| Host load timeout       | 10 seconds |
| Top-level execution     | 5 seconds  |
| Default request timeout | 15 seconds |
| Maximum request timeout | 60 seconds |
| Remote import size      | About 9 MB |

::: warning A stability boundary, not a security boundary
Process isolation protects the main app from failures, not from malicious intent. A plugin runs with your user permissions, can access the network, and can persist data. Installing a plugin means trusting it like any other program.
:::

## Data storage

```text
{userData}/app-data/plugins/
├── scripts/        installed JavaScript files
├── data/           per-plugin storage
└── manifest.json   installed plugin metadata
```

Moving the portable edition's complete `app-data` directory preserves all plugins and data.

## Error codes

| Code                        | Meaning                                     |
| --------------------------- | ------------------------------------------- |
| `PLUGIN_ACTION_UNSUPPORTED` | Handler not registered                      |
| `PLUGIN_SCRIPT_ERROR`       | Syntax or runtime error                     |
| `PLUGIN_INVALID_MANIFEST`   | Invalid manifest field                      |
| `PLUGIN_API_LEVEL_MISMATCH` | API level newer than the host               |
| `PLUGIN_REQUEST_TIMEOUT`    | Request timeout                             |
| `PLUGIN_CANCELLED`          | Cancelled, for example after a track change |
| `PLUGIN_NETWORK_ERROR`      | Network error                               |
| `PLUGIN_URL_NOT_ALLOWED`    | Disallowed URL scheme                       |
| `PLUGIN_INVALID_RESULT`     | Invalid handler result                      |
| `PLUGIN_NOT_READY`          | Plugin is not ready                         |
| `PLUGIN_WORKER_CRASHED`     | Host process crashed                        |
| `PLUGIN_HANDLER_ERROR`      | Default handler error                       |

## Debugging

```js
await window.api.plugins.list();

await window.api.plugins.resolveUrl({
  pluginId: "my-plugin-splayer",
  source: "wy",
  quality: "hq",
  musicInfo: { songmid: "123" },
});

await window.api.plugins.setSetting("my-plugin-splayer", "someKey", true);
```

Plugin logs are written to `{userData}/app-data/logs/`. Re-import a modified script to replace the old version.
