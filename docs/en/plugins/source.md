# Source Plugins

A source plugin (`@type source`) provides playable URLs when the built-in provider cannot return one. It can also supply fallback lyrics, covers, and comments for online, local, and streaming tracks.

Read [Plugin Overview](/en/plugins/) first for common APIs such as `request`, `storage`, `log`, and `utils`.

## How resolution works

1. The player maps an online track to a source key and selects enabled, ready plugins registered for that key.
2. It calls `musicUrl` with the platform track ID and requested quality.
3. The plugin calls its service and returns `{ url }`.
4. The first non-empty URL is played. An exception or empty URL moves to the next plugin.

::: warning Source keys must match platforms
Playback currently recognizes the LX community keys `wy`, `tx`, and `kg`. Other keys can be registered and used for metadata fallback, but they are not selected for playback URL resolution.
:::

## Quick start

```js
/**
 * @name        Example
 * @id          you.example
 * @version     1.0.0
 * @description Example source
 * @author      you
 * @type        source
 * @apiLevel    1
 */

splayer.register({
  sources: {
    wy: {
      name: "Example source",
      actions: ["musicUrl"],
      qualities: ["lq", "hq", "lossless"],
    },
  },
});

splayer.on("musicUrl", async ({ musicInfo, quality }) => {
  const response = await splayer.request(
    `https://api.example.com/url?id=${musicInfo.songmid}&q=${quality}`,
    { responseType: "json" },
  );
  if (!response.body?.url) throw new Error("no url");
  return { url: response.body.url, quality, expire: response.body.expire };
});
```

Save as `example.js` and import it under **Settings → Plugin Management → Local import**. `@type source` may be omitted. URL, lyric, and cover features require API level 1; comments require level 3.

## `splayer.register(capabilities)`

Call registration synchronously while the script loads:

```js
splayer.register({
  sources: {
    wy: {
      name: "Example source",
      actions: ["musicUrl"],
      qualities: ["lq", "sq", "hq", "lossless", "hi-res"],
    },
  },
});
```

| Source field | Type        | Required | Description                                                         |
| ------------ | ----------- | -------- | ------------------------------------------------------------------- |
| `name`       | `string`    | Yes      | Display name                                                        |
| `actions`    | `Action[]`  | Yes      | `musicUrl`, `musicSearch`, `musicLyric`, `musicPic`, `musicComment` |
| `qualities`  | `Quality[]` |          | Supported qualities, for display only                               |

| Quality    | Meaning                                    |
| ---------- | ------------------------------------------ |
| `hi-res`   | Sample rate ≥96 kHz and bit depth ≥24 bit  |
| `lossless` | FLAC, APE, WAV, or another lossless format |
| `hq`       | Lossy ≥320 kbps                            |
| `sq`       | Lossy ≥192 kbps                            |
| `lq`       | Lossy below 192 kbps                       |

## `splayer.on("musicUrl", handler)`

Only one handler exists per action; a later registration replaces the previous one.

```js
{
  source: "wy",
  quality: "hq",
  musicInfo: { /* ... */ },
}
```

`musicInfo.id`, `songmid`, and `songId` are aliases for the same platform track ID.

| Field      | Type             | Description                                       |
| ---------- | ---------------- | ------------------------------------------------- |
| `id`       | `string`         | Platform track ID                                 |
| `songmid`  | `string`         | Alias of `id`                                     |
| `songId`   | `string`         | Alias of `id`                                     |
| `name`     | `string`         | Track title                                       |
| `singer`   | `string`         | Artists joined with `/`                           |
| `source`   | `string`         | Source key                                        |
| `interval` | `string \| null` | Duration as `mm:ss`, or `null`                    |
| `meta`     | `object`         | Additional `albumName`, `albumId`, `picUrl`, etc. |

Return:

| Field     | Type      | Required | Description                              |
| --------- | --------- | -------- | ---------------------------------------- |
| `url`     | `string`  | Yes      | Non-empty playback URL                   |
| `quality` | `Quality` |          | Actual quality if downgraded             |
| `expire`  | `number`  |          | URL expiration timestamp in milliseconds |

Throw an error when no result exists. The player tries the next plugin. Handlers normally time out after 20 seconds and are cancelled after a track change.

## Supporting multiple platforms

Register multiple source keys, then dispatch the single `musicUrl` handler by `req.source`:

```js
splayer.register({
  sources: {
    wy: { name: "WY", actions: ["musicUrl"], qualities: ["hq", "lossless"] },
    tx: { name: "TX", actions: ["musicUrl"], qualities: ["hq"] },
  },
});

splayer.on("musicUrl", async (request) => {
  const id = request.musicInfo.songmid;
  const url =
    request.source === "wy"
      ? await resolveWy(id, request.quality)
      : await resolveTx(id, request.quality);
  if (!url) throw new Error("no url");
  return { url, quality: request.quality };
});
```

## Metadata fallback {#metadata-fallback}

The host orchestrates matching while the plugin supplies primitives:

- `musicSearch` finds candidates.
- `musicLyric`, `musicPic`, and `musicComment` receive the selected candidate.
- Metadata source keys are not limited to `wy`, `tx`, and `kg`.
- Candidate scoring uses name, artist, album, and duration. If both durations are present and differ by more than 20 seconds, the candidate is rejected.

```js
splayer.register({
  sources: {
    kw: {
      name: "KW",
      actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"],
    },
  },
});
```

### `musicSearch`

Request: `{ source, keyword, page?, limit? }`. Return `{ list: Candidate[] }`.

| Candidate field | Type     | Required | Description                                          |
| --------------- | -------- | -------- | ---------------------------------------------------- |
| `id`            | `string` | Yes      | ID used by later metadata handlers                   |
| `name`          | `string` | Yes      | Track title                                          |
| `singer`        | `string` |          | Artist                                               |
| `album`         | `string` |          | Album                                                |
| `durationMs`    | `number` |          | Duration; strongly recommended for accurate matching |

All additional candidate fields are passed unchanged to subsequent handlers.

### `musicLyric`

Request: `{ source, musicInfo }`. Return:

| Field     | Type     | Required | Description                    |
| --------- | -------- | -------- | ------------------------------ |
| `lyric`   | `string` | Yes      | Main LRC or line-timed lyrics  |
| `tlyric`  | `string` |          | Translation                    |
| `rlyric`  | `string` |          | Romanization                   |
| `awlyric` | `string` |          | Word-timed YRC, QRC, LYS, etc. |

Word-timed `awlyric` takes precedence. An empty `lyric` is treated as no result.

### `musicPic`

Request: `{ source, musicInfo }`. Return `{ url }` with a direct image URL. Use a large image because it supplies both the visible player cover and background.

### `musicComment`

Requires `@apiLevel 3`.

```js
{
  source: "kw",
  musicInfo: { /* matched candidate */ },
  type: "hot", // or "new"
  page: 1,
  limit: 20,
}
```

Return `{ list, total, page, limit }`. Each comment requires `id`, `userName`, and `text`; optional fields are `userId`, `avatar`, `time`, `location`, `likedCount`, and nested `reply` summaries.

### Complete metadata example

```js
/**
 * @name     KW Metadata
 * @id       you.kw-metadata
 * @version  1.0.0
 * @type     source
 * @apiLevel 3
 */
splayer.register({
  sources: {
    kw: { name: "KW", actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"] },
  },
});

splayer.on("musicSearch", async ({ keyword }) => {
  const response = await splayer.request(
    `https://api.example.com/search?k=${encodeURIComponent(keyword)}`,
    { responseType: "json" },
  );
  return {
    list: (response.body?.songs ?? []).map((song) => ({
      id: song.rid,
      name: song.name,
      singer: song.artist,
      album: song.album,
      durationMs: song.duration * 1000,
    })),
  };
});

splayer.on("musicLyric", async ({ musicInfo }) => {
  const response = await splayer.request(`https://api.example.com/lyric?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { lyric: response.body?.lrc ?? "", tlyric: response.body?.tlrc };
});

splayer.on("musicPic", async ({ musicInfo }) => {
  const response = await splayer.request(`https://api.example.com/pic?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { url: response.body?.cover ?? "" };
});
```

### Trigger order

- Lyrics fallback applies to online, local, and streaming tracks. Built-in providers or the streaming server are tried first; plugins follow in user priority order.
- Cover fallback applies only when a track from any source has no cover at all.
- Comment sources appear only when they declare both `musicSearch` and `musicComment`.
- Source plugins receive network permission automatically.

## Priority and updates

Multiple source plugins can be enabled for one platform. They are tried by the priority configured in Plugin Management. Declare `@updateUrl` for host-managed updates; LX scripts can use `updateAlert`. See [Plugin Updates](/en/plugins/update).

## LX compatibility

The automatically injected `lx` compatibility layer implements common `user_api` APIs, including `lx.request`, `lx.on("request")`, `lx.send("inited")`, and `lx.utils`. Most existing LX source scripts, including `gz_` packages, need no modification. New plugins should use `splayer.*` directly.

## Debugging

```js
await window.api.plugins.resolveUrl({
  pluginId: "example-splayer",
  source: "wy",
  quality: "hq",
  musicInfo: { songmid: "track-id", name: "Title", singer: "Artist" },
});

const track = {
  id: "x",
  source: "local",
  title: "Title",
  artists: [{ name: "Artist" }],
  duration: 269000,
};
await window.api.plugins.matchLyric({ pluginId: "kw-metadata-splayer", source: "kw", track });
await window.api.plugins.matchCover({ pluginId: "kw-metadata-splayer", source: "kw", track });
```
