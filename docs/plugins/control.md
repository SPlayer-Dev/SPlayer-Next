# 控制插件

控制插件（`@type control`）不提供音源，而是**监听播放器状态**（曲目 / 歌词 / 播放态）、**反向控制播放**（播放、暂停、切歌、跳转、音量），并可**声明自己的设置项**让用户在插件管理里配置。典型用途如：将播放状态同步到 Discord、智能家居/灯效联动、第三方上报等。

阅读本文前请先了解 [插件总览与架构](/plugins/)，其中的通用 API 对控制插件同样适用。

::: warning 需要 apiLevel 2
脚本头部必须声明 `@type control` 与 `@apiLevel 2`，否则控制能力在运行时不可用。
:::

## 快速开始

```js
/**
 * @name        Example Control
 * @version     1.0.0
 * @description 示例控制插件
 * @author      you
 * @type        control
 * @apiLevel    2
 */

splayer.register({
  // 订阅需要的播放事件
  events: ["trackChange", "playStateChange", "lineChange"],
  // 声明会反向控制播放器
  controls: true,
  // 声明用户可配置项
  settings: [{ key: "enabled", type: "switch", label: "启用同步", default: true }],
});

splayer.player.on("trackChange", ({ track }) => {
  if (!track) return;
  splayer.log.info("正在播放：", track.title, "-", track.artists);
});

splayer.player.on("playStateChange", ({ state, position }) => {
  splayer.log.info("播放态：", state, "@", position, "ms");
});
```

保存为 `.js`，在 **设置 → 插件管理 → 本地导入** 即可使用。

## `splayer.register(args)`

控制插件用 `register` 声明三样东西，请在脚本同步执行阶段调用：

```js
splayer.register({
  events: ["trackChange", "lyricChange", "lineChange", "playStateChange"],
  controls: true,
  settings: [
    /* PluginSettingItem[] */
  ],
});
```

| 字段       | 类型                  | 必填 | 说明                                               |
| ---------- | --------------------- | ---- | -------------------------------------------------- |
| `events`   | `PlaybackEventKind[]` |      | 要订阅的播放事件，未声明的事件不会下发             |
| `controls` | `boolean`             |      | 是否使用反向播放控制（`splayer.player.play()` 等） |
| `settings` | `PluginSettingItem[]` |      | 用户可配置项，渲染到插件管理的设置弹窗             |

::: tip 只发订阅的事件
宿主只会向插件推送它在 `events` 里声明过的事件，未声明的不会推送。插件启用时，宿主会立即补发一次当前状态快照（当前曲目、歌词、播放态、当前行），无需自己拉取初始值。
:::

## 监听播放事件

```js
splayer.player.on(kind, (data) => { ... });
```

支持的事件类型与载荷：

### `trackChange` — 曲目切换

| 字段             | 类型             | 说明                     |
| ---------------- | ---------------- | ------------------------ |
| `track`          | `object \| null` | 当前曲目，`null` 表示无  |
| `track.title`    | `string`         | 标题                     |
| `track.artists`  | `string`         | 艺术家（已用 `, ` 拼接） |
| `track.album`    | `string?`        | 专辑名                   |
| `track.duration` | `number`         | 时长（毫秒）             |
| `track.cover`    | `string?`        | 封面地址                 |

### `lyricChange` — 歌词整体变化

| 字段    | 类型          | 说明                   |
| ------- | ------------- | ---------------------- |
| `lines` | `LyricLine[]` | 当前曲目的完整解析歌词 |

`LyricLine`（一行歌词）的全部字段：

| 字段              | 类型          | 说明                                         |
| ----------------- | ------------- | -------------------------------------------- |
| `words`           | `LyricWord[]` | 该行逐字内容（见下）；逐行格式时只有一个元素 |
| `translatedLyric` | `string`      | 该行翻译，无则为空串                         |
| `romanLyric`      | `string`      | 该行音译 / 罗马音，无则为空串                |
| `startTime`       | `number`      | 行起始时间（毫秒）                           |
| `endTime`         | `number`      | 行结束时间（毫秒）                           |
| `isBG`            | `boolean`     | 是否为背景和声行                             |
| `isDuet`          | `boolean`     | 是否为对唱行（通常右对齐显示）               |

其中 `LyricWord`（逐字）：

| 字段        | 类型           | 说明                               |
| ----------- | -------------- | ---------------------------------- |
| `word`      | `string`       | 字 / 词文本                        |
| `startTime` | `number`       | 该字起始时间（毫秒）               |
| `endTime`   | `number`       | 该字结束时间（毫秒）               |
| `romanWord` | `string?`      | 该字的音译                         |
| `obscene`   | `boolean?`     | 是否敏感词                         |
| `ruby`      | `LyricSpan[]?` | 注音（如日文假名标注），通常用不到 |

整行纯文本：`line.words.map((w) => w.word).join("")`。逐行（LRC 类）歌词的逐字时间通常与行时间一致，不必关心 `words` 内部时间。

### `lineChange` — 当前歌词行变化

仅当**当前行索引**改变时下发，配合 `lyricChange` 缓存的 `lines` 使用。

| 字段       | 类型     | 说明                        |
| ---------- | -------- | --------------------------- |
| `index`    | `number` | 当前行索引，`-1` 表示无匹配 |
| `position` | `number` | 该帧播放进度（毫秒）        |

```js
let lines = [];
splayer.player.on("lyricChange", (data) => (lines = data.lines));
splayer.player.on("lineChange", ({ index }) => {
  const text = index >= 0 ? lines[index].words.map((w) => w.word).join("") : "";
  splayer.log.info("当前歌词：", text);
});
```

### `playStateChange` — 播放态变化

| 字段       | 类型                                 | 说明                 |
| ---------- | ------------------------------------ | -------------------- |
| `state`    | `"playing" \| "paused" \| "stopped"` | 播放态               |
| `position` | `number`                             | 该帧播放进度（毫秒） |

`stopped` 与 `paused` 区分开：停止（如播放结束）为 `stopped`，暂停为 `paused`。

## 反向控制播放

在 `register` 中声明 `controls: true` 后，可调用 `splayer.player` 控制播放器：

| 方法                       | 说明                                    |
| -------------------------- | --------------------------------------- |
| `player.play()`            | 播放                                    |
| `player.pause()`           | 暂停                                    |
| `player.next()`            | 下一首                                  |
| `player.prev()`            | 上一首                                  |
| `player.seek(positionMs)`  | 跳转到指定毫秒位置                      |
| `player.setVolume(volume)` | 设置音量，`volume ∈ [0, 1]`             |
| `player.getPosition()`     | `Promise<number>`，查询当前进度（毫秒） |

以上控制方法（除 `getPosition`）均为「即发即忘」，不返回结果；非法入参（如负的 `seek`、越界音量）会被宿主忽略。

::: tip getPosition 的正确用法
`getPosition()` 每次调用都有一次往返开销，**仅用于偶发的一次性查询**。需要持续跟踪进度时，请直接读 `lineChange` / `playStateChange` 载荷里已经带上的 `position`，不要高频轮询 `getPosition`。
:::

## 设置项

控制插件可声明设置项，渲染到插件管理的设置弹窗，让用户配置。

### 声明

```js
splayer.register({
  settings: [
    { key: "token", type: "text", label: "访问令牌", default: "", placeholder: "粘贴 token" },
    { key: "interval", type: "number", label: "上报间隔(秒)", default: 30, min: 5, max: 600 },
    { key: "enabled", type: "switch", label: "启用上报", default: true },
    {
      key: "mode",
      type: "select",
      label: "模式",
      default: "auto",
      options: [
        { label: "自动", value: "auto" },
        { label: "手动", value: "manual" },
      ],
    },
  ],
});
```

先按 `type` 选一种控件，它决定了渲染出的界面、设置值的类型，以及哪些专用字段生效：

| `type`   | 渲染控件   | 设置值类型 | 专用字段      | 说明                            |
| -------- | ---------- | ---------- | ------------- | ------------------------------- |
| `switch` | 开关       | `boolean`  | —             | 布尔开关                        |
| `number` | 数字输入框 | `number`   | `min` / `max` | 超出范围会被夹取到 `[min, max]` |
| `text`   | 单行文本框 | `string`   | `placeholder` | 任意文本                        |
| `select` | 下拉选择   | `string`   | `options`     | 从 `options` 里选一个 `value`   |

`PluginSettingItem` 的全部字段：

| 字段          | 类型                                         | 必填 | 适用 `type` | 说明                                 |
| ------------- | -------------------------------------------- | ---- | ----------- | ------------------------------------ |
| `key`         | `string`                                     | ✅   | 全部        | 设置键名，`getSetting(key)` 用它     |
| `type`        | `"switch" \| "number" \| "text" \| "select"` | ✅   | 全部        | 控件类型，见上表                     |
| `label`       | `string`                                     | ✅   | 全部        | 展示名（纯字符串，不做多语言）       |
| `default`     | `boolean \| number \| string`                | ✅   | 全部        | 默认值，类型需与 `type` 的值类型一致 |
| `description` | `string?`                                    |      | 全部        | 副标题说明，显示在标题下方           |
| `min` / `max` | `number?`                                    |      | `number`    | 取值范围                             |
| `placeholder` | `string?`                                    |      | `text`      | 输入框占位提示                       |
| `options`     | `{ label: string; value: string }[]`         |      | `select`    | 下拉项；`label` 展示、`value` 存储   |

### 读取与监听

```js
// 同步读取当前值（用户改动后亦会同步更新缓存）
const token = splayer.getSetting("token");

// 监听某项变化，用户在 UI 改动后实时触发
splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("启用状态变为：", value);
});
```

宿主会按声明的 `type` 对写入值做校验/强转（如 `switch` 转布尔、`number` 按 `min`/`max` 夹取、`select` 校验合法选项），插件读到的始终是规范化后的值。

## 完整示例

比如这是一个把当前歌词（含翻译）推送到 [ClassIsland](https://github.com/ClassIsland/ClassIsland) 主界面的控制插件：订阅曲目/歌词/行变化，按用户设置决定端口、是否带翻译、无翻译时是否回退到下一行。

```js
/**
 * @name ClassIsland 联动
 * @version 1.0.0
 * @author imsyy
 * @type control
 * @apiLevel 2
 * @description 把当前歌词推送到 ClassIsland 主界面
 */
splayer.register({
  events: ["trackChange", "lyricChange", "lineChange"],
  settings: [
    {
      key: "port",
      type: "number",
      label: "端口",
      default: 50063,
      min: 1024,
      max: 65535,
    },
    {
      key: "showTranslation",
      type: "switch",
      label: "显示翻译",
      default: true,
    },
    {
      key: "showNextLine",
      type: "switch",
      label: "无翻译时显示下一行",
      default: true,
    },
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

/** 一行歌词 → 纯文本 */
const lineText = (line) => (line && line.words ? line.words.map((w) => w.word).join("") : "");

let lines = [];

splayer.player.on("trackChange", ({ track }) => {
  if (track) post(track.title, track.artists);
});

splayer.player.on("lyricChange", ({ lines: ls }) => {
  lines = ls || [];
});

splayer.player.on("lineChange", ({ index }) => {
  const cur = lines[index];
  const lyric = lineText(cur);
  let extra = "";
  if (splayer.getSetting("showTranslation") && cur && cur.translatedLyric) {
    extra = cur.translatedLyric;
  } else if (splayer.getSetting("showNextLine") && lines[index + 1]) {
    extra = lineText(lines[index + 1]);
  }
  post(lyric, extra);
});
```

## 调试

在应用的 DevTools 控制台改设置、观察插件日志：

```js
// 实时下发一次设置变更（触发 onSettingChange）
await window.api.plugins.setSetting("classisland-xxxxxxxx", "showTranslation", false);

// 查看插件状态（含已订阅事件 / 是否声明控制 / 设置项）
await window.api.plugins.list();
```

插件日志汇入应用主日志（`{userData}/app-data/logs/`）。更多调试方式见 [总览 · 调试](/plugins/#调试)。
