# Control Plugins

A control plugin (`@type control`) can subscribe to track, lyric, and playback events; control playback; expose user settings; and add track menu items. Typical uses include smart-home integration, scrobbling, external displays, and track actions.

Read [Plugin Overview](/en/plugins/) for common APIs.

::: warning API level 2 required
Declare `@type control` and at least `@apiLevel 2`, otherwise control capabilities are unavailable.
:::

## Quick start

```js
/**
 * @name        Example Control
 * @id          you.example-control
 * @version     1.0.0
 * @description Example control plugin
 * @author      you
 * @type        control
 * @apiLevel    2
 * @grant       control
 */

splayer.register({
  events: [
    "trackChange",
    "trackUpdate",
    "lyricChange",
    "lineChange",
    "playStateChange",
    "positionSync",
  ],
  controls: true,
  settings: [{ key: "enabled", type: "switch", label: "Enable sync", default: true }],
});

splayer.player.on("trackChange", ({ track }) => {
  if (!track) return;
  splayer.log.info(
    "Now playing:",
    track.title,
    "-",
    track.artists.map((artist) => artist.name).join(" / "),
  );
});

splayer.player.on("playStateChange", ({ state, position }) => {
  splayer.log.info("Playback:", state, "@", position, "ms");
});
```

## `splayer.register(args)`

Call registration synchronously while the plugin loads.

| Field      | Type                  | Description                                            |
| ---------- | --------------------- | ------------------------------------------------------ |
| `events`   | `PlaybackEventKind[]` | Events to receive                                      |
| `controls` | `boolean`             | Declares that the plugin uses reverse playback control |
| `settings` | `PluginSettingItem[]` | Settings rendered in Plugin Management                 |
| `menus`    | `PluginMenuItem[]`    | Track menu items; requires `@grant ui`                 |

Only declared events are delivered. When enabled, the host immediately sends current track, lyrics, playback state, and line snapshots.

## Playback events {#playback-events}

```js
splayer.player.on(kind, (data) => {
  // ...
});
```

### `trackChange`

`track` is the current [`Track`](/en/types#track), or `null` when no track exists. `revision` is the track metadata revision.

### `trackUpdate` (apiLevel 4)

Sent when the track identity stays the same but delayed metadata arrives — cover, duration or quality. The payload carries the full `track` plus `revision`; `trackChange` is not re-emitted for these.

### `lyricChange`

| Field      | Type                             | Description                                           |
| ---------- | -------------------------------- | ----------------------------------------------------- |
| `lines`    | `LyricLine[]`                    | Full parsed lyric for the current track               |
| `source`   | `LyricData`                      | Lyric source, format and online platform (apiLevel 4) |
| `status`   | `"loading" \| "ready" \| "none"` | Current lyric load state (apiLevel 4)                 |
| `revision` | `number`                         | Lyric document revision (apiLevel 4)                  |

See [`LyricLine`](/en/types#lyricline) and [`LyricWord`](/en/types#lyricword). Convert a line to text with:

```js
line.words.map((word) => word.word).join("");
```

`lines` includes TTML backing vocal lines (`line.isBG === true`); filter with `!line.isBG` before showing the lead lyric, which is what the desktop lyric window does. Use `revision` to tell when the lyric for the same track was re-matched or upgraded to a finer format, such as line-level LRC replaced by word-level TTML.

### `lineChange`

Sent only when the current lyric line index changes.

| Field      | Type     | Description                             |
| ---------- | -------- | --------------------------------------- |
| `index`    | `number` | Current line index; `-1` means no match |
| `position` | `number` | Playback position in milliseconds       |

```js
let lines = [];
splayer.player.on("lyricChange", (data) => (lines = data.lines));
splayer.player.on("lineChange", ({ index }) => {
  const text = index >= 0 ? lines[index].words.map((word) => word.word).join("") : "";
  splayer.log.info("Current lyric:", text);
});
```

### `playStateChange`

| Field      | Type                                 | Description              |
| ---------- | ------------------------------------ | ------------------------ |
| `state`    | `"playing" \| "paused" \| "stopped"` | Playback state           |
| `position` | `number`                             | Position in milliseconds |

`stopped` is distinct from `paused`, for example after playback ends.

### `positionSync` (apiLevel 4)

Delivered on the player's position sync cadence (about 5 Hz), meant for external lyric windows that interpolate locally. Only plugins subscribed to this event receive it. Plugins declaring `@apiLevel` below `4` receive neither `positionSync` nor `trackUpdate`.

| Field           | Type                                 | Description                                      |
| --------------- | ------------------------------------ | ------------------------------------------------ |
| `position`      | `number`                             | Playback position in milliseconds                |
| `state`         | `"playing" \| "paused" \| "stopped"` | Playback state                                   |
| `speed`         | `number`                             | Playback rate multiplier                         |
| `lyricOffsetMs` | `number`                             | Current lyric offset; positive means lyrics lead |
| `sendTimestamp` | `number`                             | `Date.now()` milliseconds when the position held |

## Reading the current cover (apiLevel 4)

Declare `@grant control` with `@apiLevel 4` to read the small cover of the current track:

```js
const cover = await splayer.media.getCover();
if (cover) {
  // cover.data is a 300px JPEG; a binary view crossing the sandbox boundary
  // is not necessarily a Uint8Array of this context
  const bytes = ArrayBuffer.isView(cover.data) ? new Uint8Array(cover.data) : null;
  splayer.log.info(cover.trackId, cover.hash, bytes?.byteLength);
}
```

The payload also carries `source`, `mimeType` and a content `hash`; it is `null` when no cover is available or reading fails. Covers from local files (including embedded art), online platforms and streaming servers (Jellyfin / Emby / Subsonic family) are all resolved by the host and re-encoded into a 300px JPEG — original high-resolution art is never handed out. While the cover of the current track is unchanged the `hash` is stable and the host reuses the previous result, so polling does not re-decode.

## Controlling playback

Declare `@grant control` to use these methods. Without the permission, calls are ignored. `register({ controls: true })` describes the plugin's capability, while the grant is the current enforcement boundary.

| Method                     | Description                                 |
| -------------------------- | ------------------------------------------- |
| `player.play()`            | Play                                        |
| `player.pause()`           | Pause                                       |
| `player.next()`            | Next track                                  |
| `player.prev()`            | Previous track                              |
| `player.seek(positionMs)`  | Seek in milliseconds                        |
| `player.setVolume(volume)` | Set volume from `0` to `1`                  |
| `player.getPosition()`     | `Promise<number>` with the current position |

All methods except `getPosition` are fire-and-forget; invalid input (negative seek, out-of-range volume) is ignored. `getPosition()` costs a round trip per call, so keep it to occasional one-off queries — for continuous progress, subscribe to `positionSync` (apiLevel 4) and interpolate locally.

## Settings

```js
splayer.register({
  settings: [
    { key: "token", type: "text", label: "Access token", default: "" },
    { key: "interval", type: "number", label: "Interval (seconds)", default: 30, min: 5, max: 600 },
    { key: "enabled", type: "switch", label: "Enable reporting", default: true },
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

| `type`   | Value type | Specific fields | Behavior                             |
| -------- | ---------- | --------------- | ------------------------------------ |
| `switch` | `boolean`  | —               | Toggle                               |
| `number` | `number`   | `min`, `max`    | Number clamped to the declared range |
| `text`   | `string`   | `placeholder`   | Single-line text                     |
| `select` | `string`   | `options`       | One declared option value            |

Every setting requires `key`, `type`, `label`, and a type-compatible `default`. Optional common fields include `description`; number and text controls support the fields above. Labels are literal strings and are not localized by the host.

```js
const token = splayer.getSetting("token");

splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("Enabled:", value);
});
```

The host normalizes values before delivering them to the plugin.

## Menu extensions {#menu-extensions}

Custom items appear in the player More menu and track-list context menus, grouped under the plugin name.

::: warning UI permission required
Declare `@grant ui`. Otherwise menu declarations are ignored.
:::

```js
/**
 * @name     Track Tools
 * @id       you.track-tools
 * @version  1.0.0
 * @type     control
 * @apiLevel 2
 * @grant    ui network
 */
splayer.register({
  menus: [
    { id: "open", label: "Open on the web" },
    { id: "copy", label: "Copy track information" },
    { id: "local-only", label: "Local tracks only", sources: ["local"] },
  ],
});
```

| Field     | Type        | Required | Description                       |
| --------- | ----------- | -------- | --------------------------------- |
| `id`      | `string`    | Yes      | Unique within the plugin          |
| `label`   | `string`    | Yes      | Literal display text              |
| `sources` | `string[]?` |          | Show only for these track sources |

Handle clicks with `menuClick`:

```js
splayer.on("menuClick", async ({ menuId, track }) => {
  switch (menuId) {
    case "open":
      return { openUrl: `https://music.example.com/song/${track.id}` };
    case "copy":
      return {
        copyText: `${track.title} - ${track.artists.map((artist) => artist.name).join(" / ")}`,
      };
  }
});
```

The optional result can combine:

| Field      | Type      | Effect                                    |
| ---------- | --------- | ----------------------------------------- |
| `toast`    | `string?` | Show a toast                              |
| `openUrl`  | `string?` | Open an HTTP(S) URL in the system browser |
| `copyText` | `string?` | Copy text to the clipboard                |

Handlers have no DOM and cannot create custom windows. Network requests require `network`; playback controls require `control`; menu registration itself requires `ui`.

## Update support

Declare `@updateUrl` for host-managed version checks and in-place updates that preserve settings and data. See [Plugin Updates](/en/plugins/update).

## Complete example

This plugin sends the current lyric and optional translation to a local service:

```js
/**
 * @name Lyric Bridge
 * @id you.lyric-bridge
 * @version 1.0.0
 * @type control
 * @apiLevel 2
 * @grant network
 */
splayer.register({
  events: ["trackChange", "lyricChange", "lineChange"],
  settings: [
    { key: "port", type: "number", label: "Port", default: 50063, min: 1024, max: 65535 },
    { key: "showTranslation", type: "switch", label: "Show translation", default: true },
    { key: "showNextLine", type: "switch", label: "Show next line as fallback", default: true },
  ],
});

const post = (lyric, extra) => {
  const port = splayer.getSetting("port") || 50063;
  splayer
    .request(`http://127.0.0.1:${port}/component/lyrics/lyrics/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyric, extra }),
    })
    .catch(() => {});
};

const lineText = (line) => (line?.words ? line.words.map((word) => word.word).join("") : "");
let lines = [];

splayer.player.on("trackChange", ({ track }) => {
  if (track) post(track.title, track.artists.map((artist) => artist.name).join(" / "));
});
splayer.player.on("lyricChange", (data) => (lines = data.lines || []));
splayer.player.on("lineChange", ({ index }) => {
  const current = lines[index];
  const lyric = lineText(current);
  const extra =
    splayer.getSetting("showTranslation") && current?.translatedLyric
      ? current.translatedLyric
      : splayer.getSetting("showNextLine")
        ? lineText(lines[index + 1])
        : "";
  post(lyric, extra);
});
```

## Debugging

```js
await window.api.plugins.setSetting("lyric-bridge-splayer", "showTranslation", false);
await window.api.plugins.list();
```

Plugin logs are written to `{userData}/app-data/logs/`.
