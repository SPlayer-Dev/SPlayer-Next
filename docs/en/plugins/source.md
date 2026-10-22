# Source resolution

Provide an independent catalog with search and playback, or add playback URLs, lyrics, covers, and comments for existing tracks. HTTP requests, storage, and utilities are covered in [Common APIs](/en/plugins/api).

## Sources and routing

### Independent sources {#independent}

A source declaring `musicSearch` appears under **Plugins** on the search page while its plugin is enabled and ready. Choose a source from the dropdown to search songs; other categories show the existing empty state. Declare `musicUrl` to play tracks from that source. Lyrics and covers also come from the owning plugin.

The host converts search candidates into [Track](/en/types#track) objects, retaining the plugin ID, source key, and candidate data. The queue saves this information so playback can request a fresh URL from the same plugin after an application restart. Keep plugin IDs, source keys, and track IDs stable across updates.

Disabling or uninstalling the plugin keeps its tracks in the queue, but makes them unavailable for playback. Enable or reinstall the same plugin to use them again.

### Built-in sources {#builtin}

Use the following source keys to resolve built-in sources. Playback URL resolution follows the user's plugin priority; the first valid result is used.

| Track platform identifier | Source key |
| ------------------------- | ---------- |
| `netease`                 | `wy`       |
| `qqmusic`                 | `tx`       |
| `kugou`                   | `kg`       |

## Quick start

This plugin provides a searchable catalog. Save it as a `.js` file, import it through Plugin Management, and search for “Example”.

```js
/**
 * @name Example library
 * @id you.example-library
 * @version 1.0.0
 * @apiLevel 5
 */
const catalog = [
  {
    id: "demo-1",
    name: "Example song",
    singer: "Example artist",
    album: "Example album",
    durationMs: 180000,
  },
];
splayer.register({
  sources: {
    example: {
      name: "Example library",
      actions: ["musicSearch", "musicUrl", "musicLyric", "musicPic"],
      qualities: ["hq"],
    },
  },
});
splayer.on("musicSearch", async ({ keyword, page = 1, limit = 20 }) => {
  const matches = catalog.filter((song) =>
    (song.name + " " + song.singer).toLowerCase().includes(keyword.toLowerCase()),
  );
  return { list: matches.slice((page - 1) * limit, page * limit), total: matches.length };
});
splayer.on("musicUrl", async ({ musicInfo }) => ({
  url: "https://media.example.com/" + encodeURIComponent(musicInfo.id) + ".mp3",
  quality: "hq",
}));
splayer.on("musicLyric", async () => ({ lyric: "[00:00.00]Example lyrics" }));
splayer.on("musicPic", async ({ musicInfo }) => ({
  url: "https://media.example.com/" + encodeURIComponent(musicInfo.id) + ".jpg",
}));
```

The media addresses are placeholders. Replace them with your own audio and cover URLs before playing. For a remote catalog, replace `musicSearch` with a service request returning the same candidate structure; see [Search tracks](#musicsearch).

## Source registration {#register}

Declares source capabilities during initialization.

**Call:** `splayer.register(args)`

**API version:** 1; independent source search and playback require 5.

**Permission:** None

**Parameters:**

- `args.sources` (`Record<string, SourceCapability>`): Source capabilities indexed by a source key within the plugin
- `args.sources[key].name` (`string`): Required display name
- `args.sources[key].actions` (`PluginAction[]`): Required; choose from [supported actions](#actions)
- `args.sources[key].qualities` ([Quality[]](#qualities)): Optional supported qualities

**Returns:** `void`. Multiple sources share each action handler; dispatch using the request's `source`.

### Supported actions {#actions}

Register a matching handler with `splayer.on` for each action.

| Action                          | Purpose           | Minimum level |
| ------------------------------- | ----------------- | ------------- |
| [`musicUrl`](#musicurl)         | Playback URL      | 1             |
| [`musicSearch`](#musicsearch)   | Search candidates | 1             |
| [`musicLyric`](#musiclyric)     | Fetch lyrics      | 1             |
| [`musicPic`](#musicpic)         | Fetch covers      | 1             |
| [`musicComment`](#musiccomment) | Fetch comments    | 3             |

### Quality levels {#qualities}

| `Quality`  | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `hi-res`   | High-resolution lossless, sample rate ≥ 96 kHz and bit depth ≥ 24 bit |
| `lossless` | Lossless                                                              |
| `hq`       | Lossy, bitrate ≥ 320 kbps                                             |
| `sq`       | Lossy, bitrate ≥ 192 kbps                                             |
| `lq`       | Lossy, bitrate < 192 kbps                                             |

## Source resolution {#resolution}

Register handlers with `splayer.on(action, handler)`, which returns `void`. `action` is the action name; `handler: (req) => Promise<res>` receives a host request and returns a result. Registering the same action again replaces its handler. Registration requires no permission; methods called inside a handler retain their own requirements.

`musicUrl` has a 20-second timeout; other source actions have 15 seconds. Throw when no result is available. Built-in source resolution can try another plugin; independent source playback calls only the owning plugin.

### Playback URL {#musicurl}

Provides a playable URL.

**Call:** `splayer.on("musicUrl", handler)`

**API version:** 1

**Permission:** None

**Parameters:**

- `source` (`string`): Requested source key
- `quality` (`Quality`): Requested quality
- `musicInfo` (`object`): For independent sources, the original search candidate plus `songmid` as an alias of `id`. Built-in sources receive the fields below

- `musicInfo.songmid / id / songId` (`string`): Aliases for the platform track ID
- `musicInfo.name` (`string`): Title
- `musicInfo.singer` (`string`): Artist names joined with `/`
- `musicInfo.source` (`string`): Source key
- `musicInfo.interval` (`string | null`): Duration as `mm:ss`, or `null`
- `musicInfo.img` (`string | null`): Cover URL
- `musicInfo.hash` (`string`): Optional track hash for sources that use one
- `musicInfo.albumId / albumName` (`string`): Album ID / name, empty when unknown
- `musicInfo.meta` (`object`): Additional album, cover, and other metadata

**Returns:** `Promise<{ url: string; quality?: Quality; expire?: number }>`.

| Result field | Type      | Description                                       |
| ------------ | --------- | ------------------------------------------------- |
| `url`        | `string`  | Required non-empty playback URL                   |
| `quality`    | `Quality` | Optional actual quality                           |
| `expire`     | `number`  | Optional URL expiration timestamp in milliseconds |

See [Quick start](#quick-start) for a call example. If the requested quality is unavailable, return a lower quality and identify it in `quality`.

### Search tracks {#musicsearch}

Returns independent source search results, or candidates for matching lyrics, covers, and other metadata.

**Call:** `splayer.on("musicSearch", handler)`

**API version:** 1

**Permission:** None

**Parameters:**

- `source` (`string`): Source key
- `keyword` (`string`): The user's search text; usually title and artist for metadata matching
- `page` (`number`): Optional page number, starting at 1
- `limit` (`number`): Optional page size, up to 50 for independent source searches

**Returns:** `Promise<{ list: Candidate[]; total?: number; hasMore?: boolean }>`. Return `{ list: [] }` when nothing matches. `total` is the matching result count; `hasMore` indicates whether another page exists. Both are supported from API 5.

For pagination, prefer an explicit `hasMore`, or return `total` when known. If both are omitted, the host assumes another page when the result count reaches `limit`.

| `Candidate` field | Type       | Description                                                      |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| `id`              | `string`   | Required source track ID                                         |
| `name`            | `string`   | Required title                                                   |
| `singer`          | `string`   | Optional artist                                                  |
| `album`           | `string`   | Optional album                                                   |
| `durationMs`      | `number`   | Optional duration in milliseconds, used for display and matching |
| `cover`           | `string`   | Optional cover URL, added in API 5                               |
| Other fields      | JSON value | Passed unchanged to subsequent handlers                          |

Independent source candidates are saved with the queue. Each serialized candidate is limited to 8 KiB; oversized or invalid entries are ignored. Retain only identifiers and lightweight fields needed to fetch resources again. Retrieve lyrics, image content, and temporary playback URLs on demand in their handlers.

```js
splayer.on("musicSearch", async ({ keyword, page = 1, limit = 20 }) => {
  const query = new URLSearchParams({ keyword, page: String(page), limit: String(limit) });
  const { body } = await splayer.request("https://api.example.com/search?" + query, {
    responseType: "json",
  });
  return {
    list: body.songs.map((song) => ({
      id: String(song.id),
      name: song.title,
      singer: song.artist,
      album: song.album,
      durationMs: song.durationMs,
      cover: song.cover,
    })),
    hasMore: body.hasMore,
  };
});
```

## Metadata extensions {#metadata-fallback}

### Matching flow {#matching}

Independent source lyrics and covers call the owning plugin directly with the original search candidate as `musicInfo`, without another search. A candidate's `cover` is used directly; `musicPic` is called only when no cover is available.

To add metadata for other sources, register `musicSearch` and any of `musicLyric`, `musicPic`, or `musicComment`. The host matches candidates by title, artist, album, and duration, then passes the selected candidate as `musicInfo`. A matching platform can use its track ID directly and skip search.

Lyrics fall back to plugins after built-in providers or the streaming server. Cover fallback runs only when a track has no cover. Comment sources appear in the comments view and require both `musicSearch` and `musicComment`.

::: tip Candidate duration
Provide `durationMs` when available. Candidates differing by more than 20 seconds are excluded when both durations are available.
:::

```js
splayer.register({
  sources: {
    custom: { name: "Example", actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"] },
  },
});
```

### Fetch lyrics {#musiclyric}

Returns lyrics for a track.

**Call:** `splayer.on("musicLyric", handler)`

**API version:** 1

**Permission:** None

**Parameters:**

- `source` (`string`): Source key.
- `musicInfo` (`Candidate`): The original independent source candidate, or a candidate selected by metadata matching.

**Returns:** `Promise<{ lyric: string; tlyric?: string; rlyric?: string; awlyric?: string }>`.

| Result field | Type     | Description                                      |
| ------------ | -------- | ------------------------------------------------ |
| `lyric`      | `string` | Required main lyrics, LRC or line text           |
| `tlyric`     | `string` | Optional translation                             |
| `rlyric`     | `string` | Optional romanization                            |
| `awlyric`    | `string` | Optional word-timed lyrics, format auto-detected |

Word-timed `awlyric` takes precedence. For metadata matching, the host tries other candidates when no usable lyrics are returned; independent sources use only their owning plugin.

```js
splayer.on("musicLyric", async ({ musicInfo }) => {
  const { body } = await splayer.request(
    "https://api.example.com/lyric?id=" + encodeURIComponent(musicInfo.id),
    { responseType: "json" },
  );
  return { lyric: body.lyric ?? "", tlyric: body.translation };
});
```

### Fetch covers {#musicpic}

Returns a track's cover.

**Call:** `splayer.on("musicPic", handler)`

**API version:** 1

**Permission:** None

**Parameters:**

- `source` (`string`): Source key.
- `musicInfo` (`Candidate`): The original independent source candidate, or a candidate selected by metadata matching.

**Returns:** `Promise<{ url: string }>`, a direct remote image URL; an empty URL means no result.

```js
splayer.on("musicPic", async ({ musicInfo }) => {
  const { body } = await splayer.request(
    "https://api.example.com/cover?id=" + encodeURIComponent(musicInfo.id),
    { responseType: "json" },
  );
  return { url: body.url ?? "" };
});
```

### Fetch comments {#musiccomment}

Returns a page of comments for the matched candidate.

**Call:** `splayer.on("musicComment", handler)`

**API version:** 3

**Permission:** None

**Parameters:**

- `source` (`string`): Source key
- `musicInfo` (`Candidate`): Matched candidate
- `type` (`"hot" | "new"`): Popular or latest comments
- `page` (`number`): Page number, starting at 1
- `limit` (`number`): Page size

**Returns:** `Promise<{ list: Comment[]; total: number; page: number; limit: number }>`, containing the current page, total count, page number, and page size.

| `Comment` field     | Type        | Description                            |
| ------------------- | ----------- | -------------------------------------- |
| `id`                | `string`    | Required comment ID                    |
| `userName`          | `string`    | Required user name                     |
| `text`              | `string`    | Required content                       |
| `userId` / `avatar` | `string`    | Optional user ID / avatar URL          |
| `time`              | `number`    | Optional timestamp in milliseconds     |
| `location`          | `string`    | Optional location                      |
| `likedCount`        | `number`    | Optional like count                    |
| `images`            | `string[]`  | Optional image URLs                    |
| `reply`             | `Comment[]` | Optional reply summaries               |
| `replyTotal`        | `number`    | Optional total reply count             |
| `hasMoreReply`      | `boolean`   | Optional indication of further replies |

```js
splayer.on("musicComment", async ({ musicInfo, type, page, limit }) => {
  const query = new URLSearchParams({
    id: musicInfo.id,
    type,
    page: String(page),
    limit: String(limit),
  });
  const { body } = await splayer.request("https://api.example.com/comments?" + query, {
    responseType: "json",
  });
  return {
    list: body.comments.map((comment) => ({
      id: String(comment.id),
      userName: comment.userName,
      text: comment.text,
    })),
    total: body.total,
    page,
    limit,
  };
});
```

## Updates and compatibility

See [Plugin Updates](/en/plugins/update) for releases and [LX Compatibility](/en/plugins/lx) for existing LX scripts.
