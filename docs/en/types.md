# Type Reference

These are the objects delivered to plugin callbacks and handlers. A `?` marks an optional field.

## Tracks

### Track

The `track` payload for [`trackChange`](/en/plugins/control#events) and [`menuClick`](/en/plugins/api#menus).

| Field           | Type                               | Description                                           |
| --------------- | ---------------------------------- | ----------------------------------------------------- |
| `id`            | `string`                           | Track ID                                              |
| `extId`         | `string?`                          | Secondary ID                                          |
| `source`        | [`TrackSource`](#tracksource)      | Track source                                          |
| `plugin`        | [Plugin source](#plugin-source)`?` | Independent plugin source information, added in API 5 |
| `path`          | `string?`                          | Local file path                                       |
| `cuePath`       | `string?`                          | CUE file path                                         |
| `cueAudioPath`  | `string?`                          | Audio file referenced by the CUE                      |
| `cueStartMs`    | `number?`                          | CUE segment start in milliseconds                     |
| `cueEndMs`      | `number?`                          | CUE segment end in milliseconds                       |
| `serverId`      | `string?`                          | Streaming server instance ID                          |
| `originalId`    | `string?`                          | Server-native track ID                                |
| `title`         | `string`                           | Title                                                 |
| `comment`       | `string?`                          | Comment or subtitle                                   |
| `artists`       | [`Artist[]`](#artist)              | Artists                                               |
| `album`         | [`Album`](#album)`?`               | Album                                                 |
| `track`         | `number?`                          | Track number                                          |
| `duration`      | `number`                           | Duration in milliseconds                              |
| `cover`         | `string?`                          | Cover URL                                             |
| `coverOriginal` | `string?`                          | Original cover URL                                    |
| `fileSize`      | `number?`                          | File size in bytes                                    |
| `mtime`         | `number?`                          | Modification time in Unix milliseconds                |
| `ctime`         | `number?`                          | Creation time in Unix milliseconds                    |
| `quality`       | [`AudioQuality`](#audioquality)`?` | Audio quality                                         |
| `fee`           | [`TrackFee`](#trackfee)`?`         | Access fee flag                                       |
| `cloud`         | `boolean?`                         | Whether this is a cloud-library track                 |

### TrackSource

`"local"`, `"streaming"`, `"plugin"` for independent plugin sources, or one of the built-in platforms: `"netease"`, `"qqmusic"`, and `"kugou"`.

### Plugin source {#plugin-source}

For `source: "plugin"`, the `plugin` field is required. The host generates it from a [search candidate](/en/plugins/source#musicsearch).

| Field       | Type        | Description                                                                                        |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `pluginId`  | `string`    | Owning plugin's `@id`                                                                              |
| `source`    | `string`    | Registered source key                                                                              |
| `musicInfo` | `Candidate` | Original search candidate, including the source track ID and fields needed for subsequent requests |

The host generates a unique `Track.id`; the original track ID remains in `plugin.musicInfo.id`. Pass the complete `Track` when playing or adding it to the queue, preserving `plugin` for queue recovery and later resolution.

### TrackFee

Fee flag: `0` free, `1` VIP, `4` purchase required, and `8` quality restricted.

### Artist

| Field        | Type      | Description |
| ------------ | --------- | ----------- |
| `id`         | `string?` | Artist ID   |
| `name`       | `string`  | Name        |
| `avatar`     | `string?` | Avatar URL  |
| `albumCount` | `number?` | Album count |

### Album

| Field        | Type      | Description  |
| ------------ | --------- | ------------ |
| `id`         | `string?` | Album ID     |
| `name`       | `string`  | Name         |
| `cover`      | `string?` | Cover URL    |
| `artist`     | `string?` | Album artist |
| `trackCount` | `number?` | Track count  |
| `year`       | `number?` | Release year |

### AudioQuality

| Field           | Type     | Description       |
| --------------- | -------- | ----------------- |
| `sampleRate`    | `number` | Sample rate in Hz |
| `channels`      | `number` | Channel count     |
| `bitsPerSample` | `number` | Bit depth         |
| `bitRate`       | `number` | Bit rate in bps   |
| `codec`         | `string` | Codec             |

## Lyrics

### LyricLine

One parsed lyric line. The `lines` payload in [`lyricChange`](/en/plugins/control#events) is `LyricLine[]`.

| Field             | Type                                     | Description                             |
| ----------------- | ---------------------------------------- | --------------------------------------- |
| `words`           | [`LyricWord[]`](#lyricword)              | Timed words; line-timed formats use one |
| `translatedLyric` | `string`                                 | Translation or an empty string          |
| `romanLyric`      | `string`                                 | Romanization or an empty string         |
| `startTime`       | `number`                                 | Line start in milliseconds              |
| `endTime`         | `number`                                 | Line end in milliseconds                |
| `isBG`            | `boolean`                                | Background-vocal line                   |
| `isDuet`          | `boolean`                                | Duet line, usually right-aligned        |
| `language`        | `"ja" \| "ko" \| "zh-CN" \| "und-Latn"?` | Main lyric language                     |

Plain text is `line.words.map((word) => word.word).join("")`.

### LyricWord

Extends [`LyricSpan`](#lyricspan) with:

| Field       | Type                           | Description         |
| ----------- | ------------------------------ | ------------------- |
| `romanWord` | `string?`                      | Word romanization   |
| `obscene`   | `boolean?`                     | Sensitive-word flag |
| `ruby`      | [`LyricSpan[]`](#lyricspan)`?` | Ruby annotation     |

### LyricSpan

| Field       | Type     | Description           |
| ----------- | -------- | --------------------- |
| `startTime` | `number` | Start in milliseconds |
| `endTime`   | `number` | End in milliseconds   |
| `word`      | `string` | Text                  |
