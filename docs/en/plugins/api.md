# Common APIs

These APIs are shared by all plugins. All methods belong to `splayer`; times are in milliseconds.

## Host information {#host}

No permission required; minimum API level 1.

| Property     | Type     | Description                         |
| ------------ | -------- | ----------------------------------- |
| `pluginId`   | `string` | Plugin ID                           |
| `apiLevel`   | `number` | Current host API level              |
| `locale`     | `string` | Application locale, such as `en-US` |
| `appVersion` | `string` | Application version                 |

## Capability registration {#register}

Declare capabilities during initialization. A plugin can combine source resolution, event subscriptions, settings, and menus. On subsequent calls, omitted fields remain unchanged; supplied event, control marker, setting, and menu fields replace their previous declarations.

**Call:** `splayer.register(args)`

**API version:** 1; event, control marker, setting, and menu declarations are available from 2.

**Permission:** None; displaying and executing menus requires `ui`.

**Parameters:**

- `args.sources` (`Record<string, SourceCapability>`, optional): [Source capabilities](/en/plugins/source#register).
- `args.events` (`PlaybackEventKind[]`, optional): [Playback events](/en/plugins/control#event-types) to receive; none by default.
- `args.controls` (`boolean`, optional): Playback-control marker; default `false`.
- `args.settings` (`PluginSettingItem[]`, optional): [User settings](#setting-declarations).
- `args.menus` (`PluginMenuItem[]`, optional): [Track menus](#menu-items).

**Returns:** `void`.

## Music services {#music}

### Online search {#search-online}

Searches online tracks and returns [Track](/en/types#track) objects ready for playback or queue insertion.

**Call:** `splayer.music.searchOnline(options)`

**API version:** 4

**Permission:** `network`

**Parameters:**

- `options.platform` (`"netease" | "qqmusic" | "kugou"`): Required platform identifier
- `options.query` (`string`): Search text, 1–200 characters after trimming
- `options.page` (`number`): Optional integer 1–100; default 1
- `options.limit` (`number`): Optional integer 1–50; default 20

**Returns:** `Promise<{ platform, page, total, hasMore, tracks }>`. `platform: string` and `page: number` identify the query; `total: number` is the match count, `hasMore: boolean` indicates another page, and `tracks: Track[]` contains this page's tracks.

```js
const result = await splayer.music.searchOnline({
  platform: "netease",
  query: "demo",
  limit: 5,
});
splayer.log.info(result.tracks);
```

### Library search {#search-library}

Searches the scanned local library by title, artist, or album.

**Call:** `splayer.music.searchLibrary(query, limit?)`

**API version:** 4

**Permission:** `library`

**Parameters:**

- `query` (`string`): Search text, 1–200 characters after trimming
- `limit` (`number`): Optional integer 1–100; default 20

**Returns:** `Promise<{ total: number; tracks: Track[] }>`. `total` is the match count; `tracks` contains at most `limit` tracks.

```js
const { total, tracks } = await splayer.music.searchLibrary("demo", 10);
splayer.log.info(total, tracks);
```

### Platform APIs {#platform-api}

Calls the application's existing platform APIs using its current account session and request handling. Existing read and write endpoints are available without supplying a separate Cookie.

**Call:** `splayer.api.call(platform, name, params?)`

**API version:** 4

**Permission:** `api`

**Parameters:**

- `platform` (`"netease" | "qqmusic" | "kugou"`): Platform identifier
- `name` (`string`): Endpoint name, 1–256 characters; `netease` also accepts paths starting with `/api/`
- `params` (`Record<string, unknown>`): Optional, defaults to `{}`; fields depend on the endpoint

**Returns:** `Promise<ApiCallResponse>`, preserving the endpoint's business response:

| Result                          | Response                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| Successful `netease` call       | `{ ok: true, status: number, body: unknown }`                     |
| Other successful platform calls | `{ ok: true, data: unknown }`                                     |
| Endpoint failure                | `{ ok: false, error: string }`, possibly with `status` and `body` |

Inspect the business status inside `body` or `data` as well as `ok`. Authentication credentials such as cookies and login tokens are removed from responses. Invalid parameters reject.

For path-based calls, `params` contains request data; `crypto` selects `weapi`, `eapi`, `linuxapi`, `xeapi`, or `api` (default `api`):

::: code-group

```js [Endpoint name]
const result = await splayer.api.call("netease", "song_detail", { ids: "123" });
if (!result.ok) throw new Error(result.error);
if (result.body.code !== 200) throw new Error(result.body.message || "Request failed");
splayer.log.info(result.body.songs);
```

```js [Business path]
const result = await splayer.api.call("netease", "/api/listen/together/status/get", {
  crypto: "api",
});
```

:::

Paths cannot be full URLs. `params` does not accept `cookie`, `domain`, `proxy`, or `headers`; use [request](#request) for external services. Endpoint names and business parameters match the application's [API modules](https://github.com/SPlayer-Dev/SPlayer-Next/tree/dev/electron/main/apis).

## Network and notifications {#network}

### HTTP requests {#request}

Sends an HTTP(S) request using the system proxy. Only explicitly supplied Cookie headers are sent; the application cookie store is not used.

**Call:** `splayer.request(url, options?)`

**API version:** 1

**Permission:** `network`

**Parameters:**

- `url` (`string`): Full `http://` or `https://` URL
- `options` (`object`): Optional request options
- `options.method` (`"GET" | "POST"`): `"GET"`; HTTP method
- `options.headers` (`Record<string, string>`): Request headers
- `options.body` (`string | ArrayBuffer | Uint8Array`): Request body; serialize JSON yourself
- `options.timeout` (`number`): `15000`; Timeout, clamped to `1000`–`60000`
- `options.responseType` (`"text" | "json" | "arraybuffer"`): `"text"`; Response parsing

**Returns:** `Promise<{ status: number; headers: Record<string, string>; body: unknown }>`. The body is a string, parsed JSON, or `Uint8Array`; invalid JSON is returned as raw text. Inspect `status` for the HTTP result. Network failures reject.

```js
const response = await splayer.request("https://api.example.com/search?q=demo", {
  responseType: "json",
});
splayer.log.info(response.status, response.body);
```

### System notifications {#notify}

Sends a system notification with the plugin name as its title.

**Call:** `splayer.notify(message)`

**API version:** 4

**Permission:** `ui`

**Parameters:**

- `message` (`string`): Notification text, 1–1000 characters after trimming.

**Returns:** `Promise<void>`. Rejects if system notifications are unsupported; display follows system notification settings.

```js
await splayer.notify("Task completed");
```

## Data storage {#storage}

Data is scoped to the plugin ID, persists across restarts, and is removed on uninstall. `key` is a string; `value` must be JSON-serializable.

### Reading a value {#storage-get}

Reads the value for a key. Returns `null` if the key does not exist.

**Call:** `splayer.storage.get(key)`

**API version:** 1

**Permission:** None

**Parameters:**

- `key` (`string`): Storage key.

**Returns:** `Promise<T | null>`.

### Writing a value {#storage-set}

Saves a value, replacing the existing value if the key already exists.

**Call:** `splayer.storage.set(key, value)`

**API version:** 1

**Permission:** None

**Parameters:**

- `key` (`string`): Storage key.
- `value` (`unknown`): JSON-serializable value.

**Returns:** `Promise<void>`.

### Removing a value {#storage-remove}

Removes a key and its value. Does nothing if the key does not exist.

**Call:** `splayer.storage.remove(key)`

**API version:** 1

**Permission:** None

**Parameters:**

- `key` (`string`): Storage key.

**Returns:** `Promise<void>`.

### Listing keys {#storage-keys}

Lists all keys stored by the current plugin.

**Call:** `splayer.storage.keys()`

**API version:** 1

**Permission:** None

**Parameters:** None.

**Returns:** `Promise<string[]>`.

```js
await splayer.storage.set("preferences", { enabled: true });
const preferences = await splayer.storage.get("preferences");
const keys = await splayer.storage.keys();
await splayer.storage.remove("preferences");
```

## Settings {#settings}

### Declaring settings {#setting-declarations}

Declares plugin options that users can edit.

**Call:** `splayer.register({ settings })`

**API version:** 2

**Permission:** None

**Parameters:** `settings: PluginSettingItem[]`. Each setting contains these fields.

- `key` (`string`): Required setting key
- `type` (`"switch" | "number" | "text" | "select"`): Required control type
- `label` (`string`): Required display name
- `default` (`boolean | number | string`): Required default, matching the control's value type
- `description` (`string`): Optional description
- `min` / `max` (`number`): Numeric bounds; values are clamped
- `placeholder` (`string`): Text input placeholder
- `options` (`{ label: string; value: string }[]`): Select options; `value` is stored

**Control types**

| `type`   | Control      | Value type | Specific fields                        |
| -------- | ------------ | ---------- | -------------------------------------- |
| `switch` | Toggle       | `boolean`  | —                                      |
| `number` | Number input | `number`   | `min`, `max`                           |
| `text`   | Text input   | `string`   | `placeholder`                          |
| `select` | Select       | `string`   | `options`; stores the selected `value` |

**Returns:** `void`.

```js
splayer.register({
  settings: [
    { key: "enabled", type: "switch", label: "Enable sync", default: true },
    { key: "interval", type: "number", label: "Interval (seconds)", default: 30, min: 5 },
    { key: "token", type: "text", label: "Access token", default: "" },
    {
      key: "mode",
      type: "select",
      label: "Mode",
      default: "auto",
      options: [
        { label: "Automatic", value: "auto" },
        { label: "Manual", value: "manual" },
      ],
    },
  ],
});
```

### Reading a setting {#get-setting}

Reads the current setting value synchronously. Returns `undefined` if it is not defined.

**Call:** `splayer.getSetting(key)`

**API version:** 1

**Permission:** None

**Parameters:**

- `key` (`string`): Setting key.

**Returns:** `T | undefined`.

### Observing changes {#setting-change}

Calls the handler with the new value when the setting changes. Registering the handler does not invoke it.

**Call:** `splayer.onSettingChange(key, handler)`

**API version:** 2

**Permission:** None

**Parameters:**

- `key` (`string`): Setting key.
- `handler` (`(value: unknown) => void`): Callback receiving the new setting value.

**Returns:** `void`.

```js
const enabled = splayer.getSetting("enabled");
splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("enabled", value);
});
```

## Menu extensions {#menus}

### Menu items {#menu-items}

Declare items in `register.menus` to show them in track context menus and the player bar's More menu.

**Call:** `splayer.register({ menus })`

**API version:** 2

**Permission:** `ui`

**Parameters:** `menus: PluginMenuItem[]`. Each menu item contains these fields.

- `id` (`string`): Required identifier, unique within the plugin
- `label` (`string`): Required display text
- `sources` (`string[]`): Optional track source list; see [TrackSource](/en/types#tracksource). All sources when omitted

**Returns:** `void`.

### Menu actions {#menu-click}

Registers a handler called by the host when a menu item is clicked. Registering the same action again replaces the previous handler.

**Call:** `splayer.on("menuClick", handler)`

**API version:** 2

**Permission:** `ui`

**Parameters:**

- `handler` (`(req) => Promise<MenuClickRes>`): Menu callback.
- `req.menuId` (`string`): Menu identifier.
- `req.track` ([Track](/en/types#track)): Selected track.

**Returns:** Registration returns `void`; the handler returns an object combining any of the fields below, or `{}`.

| Result field | Type     | Description                                 |
| ------------ | -------- | ------------------------------------------- |
| `toast`      | `string` | Optional toast message                      |
| `openUrl`    | `string` | Optional HTTP(S) URL to open in the browser |
| `copyText`   | `string` | Optional text to copy to the clipboard      |

The handler has a 15-second timeout. Other methods called inside it retain their own permission requirements.

```js
/**
 * @name Track tools
 * @id you.track-tools
 * @version 1.0.0
 * @apiLevel 2
 * @grant ui
 */
splayer.register({ menus: [{ id: "copy", label: "Copy track info" }] });
splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId === "copy") {
    return { copyText: track.title + " - " + track.artists.map((a) => a.name).join(" / ") };
  }
  return {};
});
```

## Logging {#log}

`args` accepts any number of values to write to the application log. Each method returns `void`.

### Debug logs {#log-debug}

Writes a debug message.

**Call:** `splayer.log.debug(...args)`

**API version:** 1

**Permission:** None

**Parameters:**

- `...args` (`unknown[]`): Any number of values to log.

**Returns:** `void`.

### Informational logs {#log-info}

Writes an informational message.

**Call:** `splayer.log.info(...args)`

**API version:** 1

**Permission:** None

**Parameters:**

- `...args` (`unknown[]`): Any number of values to log.

**Returns:** `void`.

### Warning logs {#log-warn}

Writes a warning.

**Call:** `splayer.log.warn(...args)`

**API version:** 1

**Permission:** None

**Parameters:**

- `...args` (`unknown[]`): Any number of values to log.

**Returns:** `void`.

### Error logs {#log-error}

Writes an error.

**Call:** `splayer.log.error(...args)`

**API version:** 1

**Permission:** None

**Parameters:**

- `...args` (`unknown[]`): Any number of values to log.

**Returns:** `void`.

```js
splayer.log.debug("response", { status: 200 });
splayer.log.info("ready");
splayer.log.warn("empty result");
splayer.log.error("request failed");
```

## Hashing and encryption {#crypto}

All utilities return synchronously. `Bytes` means `Buffer | Uint8Array`; `Input` means `string | Uint8Array`. String inputs use UTF-8 by default; binary outputs are `Buffer` objects.

**Namespace:** `splayer.utils.crypto`

### MD5 digest {#crypto-md5}

Computes an MD5 digest as a hexadecimal string.

**Call:** `splayer.utils.crypto.md5(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Input`): Input data.

**Returns:** `string`.

### SHA-1 digest {#crypto-sha1}

Computes a SHA-1 digest as a hexadecimal string.

**Call:** `splayer.utils.crypto.sha1(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Input`): Input data.

**Returns:** `string`.

### SHA-256 digest {#crypto-sha256}

Computes a SHA-256 digest as a hexadecimal string.

**Call:** `splayer.utils.crypto.sha256(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Input`): Input data.

**Returns:** `string`.

### HMAC digest {#crypto-hmac}

Computes an HMAC with the specified algorithm and key, returning a hexadecimal string.

**Call:** `splayer.utils.crypto.hmac(algo, key, data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `algo` (`string`): Digest algorithm, such as `sha256`.
- `key` (`Input`): Secret key.
- `data` (`Input`): Input data.

**Returns:** `string`.

### Random bytes {#crypto-random}

Generates the specified number of random bytes.

**Call:** `splayer.utils.crypto.randomBytes(size)`

**API version:** 1

**Permission:** None

**Parameters:**

- `size` (`number`): Non-negative integer number of random bytes.

**Returns:** `Buffer`.

### AES encryption {#crypto-aes-encrypt}

Encrypts data using the specified AES algorithm. Key and IV lengths must match the algorithm.

**Call:** `splayer.utils.crypto.aesEncrypt(data, key, mode, iv?)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Input`): Input data.
- `key` (`Bytes`): Secret key.
- `mode` (`string`): AES algorithm name, such as `aes-128-cbc`.
- `iv?` (`Bytes`): Optional initialization vector, matching the algorithm.

**Returns:** `Buffer`.

### AES decryption {#crypto-aes-decrypt}

Decrypts data using the same key, algorithm, and IV used for encryption.

**Call:** `splayer.utils.crypto.aesDecrypt(data, key, mode, iv?)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.
- `key` (`Bytes`): Secret key.
- `mode` (`string`): AES algorithm name, such as `aes-128-cbc`.
- `iv?` (`Bytes`): Optional initialization vector, matching the algorithm.

**Returns:** `Buffer`.

### RSA encryption {#crypto-rsa}

Encrypts data using a PEM public key and OAEP padding.

**Call:** `splayer.utils.crypto.rsaEncrypt(data, publicKey)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.
- `publicKey` (`string`): PEM public key.

**Returns:** `Buffer`.

```js
const { crypto, buffer } = splayer.utils;
const data = buffer.from("demo");
splayer.log.info(crypto.md5(data), crypto.sha1(data), crypto.sha256(data));
const signature = crypto.hmac("sha256", "secret", data);
const key = crypto.randomBytes(16);
const iv = crypto.randomBytes(16);
const encrypted = crypto.aesEncrypt(data, key, "aes-128-cbc", iv);
const decrypted = crypto.aesDecrypt(encrypted, key, "aes-128-cbc", iv);
splayer.log.info(buffer.bufToString(decrypted));
```

For `rsaEncrypt`, use a valid PEM public key provided by the service:

```js
const encrypted = splayer.utils.crypto.rsaEncrypt(splayer.utils.buffer.from("demo"), publicKeyPem);
```

## Byte buffers {#buffer}

**Namespace:** `splayer.utils.buffer`

### Creating a buffer {#buffer-from}

Converts text or binary data to a Buffer.

**Call:** `splayer.utils.buffer.from(data, enc?)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`string | ArrayBuffer | SharedArrayBuffer | Uint8Array | number[]`): Input data.
- `enc?` (`string`): Optional string encoding, default `utf8`.

**Returns:** `Buffer`.

### Decoding text {#buffer-string}

Converts bytes to a string using the specified encoding, defaulting to UTF-8.

**Call:** `splayer.utils.buffer.bufToString(buf, enc?)`

**API version:** 1

**Permission:** None

**Parameters:**

- `buf` (`Bytes`): Byte array to decode.
- `enc?` (`string`): Optional string encoding, default `utf8`.

**Returns:** `string`.

### Concatenating buffers {#buffer-concat}

Concatenates byte arrays in order.

**Call:** `splayer.utils.buffer.concat(list)`

**API version:** 1

**Permission:** None

**Parameters:**

- `list` (`Bytes[]`): Ordered byte arrays to concatenate.

**Returns:** `Buffer`.

```js
const a = splayer.utils.buffer.from("hello");
const b = splayer.utils.buffer.from("20776f726c64", "hex");
const joined = splayer.utils.buffer.concat([a, b]);
splayer.log.info(splayer.utils.buffer.bufToString(joined, "utf8"));
```

## Base64 encoding {#base64}

**Namespace:** `splayer.utils.base64`

### Encoding text {#base64-encode}

Encodes data as a Base64 string.

**Call:** `splayer.utils.base64.encode(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Input`): Input data.

**Returns:** `string`.

### Decoding text {#base64-decode}

Decodes a Base64 string to UTF-8 text.

**Call:** `splayer.utils.base64.decode(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`string`): Input data.

**Returns:** `string`.

```js
const encoded = splayer.utils.base64.encode("hello");
const text = splayer.utils.base64.decode(encoded);
```

## Compression {#zlib}

**Namespace:** `splayer.utils.zlib`

### zlib compression {#zlib-deflate}

Compresses data in zlib format.

**Call:** `splayer.utils.zlib.deflate(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.

**Returns:** `Buffer`.

### zlib decompression {#zlib-inflate}

Decompresses zlib data.

**Call:** `splayer.utils.zlib.inflate(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.

**Returns:** `Buffer`.

### gzip compression {#zlib-gzip}

Compresses data in gzip format.

**Call:** `splayer.utils.zlib.gzip(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.

**Returns:** `Buffer`.

### gzip decompression {#zlib-gunzip}

Decompresses gzip data.

**Call:** `splayer.utils.zlib.gunzip(data)`

**API version:** 1

**Permission:** None

**Parameters:**

- `data` (`Bytes`): Input data.

**Returns:** `Buffer`.

```js
const data = splayer.utils.buffer.from("hello");
const packed = splayer.utils.zlib.deflate(data);
const unpacked = splayer.utils.zlib.inflate(packed);
const gzipped = splayer.utils.zlib.gzip(data);
const restored = splayer.utils.zlib.gunzip(gzipped);
```
