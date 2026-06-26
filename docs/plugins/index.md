# 插件总览与架构

SPlayer-Next 内置一套插件系统，允许用第三方 JavaScript 扩展应用能力。每个插件都是一段运行在**独立隔离沙箱**中的脚本，通过宿主注入的全局对象 `splayer` 与应用交互。

本文介绍插件系统的整体架构、运行模型与两类插件共用的通用 API。具体的编写方式见：

- [音源插件](/plugins/source)：解析歌曲的播放地址（`musicUrl`）。
- [控制插件](/plugins/control)：监听播放状态、反向控制播放、声明自己的设置项。

最终用户的安装与管理方式见 [插件使用](/plugins-usage)。

## 插件能做什么

| 类型                         | `@type`   | 用途                                                  |
| ---------------------------- | --------- | ----------------------------------------------------- |
| [音源插件](/plugins/source)  | `source`  | 为歌曲提供可播放的 URL，扩展可播放的曲库              |
| [控制插件](/plugins/control) | `control` | 订阅播放/歌词事件，反向控制播放器，并可声明用户设置项 |

一个脚本只能是其中一种类型，由头部 `@type` 决定，缺省为 `source`。

插件系统仍在持续演进，上表是目前已支持的类型，后续会按需引入更多类型。新类型同样通过 `@type` 声明，并在 [API 级别](#api-级别) 中标注所需级别——已有插件不受影响。

## 技术架构

### 进程模型

**每个启用的插件都运行在自己独立的进程里**，内部是一个隔离的 JavaScript 沙箱。脚本只能访问宿主注入的 `splayer`，既看不到应用本身的内存，也看不到其他插件。

```
┌──────────── SPlayer-Next 主进程 ────────────┐
│        播放器 · 插件管理 · 网络 / 存储        │
└───────┬────────────────────────┬────────────┘
        │        消息往返          │
   ┌────▼─────┐             ┌─────▼────┐
   │  插件 A   │             │  插件 B   │   每个插件一个独立进程
   │ 隔离沙箱  │             │ 隔离沙箱  │   只能访问注入的 splayer
   └──────────┘             └──────────┘
```

正因如此，插件之间、插件与应用之间彼此隔离：

- **崩溃互不影响**：某个插件崩溃只影响它自己，会被自动重启，不波及应用或其他插件；
- **卡死可恢复**：脚本卡死（如死循环）会被检测并自动重启；
- **数据隔离**：插件读不到应用或别的插件的数据，只能通过 `splayer.storage` 持久化自己的数据。

### 两种交互模型

**音源插件是「被调用方」**：当播放器需要某首歌的播放地址时，会选中一个已就绪、支持该音源的插件，调用你注册的 `musicUrl` 处理器，由你返回真实地址。

**控制插件是「被通知方」**：当播放状态（曲目、歌词、播放态）变化时，宿主把变化推送到你注册的事件回调；你也可以反过来调用 `splayer.player.*` 控制播放器。

### 生命周期与状态

```
安装 → 解析头部 → [启用] → 启动进程并运行脚本 → register() 声明能力 → ready
     → (崩溃) → 自动重启 → ready
     → [禁用] → 停止 → disabled
     → 卸载 → 删除脚本与本地数据
```

插件卡片上的状态徽章对应下列状态：

| 状态       | 含义                                              |
| ---------- | ------------------------------------------------- |
| `loading`  | 已启动，等待脚本就绪                              |
| `ready`    | 已就绪，可用                                      |
| `error`    | 加载/运行失败或崩溃超限，卡片下方显示错误码与原因 |
| `disabled` | 已被用户禁用                                      |

::: tip 崩溃自愈
插件崩溃或卡死后会自动重启（按 **2s → 8s → 30s** 退避），连续失败 3 次后置为 `error`，不再重试。
:::

## 脚本头部（Manifest）

脚本以一段头部 JSDoc 块注释声明元数据：

```js
/**
 * @name        Example
 * @version     1.0.0
 * @description 示例插件
 * @author      you
 * @homepage    https://example.com
 * @type        source
 * @apiLevel    2
 */
```

| 字段           | 必填 | 说明                                                                 |
| -------------- | ---- | -------------------------------------------------------------------- |
| `@name`        | ✅   | 插件展示名（最长 24 字符）                                           |
| `@version`     | ✅   | 版本号                                                               |
| `@description` |      | 简介                                                                 |
| `@author`      |      | 作者                                                                 |
| `@homepage`    |      | 主页 URL                                                             |
| `@type`        |      | `source`（默认）或 `control`，决定插件类型                           |
| `@platform`    |      | `splayer`（默认）或 `lx`；`gz_` 压缩脚本默认按 `lx` 处理             |
| `@apiLevel`    |      | 声明兼容的 [API 级别](#api-级别)，当前宿主为 `2`；控制插件需声明 `2` |

::: warning
缺少 `@name` 或 `@version` 会导致导入失败。插件 ID 由宿主依据「名称 + 源码哈希」自动生成，**无需也无法手动指定**——同一份脚本的 ID 始终一致，改动脚本会生成新 ID。
:::

## API 级别

`@apiLevel` 声明插件需要的宿主能力级别。能力是**累加**的：高级别包含低级别的全部能力，新增能力会提升级别。每个版本引入的能力都记录在下表，便于对照：

| 级别 | 引入的能力                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `1`  | 音源能力：`register({ sources })`、`musicUrl` 处理器，以及通用 API（`request` / `storage` / `log` / `getSetting` / `utils`） |
| `2`  | 控制能力：`register({ events, controls, settings })`、`splayer.player` 事件订阅与反向控制、`onSettingChange`                 |

当前宿主级别为 **2**。规则：

- 声明值**必须 ≤ 当前宿主级别**，否则拒绝加载并报 `PLUGIN_API_LEVEL_MISMATCH`（需等应用升级）；
- 声明你实际用到的**最低**级别即可——只做音源写 `1`，用到任何控制能力写 `2`；
- 控制插件（`@type control`）必须声明 `2`，否则控制能力在运行时不可用。

::: tip
后续版本若新增插件能力，会提升宿主级别并在上表追加一行。你的插件声明的级别不变即可继续运行（向后兼容），用到新能力时再相应提高 `@apiLevel`。
:::

## 沙箱环境

插件脚本运行在受限沙箱中，与应用其余部分相互隔离：

- **没有** Node 内置模块（`fs` / `net` / `path` 等）、**没有** `require` / `import`、**没有** DOM 与 Electron API；
- **可用全局**：`splayer`、`Buffer`、`URL` / `URLSearchParams`、`TextEncoder` / `TextDecoder`、`btoa` / `atob`、`Promise`、`queueMicrotask`、定时器（`setTimeout` / `setInterval` / `setImmediate` 及其 clear 版本），以及 `console`（自动转发到 `splayer.log`）；
- **网络**只能经 `splayer.request` 发起，且仅允许 `http://` / `https://`；
- 脚本**顶层同步执行**有 5 秒时限，超时视为加载失败。请把耗时逻辑放进异步处理器，不要在顶层做同步重计算。

## 通用 API

宿主在沙箱全局注入 `splayer` 对象。下列接口对**音源**与**控制**两类插件通用；类型特定的接口（`splayer.register` 的入参、`splayer.on` / `splayer.player` 等）见各自的文档。

### 属性

| 属性                 | 类型     | 说明                       |
| -------------------- | -------- | -------------------------- |
| `splayer.pluginId`   | `string` | 宿主分配的插件 ID          |
| `splayer.apiLevel`   | `number` | 宿主 Host API 级别         |
| `splayer.locale`     | `string` | 当前界面语言（如 `zh-CN`） |
| `splayer.appVersion` | `string` | 应用版本                   |

### `splayer.request(url, options?)`

发起 HTTP 请求。仅允许 `http://` / `https://`，并遵循系统代理。

| 参数      | 类型     | 必填 | 说明           |
| --------- | -------- | ---- | -------------- |
| `url`     | `string` | ✅   | 请求地址       |
| `options` | `object` |      | 请求选项，见下 |

`options` 结构：

| 字段           | 类型                                  | 默认     | 说明                       |
| -------------- | ------------------------------------- | -------- | -------------------------- |
| `method`       | `"GET" \| "POST"`                     | `"GET"`  | 请求方法                   |
| `headers`      | `Record<string, string>`              | —        | 请求头                     |
| `body`         | `string \| ArrayBuffer \| Uint8Array` | —        | 请求体                     |
| `timeout`      | `number`                              | `15000`  | 超时（毫秒，最大 `60000`） |
| `responseType` | `"text" \| "json" \| "arraybuffer"`   | `"text"` | 响应解析方式               |

返回 `Promise<Result>`：

| 字段      | 类型                     | 说明                                                         |
| --------- | ------------------------ | ------------------------------------------------------------ |
| `status`  | `number`                 | HTTP 状态码                                                  |
| `headers` | `Record<string, string>` | 响应头                                                       |
| `body`    | `unknown`                | `text` → 字符串；`json` → 对象；`arraybuffer` → `Uint8Array` |

```js
const resp = await splayer.request("https://api.example.com/song?id=1", {
  method: "GET",
  headers: { "User-Agent": "..." },
  responseType: "json",
});
console.log(resp.status, resp.body);
```

### `splayer.storage`

插件私有的键值存储，每个插件独立命名空间，卸载插件时一并清除。

| 方法                      | 返回                 | 说明       |
| ------------------------- | -------------------- | ---------- |
| `storage.get(key)`        | `Promise<T \| null>` | 读取一个键 |
| `storage.set(key, value)` | `Promise<void>`      | 写入一个键 |
| `storage.remove(key)`     | `Promise<void>`      | 删除一个键 |
| `storage.keys()`          | `Promise<string[]>`  | 列出所有键 |

### `splayer.getSetting(key)`

同步读取用户为该插件配置的值，未配置时返回 `undefined`。控制类插件通过 `splayer.register` 声明设置项，详见 [控制插件 · 设置项](/plugins/control#设置项)。

### `splayer.log`

输出日志，转发到宿主日志系统；脚本中的 `console.*` 也会转发到同一通道。

| 方法                 | 说明 |
| -------------------- | ---- |
| `log.debug(...args)` | 调试 |
| `log.info(...args)`  | 信息 |
| `log.warn(...args)`  | 警告 |
| `log.error(...args)` | 错误 |

### `splayer.utils`

常用工具的安全封装，无需自行引入 Node 模块。

| 命名空间       | 方法                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `utils.crypto` | `md5` / `sha1` / `sha256` / `hmac` / `randomBytes` / `aesEncrypt` / `aesDecrypt` / `rsaEncrypt` |
| `utils.buffer` | `from` / `bufToString` / `concat`                                                               |
| `utils.base64` | `encode` / `decode`                                                                             |
| `utils.zlib`   | `inflate` / `deflate` / `gunzip` / `gzip`                                                       |

## 资源约束与安全

| 约束         | 值    | 说明                                     |
| ------------ | ----- | ---------------------------------------- |
| 加载超时     | 10 秒 | 从 fork 到收到就绪信号，超时判为加载失败 |
| 顶层执行超时 | 5 秒  | 脚本同步部分的执行时限                   |
| 网络默认超时 | 15 秒 | `splayer.request` 默认值                 |
| 网络最大超时 | 60 秒 | `request` 的 `timeout` 上限              |
| 每插件并发   | 4     | 单个插件同时进行的调用上限               |
| 在线导入大小 | ~9 MB | 在线安装脚本的体积上限                   |

- 网络仅允许 `http(s)`，其余协议（`file://` 等）一律拒绝；
- 插件无法访问文件系统，唯一的持久化途径是 `splayer.storage`；
- 反向播放控制由宿主统一校验（如音量限定 `0~1`、`seek` 不得为负），非法入参会被忽略。

## 数据存储

```
{userData}/app-data/plugins/
├── scripts/        # 已安装脚本（明文 .js）
├── data/           # 各插件 storage 数据
└── manifest.json   # 已装插件的元数据索引
```

便携版整体迁移 `app-data` 目录即可带走全部插件与数据。

## 错误码

处理器抛异常时可通过 `err.code` 携带错误码，未携带时默认 `PLUGIN_HANDLER_ERROR`：

| Code                        | 含义                                           |
| --------------------------- | ---------------------------------------------- |
| `PLUGIN_ACTION_UNSUPPORTED` | 插件未注册该动作                               |
| `PLUGIN_SCRIPT_ERROR`       | 脚本语法或运行错误                             |
| `PLUGIN_INVALID_MANIFEST`   | 头部字段缺失或不合法                           |
| `PLUGIN_API_LEVEL_MISMATCH` | 声明的 `apiLevel` 高于宿主                     |
| `PLUGIN_REQUEST_TIMEOUT`    | 请求超时                                       |
| `PLUGIN_CANCELLED`          | 请求被取消（如切歌）                           |
| `PLUGIN_NETWORK_ERROR`      | 网络错误                                       |
| `PLUGIN_URL_NOT_ALLOWED`    | URL 协议不在白名单                             |
| `PLUGIN_INVALID_RESULT`     | 返回结果不合法（如 `musicUrl` 未含字符串 url） |
| `PLUGIN_NOT_READY`          | 插件未就绪                                     |
| `PLUGIN_WORKER_CRASHED`     | 子进程崩溃                                     |
| `PLUGIN_HANDLER_ERROR`      | 处理器默认错误码                               |

## 调试

在应用的 DevTools 控制台可直接调用插件接口验证：

```js
// 列出全部插件及状态
await window.api.plugins.list();

// 直接触发一次音源解析
await window.api.plugins.resolveUrl({
  pluginId: "my-plugin-xxxxxxxx",
  source: "sa",
  quality: "hq",
  musicInfo: { songmid: "123" },
});

// 修改某控制类插件的设置（会实时下发到插件）
await window.api.plugins.setSetting("my-plugin-xxxxxxxx", "someKey", true);
```

插件内的 `console.*` / `splayer.log.*` 输出会汇入应用主日志（`{userData}/app-data/logs/`）。修改脚本后重新导入一次即可，旧版本会被自动替换。
