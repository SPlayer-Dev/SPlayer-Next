# LX Compatibility

SPlayer-Next can import LX `user_api` source scripts. The application injects the `lx` compatibility API automatically.

## Importing scripts

Use local import or URL import in **Settings → Plugin Management**. See [Using Plugins](/en/plugins-usage) for installation steps.

Both plain `.js` scripts and compressed script contents starting with `gz_` are supported. Compressed contents are decoded and decompressed automatically.

## Compatibility scope

The compatibility layer supports playback URL resolution, network requests, update alerts, and the `lx.utils.crypto`, `lx.utils.buffer`, and `lx.utils.zlib` utilities. Other LX actions, such as lyrics and search, are not connected. Scripts depending on those actions or other unimplemented APIs cannot be used directly.

| Property               | Value or description                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `lx.version`           | `"2.0.0"`, the compatibility API version, separate from [Plugin API Levels](/en/plugins/changelog) |
| `lx.env`               | `"desktop"`                                                                                        |
| `lx.currentScriptInfo` | The script's `name`, `description`, `version`, `author`, `homepage`, and `rawScript`               |
| `lx.EVENT_NAMES`       | `request`, `inited`, and `updateAlert`                                                             |

Access the API through `lx`, `globalThis.lx`, or `window.lx`. The `window` alias provides script compatibility without a browser DOM.

For new plugins, see [Common APIs](/en/plugins/api) and [Source Resolution](/en/plugins/source).

## Source integration

### Declaring capabilities

Declares supported sources and qualities to the host. Available once per script load.

**Call:** `lx.send(lx.EVENT_NAMES.inited, data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data.sources: Record<string, Source>`: Source declarations. Playback resolution uses `wy`, `tx`, and `kg`.
- `Source.name?: string`: Source display name.
- `Source.actions: string[]`: Supported actions. Only `"musicUrl"` is connected; sources without this action are ignored.
- `Source.qualitys: string[]`: Supported LX qualities. `qualities` is also accepted; `qualitys` takes precedence.

**Returns:** `Promise<void>`. Repeated declarations reject.

```js
lx.send(lx.EVENT_NAMES.inited, {
  sources: {
    wy: {
      name: "Example source",
      actions: ["musicUrl"],
      qualitys: ["128k", "320k", "flac"],
    },
  },
}).catch((error) => console.error(error));
```

### Resolving URLs

Registers a handler called when the player needs a playback URL. Registering again replaces the previous handler.

**Call:** `lx.on(lx.EVENT_NAMES.request, handler)`

**API version:** 1

**Permission:** None; network requests within the handler require `network`

**Parameters:**

- `handler: (request) => string | { url: string } | Promise<string | { url: string }>`: Handler returning the playback URL.
- `request.source: string`: Source identifier.
- `request.action: "musicUrl"`: Resolution action.
- `request.info.type?: string`: LX quality, listed below.
- `request.info.musicInfo: object`: Track information including `id`, `songmid`, `songId`, `name`, `singer`, `albumId`, `albumName`, and `img`. Source-specific identifiers are provided when present in track data.

**Returns:** `Promise<void>`, confirming handler registration. Only the `request` event can be subscribed to.

| Host quality | LX request `type` |
| ------------ | ----------------- |
| `lq`         | `128k`            |
| `sq`         | `192k`            |
| `hq`         | `320k`            |
| `lossless`   | `flac`            |
| `hi-res`     | `flac24bit`       |

## Network requests

### Sending a request

Sends an HTTP(S) request and delivers the result through a callback. Requests follow the system proxy.

**Call:** `lx.request(url, options, callback)`

**API version:** 1

**Permission:** `network`

**Parameters:**

- `url: string`: Request URL.
- `options?: object`: Request options. Pass `undefined` when no options are needed.
- `options.method?: "GET" | "POST"`: Defaults to `"GET"`.
- `options.headers?: Record<string, string>`: Request headers.
- `options.timeout?: number`: Timeout in milliseconds, default 15,000, clamped to 1,000–60,000.
- `options.body?: string | Uint8Array | ArrayBuffer | object`: Request body. Objects are serialized as JSON.
- `options.form?: Record<string, unknown>`: URL-encoded form fields. `formData` is also accepted; multipart is not supported. `body` takes precedence when supplied.
- `callback: (error, response, body) => void`: On success, `error` is `null` and `response` includes `statusCode`, `statusMessage`, `headers`, `bytes`, `raw`, and `body`. JSON response text is parsed; other text remains a string. On failure, the callback receives an error, `undefined`, and `null`.

**Returns:** `() => void`. Calling it suppresses callback delivery while the underlying request continues. `raw` is a Buffer re-encoded from response text and is unsuitable for binary downloads.

```js
lx.request("https://example.com/api/status", undefined, (error, response, body) => {
  if (error) {
    console.error(error);
    return;
  }
  console.log(response.statusCode, body);
});
```

## Plugin updates

### Sending an alert {#update-alert}

Reports an available update to the host. Available once per script load.

**Call:** `lx.send(lx.EVENT_NAMES.updateAlert, data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data.log?: string`: Release notes.
- `data.updateUrl?: string`: Download or information URL.
- `data.version?: string`: New version number. Omit it to show a generic update indicator.

**Returns:** `Promise<void>`. Repeated calls reject.

```js
lx.send(lx.EVENT_NAMES.updateAlert, {
  log: "Fix connection issues",
  updateUrl: "https://example.com/plugins/example.js",
}).catch((error) => console.error(error));
```

If the URL points to an information page, users can open it to download and re-import the script. For updates declared in script metadata, see [Plugin Updates](/en/plugins/update).
