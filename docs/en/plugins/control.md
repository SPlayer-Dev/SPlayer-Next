# Playback control

Subscribe to playback events and control the player. Settings, menus, and other shared methods are covered in [Common APIs](/en/plugins/api).

## Quick start

```js
/**
 * @name Playback example
 * @id you.playback-example
 * @version 1.0.0
 * @apiLevel 2
 * @grant control
 */
splayer.register({
  events: ["trackChange"],
  controls: true,
});
splayer.player.on("trackChange", ({ track }) => {
  if (track) splayer.log.info(track.title);
});
splayer.player.setVolume(0.5);
```

## Registration {#register}

Use [`splayer.register`](/en/plugins/api#register) to declare `events` subscriptions and the `controls` playback-control marker. See [Event types](#event-types) for supported events.

## Playback events {#events}

### Subscribing {#subscribe}

Listens to events declared in `register.events`. Initial snapshots of subscribed events are sent when the plugin becomes ready.

**Call:** `splayer.player.on(kind, handler)`

**API version:** 2

**Permission:** None

**Parameters:**

- `kind` ([PlaybackEventKind](#event-types)): Event to observe.
- `handler` (`(data) => void`): Callback receiving the payload; multiple handlers can observe the same event.

**Returns:** `void`.

### Event types {#event-types}

Use these four values in the `events` array and as `player.on`’s `kind`:

| `kind`            | Payload                                                           | Description                                                                 |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `trackChange`     | `{ track: Track \| null }`                                        | Current track, or `null`                                                    |
| `lyricChange`     | `{ lines: LyricLine[] }`                                          | Complete parsed lyrics for the current track                                |
| `lineChange`      | `{ index: number, position: number }`                             | Lyric line index change; `-1` means no match, `position` is in milliseconds |
| `playStateChange` | `{ state: "playing" \| "paused" \| "stopped", position: number }` | Playback state change, position in milliseconds                             |

See [Track](/en/types#track) and [LyricLine](/en/types#lyricline) for data structures.

```js
splayer.register({ events: ["lyricChange", "lineChange"] });
let lines = [];
splayer.player.on("lyricChange", (data) => {
  lines = data.lines;
});
splayer.player.on("lineChange", ({ index }) => {
  const text = lines[index]?.words.map((word) => word.word).join("") ?? "";
  splayer.log.info(text);
});
```

## Playback controls {#playback}

Methods returning `void` are fire-and-forget; invalid parameters are ignored. For ongoing progress updates, use event `position` values.

### Resume playback {#play}

Resumes playback of the current track.

**Call:** `splayer.player.play()`

**API version:** 2

**Permission:** `control`

**Parameters:** None.

**Returns:** `void`.

### Pause playback {#pause}

Pauses the current track.

**Call:** `splayer.player.pause()`

**API version:** 2

**Permission:** `control`

**Parameters:** None.

**Returns:** `void`.

### Next track {#next}

Switches to the next track in the queue.

**Call:** `splayer.player.next()`

**API version:** 2

**Permission:** `control`

**Parameters:** None.

**Returns:** `void`.

### Previous track {#prev}

Switches to the previous track in the queue.

**Call:** `splayer.player.prev()`

**API version:** 2

**Permission:** `control`

**Parameters:** None.

**Returns:** `void`.

### Seek {#seek}

Seeks to the specified playback position.

**Call:** `splayer.player.seek(positionMs)`

**API version:** 2

**Permission:** `control`

**Parameters:**

- `positionMs` (`number`): Non-negative playback position in milliseconds.

**Returns:** `void`.

### Set volume {#volume}

Adjusts the player volume.

**Call:** `splayer.player.setVolume(volume)`

**API version:** 2

**Permission:** `control`

**Parameters:**

- `volume` (`number`): Volume from 0 to 1.

**Returns:** `void`.

### Read position {#position}

Reads the current playback position in milliseconds.

**Call:** `splayer.player.getPosition()`

**API version:** 2

**Permission:** `control`

**Parameters:** None.

**Returns:** `Promise<number>`.

### Stop playback {#stop}

Stops playback of the current track.

**Call:** `splayer.player.stop()`

**API version:** 4

**Permission:** `control`

**Parameters:** None.

**Returns:** `Promise<void>`.

::: code-group

```js [Play and pause]
splayer.player.play();
splayer.player.pause();
```

```js [Change tracks]
splayer.player.next();
splayer.player.prev();
```

```js [Position and volume]
splayer.player.seek(30000);
splayer.player.setVolume(0.5);
const position = await splayer.player.getPosition();
```

```js [Stop]
await splayer.player.stop();
```

:::

### Play a track {#play-track}

Requests playback of a track.

**Call:** `splayer.player.playTrack(track)`

**API version:** 4

**Permission:** `control`

**Parameters:**

- `track` ([Track](/en/types#track)): Complete track to play, from search results or a playback event.

**Returns:** `Promise<{ id: string; source: Track["source"] }>`. Resolution confirms the request was sent; observe [playback events](#events) for the actual state.

```js
/**
 * @name Search and play
 * @id you.search-and-play
 * @version 1.0.0
 * @apiLevel 4
 * @grant network control
 */
splayer.register({ controls: true });
async function playFirst(query) {
  const { tracks } = await splayer.music.searchOnline({ platform: "netease", query, limit: 1 });
  if (tracks.length) await splayer.player.playTrack(tracks[0]);
}
playFirst("demo").catch((error) => splayer.log.error(error));
```

### Add to queue {#queue}

Adds tracks to the playback queue.

**Call:** `splayer.player.addToQueue(tracks, position?)`

**API version:** 4

**Permission:** `control`

**Parameters:**

- `tracks` (`Track[]`): 1–50 complete track objects
- `position` (`"next" | "end"`): Optional; default `next` (after the current track), or `end`

**Returns:** `Promise<{ count: number }>`, with the number of tracks submitted.

```js
const { tracks } = await splayer.music.searchLibrary("demo", 10);
if (tracks.length) await splayer.player.addToQueue(tracks, "end");
```

This example also uses `music.searchLibrary`, which requires `library`.

### Playback modes {#play-mode}

Sets playback modes. Supply at least one field; omitted fields remain unchanged.

**Call:** `splayer.player.setPlayMode(mode)`

**API version:** 4

**Permission:** `control`

**Parameters:**

- `mode.repeat` (`"list" | "one"`): Optional list or single-track repeat
- `mode.shuffle` (`"on" | "off"`): Optional shuffle switch

**Returns:** `Promise<void>`.

```js
await splayer.player.setPlayMode({ repeat: "list", shuffle: "on" });
```

## Status queries {#queries}

### Playback status {#status}

Reads playback status. No parameters.

**Call:** `splayer.player.getStatus()`

**API version:** 4

**Permission:** `control`

**Returns:** `Promise<PlaybackStatusSnapshot>`.

| Field                       | Type              | Description                                                                     |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `state`                     | `PlayerState`     | `idle`, `loading`, `playing`, `paused`, or `stopped`                            |
| `positionMs` / `durationMs` | `number`          | Position / duration in milliseconds                                             |
| `volume`                    | `number`          | Volume, 0–1                                                                     |
| `isFinished`                | `boolean`         | Whether playback has finished                                                   |
| `currentIndex`              | `number`          | Zero-based index in the entire queue; -1 when no queue item is selected. API 5+ |
| `repeat`                    | `"list" \| "one"` | Repeat mode                                                                     |
| `shuffle`                   | `"on" \| "off"`   | Shuffle mode                                                                    |

```js
const status = await splayer.player.getStatus();
splayer.log.info(status.state, status.positionMs);
```

### Playback queue {#get-queue}

Read the queue in its current playback order, including the shuffled order when shuffle is on.

**Call:** `splayer.player.getQueue(options?)`

**API version:** 5

**Permission:** `control`

**Parameters:**

- `options.offset` (`number`): Optional, zero-based queue offset; defaults to `0`
- `options.limit` (`number`): Optional, number of tracks to return, from 1 to 100; defaults to `50`

**Returns:** `Promise<PlaybackQueueSnapshot>`.

| Field          | Type      | Description                                                                                    |
| -------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `tracks`       | `Track[]` | Tracks in this page; see [Track](/en/types#track)                                              |
| `total`        | `number`  | Total tracks in the queue                                                                      |
| `currentIndex` | `number`  | Zero-based index of the current track in the entire queue; `-1` when no queue item is selected |
| `offset`       | `number`  | Queue offset used for this request                                                             |

```js
const status = await splayer.player.getStatus();
const queue = await splayer.player.getQueue({
  offset: Math.max(0, status.currentIndex - 10),
  limit: 21,
});
splayer.log.info(queue.tracks, queue.currentIndex, queue.total);
```

An offset beyond the queue returns an empty `tracks` array. Each call reads the queue at that moment. The Promise rejects if the main window is unavailable or does not respond.

### Current track {#now-playing}

Reads a lightweight current-track snapshot without full lyrics. No parameters.

**Call:** `splayer.player.getNowPlaying()`

**API version:** 4

**Permission:** `control`

**Returns:** A Promise containing the following fields.

| Field            | Type            | Description                                 |
| ---------------- | --------------- | ------------------------------------------- |
| `track`          | `Track \| null` | Current track                               |
| `position`       | `number`        | Position in milliseconds                    |
| `state`          | `PlayerState`   | Playback state, as in `getStatus.state`     |
| `playing`        | `boolean`       | Whether playback is active                  |
| `speed`          | `number`        | Playback speed multiplier                   |
| `lyricOffsetMs`  | `number`        | Lyric offset in milliseconds                |
| `lyricAvailable` | `boolean`       | Whether lyrics are available                |
| `lyricLineCount` | `number`        | Number of lyric lines                       |
| `sendTimestamp`  | `number`        | Position snapshot timestamp in milliseconds |

```js
const now = await splayer.player.getNowPlaying();
splayer.log.info(now.track?.title, now.position);
```
