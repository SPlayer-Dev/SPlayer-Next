# 控制插件

控制插件（`@type control`）不提供音源，而是**监听播放器状态**（曲目 / 歌词 / 播放态）、**反向控制播放**（播放、暂停、切歌、跳转、音量），**声明自己的设置项**让用户在插件管理里配置，还能**向歌曲菜单添加自定义项**。典型用途如：将播放状态同步到 Discord、智能家居/灯效联动、第三方上报，或给歌曲加一键外链/上报入口等。

阅读本文前请先了解 [插件总览与架构](/plugins/)，其中的通用 API 对控制插件同样适用。

::: warning 需要 apiLevel 2
脚本头部必须声明 `@type control` 与 `@apiLevel 2`，否则控制能力在运行时不可用。各级别新增能力见[插件总览 · API 级别与变更记录](/plugins/#api-级别与变更记录)。
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
 * @grant       control
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
  splayer.log.info(
    "正在播放：",
    track.title,
    "-",
    track.artists.map((artist) => artist.name).join(" / "),
  );
});

splayer.player.on("playStateChange", ({ state, position }) => {
  splayer.log.info("播放态：", state, "@", position, "ms");
});
```

保存为 `.js`，在 **设置 → 插件管理 → 本地导入** 即可使用。

## `splayer.register(args)`

控制插件用 `register` 声明要用到的能力，请在脚本同步执行阶段调用：

```js
splayer.register({
  events: ["trackChange", "lyricChange", "lineChange", "playStateChange"],
  controls: true,
  settings: [/* PluginSettingItem[] */],
});
```

| 字段       | 类型                  | 必填 | 说明                                                                |
| ---------- | --------------------- | ---- | ------------------------------------------------------------------- |
| `events`   | `PlaybackEventKind[]` |      | 要订阅的播放事件，未声明的事件不会下发                              |
| `controls` | `boolean`             |      | 是否使用反向播放控制（`splayer.player.play()` 等）                  |
| `settings` | `PluginSettingItem[]` |      | 用户可配置项，渲染到插件管理的设置弹窗                              |
| `menus`    | `PluginMenuItem[]`    |      | 向歌曲菜单添加的菜单项，需声明 `@grant ui`；见[菜单扩展](#菜单扩展) |

::: tip 只发订阅的事件
宿主只会向插件推送它在 `events` 里声明过的事件，未声明的不会推送。插件启用时，宿主会立即补发一次当前状态快照（当前曲目、歌词、播放态、当前行），无需自己拉取初始值。
:::

## 监听播放事件

```js
splayer.player.on(kind, (data) => { ... });
```

支持的事件类型与载荷：

### `trackChange` — 曲目切换

`track` 为当前曲目 [`Track`](/types#track)（`artists` 是 [`Artist[]`](/types#artist)），`null` 表示无曲目。

### `lyricChange` — 歌词整体变化

| 字段    | 类型          | 说明                   |
| ------- | ------------- | ---------------------- |
| `lines` | `LyricLine[]` | 当前曲目的完整解析歌词 |

每行是一个 [`LyricLine`](/types#lyricline)，逐字内容见 [`LyricWord`](/types#lyricword)。整行纯文本：`line.words.map((word) => word.word).join("")`；逐行（LRC 类）歌词通常每行只有一个 word，其始末时间与行时间一致。

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

在脚本头声明 `@grant control` 后，可调用 `splayer.player` 控制播放器；未授权时控制调用会被宿主忽略。`register({ controls: true })` 用于向宿主和用户表明插件包含反向控制能力，但当前权限门控以 `@grant control` 为准：

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

## 菜单扩展

控制插件可向**歌曲菜单**添加自定义菜单项：底栏「更多」菜单与歌曲列表的右键菜单都会显示，同一插件的菜单项折叠在一个以**插件名**命名的子菜单下。

::: warning 需要 ui 权限
菜单属界面扩展，必须在脚本头声明 `@grant ui`，否则声明的菜单项会被宿主忽略。
:::

### 声明菜单项

在 `register` 里传 `menus`（纯菜单插件无需 `events` / `controls`）：

```js
/**
 * @name     歌曲工具
 * @version  1.0.0
 * @type     control
 * @apiLevel 2
 * @grant    ui network
 */
splayer.register({
  menus: [
    { id: "open", label: "在网页打开" },
    { id: "copy", label: "复制歌曲信息" },
    { id: "local-only", label: "仅本地歌曲", sources: ["local"] },
  ],
});
```

`PluginMenuItem` 字段：

| 字段      | 类型        | 必填 | 说明                                                         |
| --------- | ----------- | ---- | ------------------------------------------------------------ |
| `id`      | `string`    | ✅   | 菜单项标识，插件内唯一；点击时随 `menuClick` 回传            |
| `label`   | `string`    | ✅   | 展示文本（纯字符串，不做多语言）                             |
| `sources` | `string[]?` |      | 仅对这些来源的歌曲显示（如 `["local"]`）；缺省对全部歌曲显示 |

### 响应点击

注册 `menuClick` 处理器，用户点菜单项时触发：

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

入参 `req.track` 是当前曲目 [`Track`](/types#track)（与 `trackChange` 事件里的 `track` 同一类型）；常用的有 `id` / `title` / `artists`（[`Artist[]`](/types#artist)）/ `album`（[`Album`](/types#album)）/ `source` / `duration`。

处理器**可选**返回 `MenuClickRes`，三个字段都可省略、可组合，由宿主在界面侧代为执行：

| 字段       | 类型      | 效果                                      |
| ---------- | --------- | ----------------------------------------- |
| `toast`    | `string?` | 弹出一条轻提示                            |
| `openUrl`  | `string?` | 用系统浏览器打开链接（仅 `http`/`https`） |
| `copyText` | `string?` | 写入剪贴板（自带「已复制」提示）          |

```js
splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId === "report") {
    await splayer.request("https://my.api/scrobble", {
      method: "POST",
      body: JSON.stringify(track),
    });
    return { toast: `已上报：${track.title}` };
  }
});
```

::: tip 处理器在沙箱里运行
`menuClick` 与其它处理器一样跑在隔离子进程中，**没有 DOM**：不能弹自定义窗口/面板，面向用户的反馈只有上面三种返回动作。要联网（`splayer.request`）需 `@grant network`，要控制播放（`splayer.player.*`）需 `@grant control`——菜单本身只需 `ui`。
:::

## 更新支持

控制插件在脚本头声明 `@updateUrl` 后，宿主会拉取它读 `@version` 与本地比对，发现新版即在卡片上提示，用户可一键原地更新（保留已配置的设置项与插件数据）。完整说明见 [插件更新](/plugins/update)。

## 完整示例

比如这是一个把当前歌词（含翻译）推送到 [ClassIsland](https://github.com/ClassIsland/ClassIsland) 主界面的控制插件：订阅曲目/歌词/行变化，按用户设置决定端口、是否带翻译、无翻译时是否回退到下一行。

```js
/**
 * @name ClassIsland 联动
 * @version 1.0.0
 * @author imsyy
 * @type control
 * @apiLevel 2
 * @grant network
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
  if (track) post(track.title, track.artists.map((artist) => artist.name).join(" / "));
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
await window.api.plugins.setSetting("classisland-splayer", "showTranslation", false);

// 查看插件状态（含已订阅事件 / 是否声明控制 / 设置项）
await window.api.plugins.list();
```

插件日志汇入应用主日志（`{userData}/app-data/logs/`）。更多调试方式见 [总览 · 调试](/plugins/#调试)。
