# 音源插件

音源插件（`@type source`）为歌曲提供可播放的 URL。当播放器要播放一首在线歌曲、但拿不到官方地址时，会调用音源插件，由插件返回真实播放地址。

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
- 注册其他 key（如 lx 常见的 `kw` / `mg`）不会报错、也会显示在插件管理里，但当前不会被播放调用。
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
`@type source` 可省略（缺省即为 `source`）。音源插件不依赖控制类能力，`@apiLevel` 写 `1` 或 `2` 均可。
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

| 字段        | 类型             | 必填 | 说明                            |
| ----------- | ---------------- | ---- | ------------------------------- |
| `name`      | `string`         | ✅   | 音源展示名（仅用于 UI 展示）    |
| `actions`   | `("musicUrl")[]` | ✅   | 支持的动作（当前仅 `musicUrl`） |
| `qualities` | `Quality[]`      |      | 支持的音质，仅用于 UI 展示      |

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

## 优先级与互斥

- 当多个已启用插件支持同一平台时，由播放器按用户设置的**优先级**自动选用第一个就绪的插件；它失败再尝试下一个。
- 音源插件之间**互斥**：安装一个新音源插件时，已启用的其他音源插件会被自动停用（新装者优先）。用户仍可在插件管理中手动启停。

## 兼容 lx 插件

SPlayer-Next 提供 `lx` 垫片，覆盖 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `user_api` 脚本的常用接口（`lx.request` / `lx.on("request")` / `lx.send("inited")` / `lx.utils`），多数现有 lx 音源脚本无需修改即可导入运行。头部写 `@platform lx`，或以 `gz_` 前缀压缩分发，会自动启用垫片。

::: tip
垫片仅用于兼容存量 lx 音源脚本，且只覆盖音源能力。编写**新插件**请直接使用 `splayer.*` API。
:::

## 调试

在应用的 DevTools 控制台直接触发解析，无需真的播放：

```js
await window.api.plugins.resolveUrl({
  pluginId: "example-xxxxxxxx",
  source: "wy",
  quality: "hq",
  musicInfo: { songmid: "歌曲ID", name: "歌名", singer: "歌手" },
});
```

更多调试方式与错误码见 [总览 · 调试](/plugins/#调试) 与 [错误码](/plugins/#错误码)。
