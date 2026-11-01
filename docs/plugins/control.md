# 播放控制

通过订阅播放事件、调用播放方法控制播放器。设置、菜单和其他共用方法见[通用 API](/plugins/api)。

## 快速开始

```js
/**
 * @name 播放控制示例
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

## 能力注册 {#register}

通过 [`splayer.register`](/plugins/api#register) 声明要订阅的 `events`，以及播放控制标记 `controls`。事件取值见[事件类型](#event-types)。

## 播放事件 {#events}

### 订阅方式 {#subscribe}

监听已在 `register.events` 声明的播放事件。插件就绪时会收到订阅事件的当前状态快照。

**调用：** `splayer.player.on(kind, handler)`

**API 版本：** 2

**权限：** 无

**参数：**

- `kind`（[PlaybackEventKind](#event-types)）：要监听的事件。
- `handler`（`(data) => void`）：接收对应事件载荷的回调，可为同一事件注册多个回调。

**返回：** `void`。

### 事件类型 {#event-types}

`events` 数组和 `player.on` 的 `kind` 使用以下四种值：

| `kind`            | 载荷                                                              | 说明                                                     |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `trackChange`     | `{ track: Track \| null }`                                        | 当前曲目；无曲目时为 `null`                              |
| `lyricChange`     | `{ lines: LyricLine[] }`                                          | 当前曲目的完整解析歌词                                   |
| `lineChange`      | `{ index: number, position: number }`                             | 歌词行索引变化；`-1` 表示无匹配行，`position` 为毫秒进度 |
| `playStateChange` | `{ state: "playing" \| "paused" \| "stopped", position: number }` | 播放状态变化，`position` 为毫秒进度                      |

曲目结构见 [Track](/types#track)，歌词结构见 [LyricLine](/types#lyricline)。

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

## 播放控制 {#playback}

返回 `void` 的方法为即发即忘，参数无效时不执行。连续跟踪进度可使用事件中的 `position`。

### 恢复播放 {#play}

恢复当前曲目的播放。

**调用：** `splayer.player.play()`

**API 版本：** 2

**权限：** `control`

**参数：** 无。

**返回：** `void`。

### 暂停播放 {#pause}

暂停当前曲目。

**调用：** `splayer.player.pause()`

**API 版本：** 2

**权限：** `control`

**参数：** 无。

**返回：** `void`。

### 下一首 {#next}

切换到队列中的下一首。

**调用：** `splayer.player.next()`

**API 版本：** 2

**权限：** `control`

**参数：** 无。

**返回：** `void`。

### 上一首 {#prev}

切换到队列中的上一首。

**调用：** `splayer.player.prev()`

**API 版本：** 2

**权限：** `control`

**参数：** 无。

**返回：** `void`。

### 跳转进度 {#seek}

跳转到指定播放位置。

**调用：** `splayer.player.seek(positionMs)`

**API 版本：** 2

**权限：** `control`

**参数：**

- `positionMs`（`number`）：非负播放位置，单位为毫秒。

**返回：** `void`。

### 设置音量 {#volume}

调整播放器音量。

**调用：** `splayer.player.setVolume(volume)`

**API 版本：** 2

**权限：** `control`

**参数：**

- `volume`（`number`）：音量，范围为 0–1。

**返回：** `void`。

### 读取进度 {#position}

读取当前播放进度，单位为毫秒。

**调用：** `splayer.player.getPosition()`

**API 版本：** 2

**权限：** `control`

**参数：** 无。

**返回：** `Promise<number>`。

### 停止播放 {#stop}

停止当前曲目的播放。

**调用：** `splayer.player.stop()`

**API 版本：** 4

**权限：** `control`

**参数：** 无。

**返回：** `Promise<void>`。

::: code-group

```js [播放与暂停]
splayer.player.play();
splayer.player.pause();
```

```js [切换曲目]
splayer.player.next();
splayer.player.prev();
```

```js [进度与音量]
splayer.player.seek(30000);
splayer.player.setVolume(0.5);
const position = await splayer.player.getPosition();
```

```js [停止]
await splayer.player.stop();
```

:::

### 播放曲目 {#play-track}

播放指定曲目。

**调用：** `splayer.player.playTrack(track)`

**API 版本：** 4

**权限：** `control`

**参数：**

- `track`（[Track](/types#track)）：要播放的完整曲目，使用搜索结果或播放事件中的曲目对象。

**返回：** `Promise<{ id: string; source: Track["source"] }>`。完成表示已发送播放请求，实际状态见[播放事件](#events)。

```js
/**
 * @name 搜索并播放
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

### 加入队列 {#queue}

将曲目加入播放队列。

**调用：** `splayer.player.addToQueue(tracks, position?)`

**API 版本：** 4

**权限：** `control`

**参数：**

- `tracks`（`Track[]`）：1–50 个完整曲目对象
- `position`（`"next" | "end"`）：可选，默认 `next`（当前曲目之后），`end` 为队列末尾

**返回：** `Promise<{ count: number }>`，`count` 为提交入队的曲目数。

```js
const { tracks } = await splayer.music.searchLibrary("demo", 10);
if (tracks.length) await splayer.player.addToQueue(tracks, "end");
```

此示例同时使用 `music.searchLibrary`，对应权限为 `library`。

### 播放模式 {#play-mode}

设置播放模式，至少传入一个字段，未传入的字段保持不变。

**调用：** `splayer.player.setPlayMode(mode)`

**API 版本：** 4

**权限：** `control`

**参数：**

- `mode.repeat`（`"list" | "one"`）：可选，列表循环或单曲循环
- `mode.shuffle`（`"on" | "off"`）：可选，开启或关闭随机播放

**返回：** `Promise<void>`。

```js
await splayer.player.setPlayMode({ repeat: "list", shuffle: "on" });
```

## 状态查询 {#queries}

### 播放状态 {#status}

读取播放状态，无参数。

**调用：** `splayer.player.getStatus()`

**API 版本：** 4

**权限：** `control`

**返回：** `Promise<PlaybackStatusSnapshot>`。

| 字段                        | 类型              | 说明                                                                     |
| --------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `state`                     | `PlayerState`     | `idle`、`loading`、`playing`、`paused` 或 `stopped`                      |
| `positionMs` / `durationMs` | `number`          | 当前进度 / 总时长，毫秒                                                  |
| `volume`                    | `number`          | 音量，0–1                                                                |
| `isFinished`                | `boolean`         | 是否播放结束                                                             |
| `currentIndex`              | `number`          | 当前曲目在整个队列中的索引，从 0 开始；无当前队列项时为 -1。API 5 起支持 |
| `repeat`                    | `"list" \| "one"` | 循环模式                                                                 |
| `shuffle`                   | `"on" \| "off"`   | 随机模式                                                                 |

```js
const status = await splayer.player.getStatus();
splayer.log.info(status.state, status.positionMs);
```

### 播放队列 {#get-queue}

按当前播放顺序读取队列，随机播放时返回打乱后的顺序。

**调用：** `splayer.player.getQueue(options?)`

**API 版本：** 5

**权限：** `control`

**参数：**

- `options.offset`（`number`）：可选，从 0 开始的队列偏移，默认 `0`
- `options.limit`（`number`）：可选，返回条数，范围 1–100，默认 `50`

**返回：** `Promise<PlaybackQueueSnapshot>`。

| 字段           | 类型      | 说明                                                         |
| -------------- | --------- | ------------------------------------------------------------ |
| `tracks`       | `Track[]` | 当前页曲目，结构见 [Track](/types#track)                     |
| `total`        | `number`  | 整个队列的曲目数                                             |
| `currentIndex` | `number`  | 当前曲目在整个队列中的索引，从 0 开始；无当前队列项时为 `-1` |
| `offset`       | `number`  | 本次查询的队列偏移                                           |

```js
const status = await splayer.player.getStatus();
const queue = await splayer.player.getQueue({
  offset: Math.max(0, status.currentIndex - 10),
  limit: 21,
});
splayer.log.info(queue.tracks, queue.currentIndex, queue.total);
```

偏移超出队列时，`tracks` 为空。每次调用读取当时的队列；主窗口尚未就绪或未响应时，Promise 拒绝。

### 当前曲目 {#now-playing}

读取当前曲目的轻量快照，无参数，不含完整歌词。

**调用：** `splayer.player.getNowPlaying()`

**API 版本：** 4

**权限：** `control`

**返回：** Promise，包含下列字段。

| 字段             | 类型            | 说明                           |
| ---------------- | --------------- | ------------------------------ |
| `track`          | `Track \| null` | 当前曲目                       |
| `position`       | `number`        | 进度，毫秒                     |
| `state`          | `PlayerState`   | 播放状态，同 `getStatus.state` |
| `playing`        | `boolean`       | 是否正在播放                   |
| `speed`          | `number`        | 播放速度倍率                   |
| `lyricOffsetMs`  | `number`        | 歌词偏移，毫秒                 |
| `lyricAvailable` | `boolean`       | 是否有歌词                     |
| `lyricLineCount` | `number`        | 歌词行数                       |
| `sendTimestamp`  | `number`        | 进度快照时间戳，毫秒           |

```js
const now = await splayer.player.getNowPlaying();
splayer.log.info(now.track?.title, now.position);
```
