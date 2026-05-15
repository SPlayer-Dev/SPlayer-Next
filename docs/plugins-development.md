# 插件开发指南

本文面向想为 SPlayer-Next 编写插件的开发者。插件是一段运行在隔离沙箱里的 JavaScript，通过宿主注入的 `splayer` 全局对象对外提供能力。

> 最终用户如何安装使用见 [plugins-usage.md](./plugins-usage.md)。

## 快速开始

一个最小插件就是一个 `.js` 文件。头部需要 JSDoc 声明元数据：

```js
/**
 * @name Example
 * @version 1.0.0
 * @description 示例插件
 * @author you
 * @homepage https://example.com
 * @platform splayer
 * @apiLevel 1
 */

splayer.register({
  sources: {
    demo: {
      name: "Demo 源",
      actions: ["musicUrl", "lyric"],
      qualities: ["lq", "hq", "lossless"],
    },
  },
});

splayer.on("musicUrl", async (req) => {
  const { musicInfo, quality } = req;
  const resp = await splayer.request(
    `https://api.example.com/url?id=${musicInfo.songmid}&q=${quality}`,
    { responseType: "json" },
  );
  return { url: resp.body.url, quality, expire: resp.body.expire };
});

splayer.on("lyric", async (req) => {
  const { musicInfo } = req;
  const resp = await splayer.request(`https://api.example.com/lyric?id=${musicInfo.songmid}`, {
    responseType: "json",
  });
  return { lyric: resp.body.lrc, tlyric: resp.body.tlrc ?? null };
});
```

保存为 `example.js`，在 SPlayer 设置里「本地导入」即可。

## 脚本头部（JSDoc Manifest）

| 字段           | 必填 | 上限      | 说明                                                               |
| -------------- | ---- | --------- | ------------------------------------------------------------------ |
| `@name`        | ✅   | 24 字符   | 插件展示名                                                         |
| `@version`     | ✅   | 36 字符   | 语义化版本号                                                       |
| `@description` |      | 256 字符  | 简介                                                               |
| `@author`      |      | 56 字符   | 作者                                                               |
| `@homepage`    |      | 1024 字符 | 主页 URL                                                           |
| `@platform`    |      |           | `splayer` 或 `lx`，不写默认 `splayer`（`gz_` 压缩脚本默认为 `lx`） |
| `@apiLevel`    |      |           | 声明兼容的 Host API 级别，当前宿主 = 1，超过会拒绝加载             |

缺少 `@name` 或 `@version` → 安装失败。

插件 `id` 由宿主自动生成：`slugify(name) + "-" + sha1(source).slice(0,8)`。你不需要自己指定。

## 沙箱环境

插件运行在独立 `utilityProcess` 子进程 + `vm.createContext` 双层隔离中：

- **没有** Node 内置模块（`fs` / `net` / `child_process` 等），**没有** `require` / `import`
- **没有** DOM / Electron API（`window` 仅在 lx 兼容模式下作为 `{ lx }` 垫片）
- **有** 以下全局：`splayer`、`Buffer`、`URL` / `URLSearchParams`、`TextEncoder` / `TextDecoder`、`btoa` / `atob`、`Promise`、`setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` / `setImmediate` / `clearImmediate` / `queueMicrotask`、`console`（重定向到 `splayer.log`）

硬性约束：

- **脚本同步部分执行时间 ≤ 5 秒**（V8 超时后中止并上报脚本错误）
- **从 fork 到脚本 ready ≤ 10 秒**，超时即判定加载失败
- **每插件并发请求 ≤ 4，全局并发 ≤ 16**
- **心跳间隔 10 秒**，连续 3 次未回 pong 视为卡死，自动杀掉重启
- 崩溃后重启节奏 **2s / 8s / 30s**，累计 3 次失败进入 `error` 状态

## `splayer` API

注入到沙箱全局的对象。以下是完整表面，基于 Host API level 1。

### 只读字段

```ts
splayer.pluginId: string       // 宿主分配的插件 ID
splayer.apiLevel: number        // 宿主 Host API level（= 1）
splayer.locale: string          // 当前界面语言（如 "zh-CN"）
splayer.appVersion: string      // SPlayer 应用版本
```

### 注册能力

```ts
splayer.register({
  sources: {
    [sourceKey: string]: {
      name: string;                    // 展示名
      actions: "musicUrl"[];           // 当前 level 1 仅 musicUrl；lyric / pic 计划在 level 2 加入
      qualities?: ("lq" | "sq" | "hq" | "lossless" | "hi-res")[];
    };
  };
});
```

音质等级对齐宿主的 `QualityLevel`（见 `src/utils/quality.ts`）：

| 值         | 含义                                          |
| ---------- | --------------------------------------------- |
| `hi-res`   | 高解析度无损（采样率 ≥ 96kHz + 位深 ≥ 24bit） |
| `lossless` | 无损（flac / ape / wav 等）                   |
| `hq`       | 有损 ≥ 320kbps                                |
| `sq`       | 有损 ≥ 192kbps                                |
| `lq`       | 有损 < 192kbps                                |

lx 脚本声明的 `128k/192k/320k/flac/flac24bit/ape/wav` 会被垫片自动映射到上面的等级；**lx 脚本的** handler 经由 `lx.on('request')` 收到的 `info.type` 也会反向映射为 lx 原生值，老脚本无需改动。

**建议在脚本同步部分调用**。注册完后 UI 才能显示插件支持的源/动作；handler 真正被分派依赖请求里的 `source` 字段，宿主不会因为没 register 就拒绝调用，但 UI 上会看不到能力声明。

### 注册动作处理器

```ts
splayer.on("musicUrl", async (req) => res);
```

每个 action 最多一个 handler，重复注册后者覆盖前者。**当前 level 1 只实现了 `musicUrl`，`lyric` / `pic` 在路线图（计划在 level 2 加入）**，搜索与元数据由宿主自身负责。

#### 请求/响应形状

下表仅列 level 1 已实现的 `musicUrl`：

| Action     | 请求                             | 响应                         | 默认超时 |
| ---------- | -------------------------------- | ---------------------------- | -------- |
| `musicUrl` | `{ source, quality, musicInfo }` | `{ url, quality?, expire? }` | 20 s     |

`musicInfo` 当前由宿主实际下发的字段集（splayer-native 与 lx 兼容路径共用同一份）：

```ts
{
  id: string,           // Track 主键
  songmid: string,      // 与 id 同值，兼容旧脚本字段名
  songId: string,       // 与 id 同值，兼容更旧的字段名
  name: string,         // 歌曲名
  singer: string,       // "/" 拼接的艺术家串
  source: string,       // "wy" | "tx" | "kg" | ...，与请求外层 source 一致
  interval: string|null,// "mm:ss" 格式时长
  meta: {
    songId: string,
    albumName: string,
    albumId?: string,
    picUrl?: string,
  },
}
```

如果脚本声明 `@platform lx`（或以 `gz_` 压缩分发），lx 垫片会原样把上述对象交给 `lx.on('request')` 的 handler —— 字段与 `LX.Music.MusicInfo` 形状基本对齐。

handler 抛出的异常会被宿主捕获，错误码透传到上层。超时未返回 → 被主进程 cancel。

### 网络请求

```ts
splayer.request(url: string, opts?: HostRequestOptions): Promise<HostRequestResult>

interface HostRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
  timeout?: number;                            // 毫秒，默认 15000，最大 60000
  responseType?: "text" | "json" | "arraybuffer"; // 默认 "text"
}

interface HostRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown; // text → string, json → 已 parse 对象，arraybuffer → Uint8Array
}
```

仅允许 `http://` 和 `https://`。请求由主进程的 `net.fetch` 发出，遵循系统代理设置。

### 日志

```ts
splayer.log.debug(...args);
splayer.log.info(...args);
splayer.log.warn(...args);
splayer.log.error(...args);
```

转发到宿主主日志系统，并落盘到 `{userData}/plugins/logs/{id}.log`。`console.*` 也会自动转发到同样的通道。

### 私有 KV 存储

```ts
splayer.storage.get<T>(key: string): Promise<T | null>;
splayer.storage.set(key: string, value: unknown): Promise<void>;
splayer.storage.remove(key: string): Promise<void>;
splayer.storage.keys(): Promise<string[]>;
```

每个插件一个独立命名空间，落盘到 `{userData}/plugins/data/{id}.json`。卸载插件会自动清除。

### 用户设置

```ts
splayer.getSetting<T>(key: string): T | undefined;
```

同步读取用户给此插件配置的值（来源是 `settings.json` 里 `plugins.perPlugin.{id}.{key}`）。未配置时返回 `undefined`。设置 schema 通过 `register()` 声明的能力将在后续 API level 加入；当前只能从外部写入配置，UI 编辑入口尚未开放。

### 工具（`splayer.utils`）

常用 Node 原语的安全封装，**不需要**自己调用 Node 内置模块：

```ts
splayer.utils.crypto.md5(data)
splayer.utils.crypto.sha1(data)
splayer.utils.crypto.sha256(data)
splayer.utils.crypto.hmac(algo, key, data)
splayer.utils.crypto.randomBytes(size)
splayer.utils.crypto.aesEncrypt(data, key, mode, iv?)
splayer.utils.crypto.aesDecrypt(data, key, mode, iv?)
splayer.utils.crypto.rsaEncrypt(data, publicKey)

splayer.utils.buffer.from(data, encoding?)
splayer.utils.buffer.bufToString(buf, encoding?)
splayer.utils.buffer.concat(list)

splayer.utils.base64.encode(data)
splayer.utils.base64.decode(data)

splayer.utils.zlib.inflate(data) / deflate(data)
splayer.utils.zlib.gunzip(data) / gzip(data)
```

## 错误码

handler 抛异常时可通过 `err.code` 带上错误码；不带的话宿主默认 `PLUGIN_HANDLER_ERROR`。

| Code                        | 含义                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `PLUGIN_NOT_FOUND`          | 找不到指定插件                                                     |
| `PLUGIN_DISABLED`           | 插件已禁用                                                         |
| `PLUGIN_NOT_READY`          | 插件未就绪 / 沙箱未启动                                            |
| `PLUGIN_ACTION_UNSUPPORTED` | 插件没注册该动作                                                   |
| `PLUGIN_LOAD_TIMEOUT`       | 加载超 10 秒                                                       |
| `PLUGIN_SCRIPT_ERROR`       | 脚本语法或运行错误                                                 |
| `PLUGIN_INVALID_MANIFEST`   | 头部字段缺失或不合法                                               |
| `PLUGIN_API_LEVEL_MISMATCH` | 声明 apiLevel 高于宿主                                             |
| `PLUGIN_REQUEST_TIMEOUT`    | 动作或 request 超时                                                |
| `PLUGIN_CANCELLED`          | 被上层取消                                                         |
| `PLUGIN_NETWORK_ERROR`      | 网络错误                                                           |
| `PLUGIN_URL_NOT_ALLOWED`    | URL 协议不在白名单                                                 |
| `PLUGIN_HANDLER_ERROR`      | handler 默认错误码                                                 |
| `PLUGIN_WORKER_CRASHED`     | 子进程崩溃                                                         |
| `PLUGIN_INVALID_RESULT`     | 插件返回的结果形状不合法（musicUrl 必须是字符串 URL 或 `{ url }`） |

## 完整示例结构

```js
/**
 * @name My Plugin
 * @version 1.0.0
 * @description 一个多源聚合示例
 * @author you
 * @apiLevel 1
 */

splayer.register({
  sources: {
    sa: { name: "SA 音源", actions: ["musicUrl"], qualities: ["lq", "hq"] },
    sb: { name: "SB 音源", actions: ["musicUrl"], qualities: ["lq", "hq", "lossless"] },
  },
});

const apis = {
  sa: async ({ musicInfo, quality }) => {
    /* 调用 SA 接口拿到 url */
    return { url: "https://...", quality };
  },
  sb: async ({ musicInfo, quality }) => {
    /* 调用 SB 接口拿到 url */
    return { url: "https://...", quality };
  },
};

splayer.on("musicUrl", async (req) => {
  const fn = apis[req.source];
  if (!fn) {
    throw Object.assign(new Error("source not supported"), { code: "PLUGIN_ACTION_UNSUPPORTED" });
  }
  return fn(req);
});
```

## 调试

1. 控制台里（DevTools）直接调：

   ```js
   await window.api.plugins.list();
   await window.api.plugins.resolveUrl({
     pluginId: "my-plugin-xxxxxxxx",
     source: "sa",
     quality: "hq",
     musicInfo: { songmid: "123" },
   });
   ```

2. 查看 `{userData}/plugins/logs/{id}.log` 拿插件的运行日志

3. 修改脚本 → 重新导入一次（id 会因为源码 sha1 变化而变化，旧版本会自动被替换）

## 发布

脚本可以：

- 直接作为 `.js` 分发（推荐）
- 用 `gz_` 前缀 + zlib + base64 压缩成单行文本（兼容 lx 生态）

用户通过「本地导入」或「在线导入（粘贴 raw URL）」装上即可。

## 兼容 lx 插件

SPlayer 提供了 `window.lx` / `globalThis.lx` 垫片，覆盖 lx-music-desktop 的 user_api 常用 API：

- `lx.request(url, opts, callback)` — 回调风格 HTTP 请求
- `lx.on("request", handler)` — 注册统一 handler，宿主根据 `action` 分派
- `lx.send("inited", { sources })` — 异步上报能力
- `lx.utils.crypto` / `lx.utils.buffer` / `lx.utils.zlib` / `lx.utils.base64` — 与 `splayer.utils` 等价

绝大多数 lx 公开脚本无需修改即可运行。头部写 `@platform lx` 或脚本整体以 `gz_` 压缩会自动启用垫片。

**注意**：若你在写**新插件**，请直接用 `splayer.*` API，lx 垫片仅用于跑存量 lx 脚本。
