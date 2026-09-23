# 音源插件

音源插件（`@type source`）为歌曲提供可播放的 URL。当播放器要播放一首在线歌曲、但拿不到官方地址时，会调用音源插件，由插件返回真实播放地址。

音源插件还可选地**兜底歌词与封面**——内置来源拿不到歌词、或曲目无封面时回退到插件。不限在线平台：本地文件没有内嵌歌词 / 封面时同样适用。见[元数据兜底](#metadata-fallback)。

阅读本文前请先了解 [插件总览与架构](/plugins/)，其中的通用 API（`splayer.request` / `storage` / `log` / `utils` 等）对音源插件同样适用，这里不再重复。

## 工作原理

理解「插件何时被调、拿到什么、要返回什么」是写音源插件的前提：

1. 播放器要播一首在线歌曲时，先按其所属平台换算出一个 **source key**（见下），再从已启用且就绪、且注册了该 key 的音源插件里依次挑选；
2. 对选中的插件调用 `musicUrl` 处理器，传入这首歌的 `musicInfo`（含**平台歌曲 ID**）与目标音质；
3. 插件用这些信息去自己的接口换取播放地址，返回 `{ url }`；
4. 播放器拿到第一个非空 `url` 即用它播放；插件抛错或返回空地址，则尝试下一个候选插件。

::: warning source key 必须匹配平台
插件 `register` 的 source key **不是随便起的**——只有与目标平台约定一致的 key 才会被播放器调用。SPlayer-Next 沿用 lx-music 社区约定的 key，当前播放会用到的是 `wy` / `tx` / `kg` 三个，各对应一个在线平台。

- 移植某个 lx 源脚本时，沿用它原本的 source key 即可；
- 自己新写时，用与目标平台对应的 key；不确定就在 handler 里 `splayer.log.info(req.source)`，看播放器实际传入的 key；
- 注册其它 key（如 lx 常见的 `kw` / `mg`）不会报错、也会显示在插件管理里，但当前不会被播放调用。
  :::

## 快速开始

一个最小音源插件（以 `wy` 源为例）：

```js
/**
 * @name        Example
 * @version     1.0.0
 * @description 示例音源
 * @author      you
 * @type        source
 * @apiLevel    2
 */

splayer.register({
  sources: {
    // key 必须是播放器认识的 source key（wy / tx / kg），否则不会被调用
    wy: {
      name: "示例音源",
      actions: ["musicUrl"],
      qualities: ["lq", "hq", "lossless"],
    },
  },
});

splayer.on("musicUrl", async (req) => {
  const { musicInfo, quality } = req;
  // musicInfo.songmid 即平台歌曲 ID
  const resp = await splayer.request(
    `https://api.example.com/url?id=${musicInfo.songmid}&q=${quality}`,
    { responseType: "json" },
  );
  if (!resp.body?.url) throw new Error("no url");
  return { url: resp.body.url, quality, expire: resp.body.expire };
});
```

保存为 `example.js`，在 **设置 → 插件管理 → 本地导入** 即可使用。

::: tip
`@type source` 可省略（缺省即为 `source`）。音源插件不依赖控制类能力，播放地址 / 歌词 / 封面写 `1` 或 `2` 均可；若声明 `musicComment`，需写 `3`。各级别新增能力见[插件总览 · API 级别与变更记录](/plugins/#api-级别与变更记录)。
:::

## `splayer.register(capabilities)`

声明插件提供的音源与能力。请在脚本同步执行阶段调用——注册后插件管理才能展示插件支持的音源，播放器也才会把它纳入候选。

```js
splayer.register({
  sources: {
    wy: {
      name: "示例音源",
      actions: ["musicUrl"],
      qualities: ["lq", "hq", "lossless", "hi-res"],
    },
  },
});
```

`sources` 是一个 `Record<string, Source>`，键即 [source key](#工作原理)（`wy` / `tx` / `kg`），值为 `Source`：

| 字段        | 类型        | 必填 | 说明                                                                                                                                                   |
| ----------- | ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`      | `string`    | ✅   | 音源展示名（仅用于 UI 展示）                                                                                                                           |
| `actions`   | `Action[]`  | ✅   | 支持的动作：`musicUrl`（播放地址）/ `musicSearch`·`musicLyric`·`musicPic`（[元数据兜底](#metadata-fallback)）/ `musicComment`（[评论](#musiccomment)） |
| `qualities` | `Quality[]` |      | 支持的音质，仅用于 UI 展示                                                                                                                             |

`Quality` 取值：

| 值         | 含义                                          |
| ---------- | --------------------------------------------- |
| `hi-res`   | 高解析度无损（采样率 ≥ 96kHz + 位深 ≥ 24bit） |
| `lossless` | 无损（flac / ape / wav 等）                   |
| `hq`       | 有损 ≥ 320kbps                                |
| `sq`       | 有损 ≥ 192kbps                                |
| `lq`       | 有损 < 192kbps                                |

一个插件可同时注册多个 source key，用一份脚本覆盖多平台。

## `splayer.on("musicUrl", handler)`

注册 `musicUrl` 处理器，异步返回播放地址。每个动作最多一个处理器，重复注册时后者覆盖前者。

### 请求 `req`

```js
{
  source: "wy",        // 本次请求的 source key，多源时据此分发
  quality: "hq",       // 目标音质（Quality）
  musicInfo: { ... },  // 歌曲信息，见下
}
```

`musicInfo` 的实际字段（`id` / `songmid` / `songId` 为同一个**平台歌曲 ID** 的三种别名，兼容不同年代的脚本）：

| 字段       | 类型             | 说明                                            |
| ---------- | ---------------- | ----------------------------------------------- |
| `id`       | `string`         | 平台歌曲 ID                                     |
| `songmid`  | `string`         | 同 `id`（别名）                                 |
| `songId`   | `string`         | 同 `id`（别名）                                 |
| `name`     | `string`         | 歌名                                            |
| `singer`   | `string`         | 艺术家，多位用 `/` 连接                         |
| `source`   | `string`         | source key，同 `req.source`                     |
| `interval` | `string \| null` | 时长 `mm:ss`，未知为 `null`                     |
| `meta`     | `object`         | 附加信息：`albumName` / `albumId` / `picUrl` 等 |

::: tip
多数音源接口只需要 `songmid`（平台歌曲 ID）与 `quality` 就能换地址。`name` / `singer` / `interval` 适合做接口要求的校验或日志。
:::

### 返回 `res`

| 字段      | 类型      | 必填 | 说明                                   |
| --------- | --------- | ---- | -------------------------------------- |
| `url`     | `string`  | ✅   | 播放地址                               |
| `quality` | `Quality` |      | 实际返回的音质（可能低于请求值）       |
| `expire`  | `number`  |      | 地址过期时间戳（ms），到期后会重新解析 |

行为约定：

- 返回值必须是含**非空字符串 `url`** 的对象，否则视为该插件解析失败，播放器转向下一个候选插件；
- 找不到歌曲、接口报错等情况，直接 `throw`（可通过 `err.code` 携带错误码）即可，同样会转向下一个候选；
- 处理器有超时（默认 20 秒），超时会被取消并报 `PLUGIN_CANCELLED`；
- 请求的 `quality` 不可用时，可降级返回较低音质并在 `res.quality` 标注实际值。

## 一个插件支持多个平台

一个插件可以注册多个 source key（如同时支持 `wy` 和 `tx`）。要注意的是：**`splayer.on("musicUrl", ...)` 只能注册一个处理器**——不管注册了几个 source，所有请求都会进这同一个处理器。所以处理器里要用 `req.source` 判断「这次是哪个平台的请求」，再分别去对应接口换地址：

```js
/**
 * @name     Multi Source
 * @version  1.0.0
 * @type     source
 * @apiLevel 2
 */

splayer.register({
  sources: {
    wy: { name: "wy 源", actions: ["musicUrl"], qualities: ["lq", "hq", "lossless"] },
    tx: { name: "tx 源", actions: ["musicUrl"], qualities: ["lq", "hq"] },
  },
});

splayer.on("musicUrl", async (req) => {
  const id = req.musicInfo.songmid; // 平台歌曲 ID
  let url;

  // 按 req.source 分别处理，resolveWy / resolveTx 是你自己实现的取址函数
  if (req.source === "wy") {
    url = await resolveWy(id, req.quality);
  } else if (req.source === "tx") {
    url = await resolveTx(id, req.quality);
  }

  if (!url) throw new Error("no url");
  return { url, quality: req.quality };
});
```

`resolveWy` / `resolveTx` 由你自己写——内部各自调对应平台的接口（一般用 [`splayer.request`](/plugins/#通用-api)）拿到播放地址。两个平台的取址逻辑互不相同，但都通过同一个 `musicUrl` 处理器对外暴露。

## 元数据兜底（歌词 / 封面） {#metadata-fallback}

除了播放地址，音源插件还能在**内置来源拿不到时兜底元数据**。SPlayer-Next 内置 netease / qqmusic / kugou 的搜索与歌词，但：

- 内置三平台都匹配不到歌词时，宿主回退到插件的 `musicLyric`（在线平台曲目与本地文件都先经三平台按歌名匹配，全 miss 后才轮到插件）；
- 曲目**完全没有封面**时（如无内嵌封面的本地文件），宿主回退到插件的 `musicPic`，补全全屏播放器大图（同时填充背景与取色）。

这套兜底走「**宿主编排、插件出原语**」：你只实现 `musicSearch`（搜候选）+ `musicLyric` / `musicPic` / `musicComment`（取数据），跨源匹配由宿主负责。

### 与 musicUrl 的两点不同

1. **source key 不受限**。`musicUrl` 只有 `wy` / `tx` / `kg` 会被播放调用；元数据兜底**对任意 key 生效**——宿主把你声明的 key 原样传进 `musicSearch`，所以 `kw` / `mg` 等内置不支持的平台也能在这里补上歌词 / 封面。
2. **匹配由宿主做**。你不必自己判断「搜出来的哪条才是这首歌」：宿主用候选的 `name` / `singer` / `durationMs` 打分，**时长是硬门槛**（双方都给时长且相差超 20 秒直接排除），挑出最匹配的一条，再用它调 `musicLyric` / `musicPic` / `musicComment`。若你声明的 source key 恰好对应曲目所属平台（`wy` / `tx` / `kg`），宿主跳过搜索、直接用平台歌曲 ID。

### 声明

在 source 的 `actions` 里加上要支持的动作：

```js
splayer.register({
  sources: {
    kw: { name: "KW", actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"] },
  },
});
```

> `musicSearch` 是匹配前提，补歌词 / 封面 / 评论时都需要它。评论能力属于 API level 3，级别变更记录见[插件总览](/plugins/#api-级别与变更记录)。

### `musicSearch`

宿主先调它搜候选，供匹配打分。

**请求** `{ source, keyword, page?, limit? }`——`keyword` 形如 `"歌名 歌手"`。

**返回** `{ list: Candidate[] }`，`Candidate`：

| 字段         | 类型     | 必填 | 说明                                                                                                |
| ------------ | -------- | ---- | --------------------------------------------------------------------------------------------------- |
| `id`         | `string` | ✅   | 该源内的歌曲 ID，取歌词 / 封面时凭它                                                                |
| `name`       | `string` | ✅   | 歌名（匹配用）                                                                                      |
| `singer`     | `string` |      | 歌手（匹配用）                                                                                      |
| `album`      | `string` |      | 专辑（匹配加分）                                                                                    |
| `durationMs` | `number` |      | 时长（毫秒）——**强烈建议给**，时长是匹配硬门槛                                                      |
| 其余字段     | 任意     |      | 原样透传：命中的这条 Candidate 会作为 `musicInfo` 回传给 `musicLyric` / `musicPic` / `musicComment` |

::: warning durationMs 决定匹配质量
不给 `durationMs` 时长门槛失效，容易匹配到同名翻唱 / 伴奏。能拿到时长就一定要填。
:::

### `musicLyric`

**请求** `{ source, musicInfo }`——`musicInfo` 是宿主匹配命中的那条 `Candidate`（含 `id`）。

**返回**：

| 字段      | 类型     | 必填 | 说明                           |
| --------- | -------- | ---- | ------------------------------ |
| `lyric`   | `string` | ✅   | 主歌词（LRC / 逐行文本）       |
| `tlyric`  | `string` |      | 翻译                           |
| `rlyric`  | `string` |      | 罗马音                         |
| `awlyric` | `string` |      | 逐字歌词（yrc / qrc / lys 等） |

> 有逐字（`awlyric`）时宿主优先用逐字，格式自动识别。返回空 `lyric` 视为未命中，宿主转向下一个源。

### `musicPic`

**请求** `{ source, musicInfo }`，同上。

**返回** `{ url }`——封面图片远端直链。它会同时填充全屏大图与背景，建议给尽量大的图。返回空 `url` 视为未命中。

### `musicComment`

::: warning 需要 apiLevel 3
脚本头部必须声明 `@apiLevel 3`。各级别新增能力见[插件总览 · API 级别与变更记录](/plugins/#api-级别与变更记录)。
:::

**请求**：

```js
{
  source: "kw",
  musicInfo: { ... }, // 宿主匹配命中的 Candidate
  type: "hot",        // "hot" 热门评论 / "new" 最新评论
  page: 1,            // 页码，从 1 开始
  limit: 20,          // 每页数量，宿主会限制最大值
}
```

**返回**：

```js
{
  list: [
    {
      id: "comment-id",
      userId: "user-id",
      userName: "用户名",
      avatar: "https://example.com/avatar.jpg",
      text: "评论内容",
      time: 1710000000000,
      location: "广东",
      likedCount: 123,
      reply: [
        { id: "reply-id", userName: "被回复用户", text: "回复内容" },
      ],
    },
  ],
  total: 1000,
  page: 1,
  limit: 20,
}
```

| 字段         | 类型        | 必填 | 说明                                 |
| ------------ | ----------- | ---- | ------------------------------------ |
| `list`       | `Comment[]` | ✅   | 当前页评论                           |
| `total`      | `number`    | ✅   | 评论总数，用于分页                   |
| `page`       | `number`    | ✅   | 当前页码                             |
| `limit`      | `number`    | ✅   | 当前页每页数量                       |
| `id`         | `string`    | ✅   | 评论 ID                              |
| `userName`   | `string`    | ✅   | 评论用户名                           |
| `text`       | `string`    | ✅   | 评论正文                             |
| `userId`     | `string`    |      | 用户 ID                              |
| `avatar`     | `string`    |      | 用户头像 URL                         |
| `time`       | `number`    |      | 评论时间戳（ms）                     |
| `location`   | `string`    |      | IP 属地 / 地区                       |
| `likedCount` | `number`    |      | 点赞数                               |
| `reply`      | `Comment[]` |      | 内嵌回复摘要；楼中楼分页暂不要求实现 |

### 完整示例（兜底歌词 + 封面）

```js
/**
 * @name     KW Metadata
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
  const resp = await splayer.request(
    `https://api.example.com/search?k=${encodeURIComponent(keyword)}`,
    { responseType: "json" },
  );
  return {
    list: (resp.body?.songs ?? []).map((song) => ({
      id: song.rid,
      name: song.name,
      singer: song.artist,
      album: song.album,
      durationMs: song.duration * 1000, // 接口给秒就 ×1000
    })),
  };
});

splayer.on("musicLyric", async ({ musicInfo }) => {
  const resp = await splayer.request(`https://api.example.com/lyric?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { lyric: resp.body?.lrc ?? "", tlyric: resp.body?.tlrc };
});

splayer.on("musicPic", async ({ musicInfo }) => {
  const resp = await splayer.request(`https://api.example.com/pic?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { url: resp.body?.cover ?? "" };
});

splayer.on("musicComment", async ({ musicInfo, type, page, limit }) => {
  const resp = await splayer.request(
    `https://api.example.com/comment?id=${musicInfo.id}&type=${type}&page=${page}&limit=${limit}`,
    { responseType: "json" },
  );
  return {
    list: (resp.body?.comments ?? []).map((item) => ({
      id: String(item.id),
      userName: item.user?.name ?? "",
      avatar: item.user?.avatar,
      text: item.content ?? "",
      time: item.time,
      likedCount: item.likedCount,
    })),
    total: resp.body?.total ?? 0,
    page,
    limit,
  };
});
```

### 触发与顺序

- 歌词兜底对**在线平台曲目、本地文件和流媒体曲目**生效。在线曲目排在内置三平台之后；流媒体曲目先尝试服务器歌词；内置或服务器来源未命中时，再按插件优先级逐个尝试，首个非空结果生效；
- 封面兜底对**任意来源**生效（本地 / 在线 / 流媒体），仅在曲目**无任何封面**时触发，有封面的曲目不会发起任何请求；
- 评论源会出现在评论弹窗右上角来源下拉中；只有同时声明 `musicSearch` 与 `musicComment` 的源会展示，显示名使用 `sources[key].name`；
- 这些请求都需要联网，音源插件**自动获得 `network` 权限**，无需声明。

## 优先级

- 多个音源插件可**同时启用**，互不排斥——即便支持同一平台。
- 当多个已启用插件支持同一平台时，播放器按用户在插件管理里设置的**优先级**自动选用第一个就绪的插件；它失败（抛错或返回空地址）再尝试下一个。

## 更新支持

音源插件在脚本头声明 `@updateUrl`，宿主即会检查 `@version` 并提示用户一键原地更新（lx 音源脚本沿用运行时的 `updateAlert`）。完整说明见 [插件更新](/plugins/update)。

## 兼容 lx 插件

SPlayer-Next 提供 `lx` 兼容层，覆盖 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `user_api` 脚本的常用接口（`lx.request` / `lx.on("request")` / `lx.send("inited")` / `lx.utils`）。兼容层由宿主**自动注入**，多数现有 lx 音源脚本（含 `gz_` 压缩分发）无需任何修改或声明即可导入运行。

::: tip
兼容层仅用于兼容存量 lx 音源脚本，且只覆盖音源能力。编写**新插件**请直接使用 `splayer.*` API。
:::

## 调试

在应用的 DevTools 控制台直接触发解析，无需真的播放：

```js
await window.api.plugins.resolveUrl({
  pluginId: "example-splayer",
  source: "wy",
  quality: "hq",
  musicInfo: { songmid: "歌曲ID", name: "歌名", singer: "歌手" },
});
```

歌词 / 封面兜底也可直接触发（`track` 传一个 Track 形状对象即可，`pluginId` 取自 `window.api.plugins.list()`）：

```js
const track = {
  id: "x",
  source: "local",
  title: "歌名",
  artists: [{ name: "歌手" }],
  duration: 269000,
};
await window.api.plugins.matchLyric({ pluginId: "kw-metadata-splayer", source: "kw", track });
await window.api.plugins.matchCover({ pluginId: "kw-metadata-splayer", source: "kw", track });
```

更多调试方式与错误码见 [总览 · 调试](/plugins/#调试) 与 [错误码](/plugins/#错误码)。
