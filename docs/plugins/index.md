# 插件总览与架构

SPlayer-Next 内置一套插件系统，允许用第三方 JavaScript 扩展应用能力。每个插件都是一段运行在**独立隔离沙箱**中的脚本，通过宿主注入的全局对象 `splayer` 与应用交互。

本文介绍插件系统的整体架构、运行模型与两类插件共用的通用 API。具体的编写方式见：

- [音源插件](/plugins/source)：解析歌曲的播放地址（`musicUrl`），并可兜底歌词与封面（内置来源拿不到时，不限在线平台）。
- [控制插件](/plugins/control)：监听播放状态、反向控制播放、声明设置项、向歌曲菜单添加菜单项。
- [插件更新](/plugins/update)：脚本如何声明更新地址、宿主如何检查版本、用户如何一键更新（两类插件通用）。

最终用户的安装与管理方式见 [插件使用](/plugins-usage)。

## 插件能做什么

| 类型                         | `@type`   | 用途                                                                        |
| ---------------------------- | --------- | --------------------------------------------------------------------------- |
| [音源插件](/plugins/source)  | `source`  | 为歌曲提供可播放的 URL，扩展可播放的曲库                                    |
| [控制插件](/plugins/control) | `control` | 订阅播放/歌词事件，反向控制播放器，声明用户设置项，并可向歌曲菜单添加菜单项 |

一个脚本只能是其中一种类型，由头部 `@type` 决定，缺省为 `source`。

插件系统仍在持续演进，上表是目前已支持的类型，后续会按需引入更多类型。新类型同样通过 `@type` 声明，并在 [API 级别与变更记录](#api-级别与变更记录) 中标注所需级别——已有插件不受影响。

## 发布到插件市场

写好的插件可以提交到官方插件市场，通过审核后会出现在应用内「设置 → 插件管理 → 插件市场」，所有用户可一键安装与更新。

提交流程全程在 GitHub 上完成：

1. 在仓库 [SPlayer-Dev/plugins](https://github.com/SPlayer-Dev/plugins) 新建 Issue，选择「新建插件」模板，按表单填写并附上你的 `.js` 脚本；
2. 自动检查会校验脚本头部与规范，通过后生成待审核的 PR；
3. 维护者审核，通过并合并后自动重建市场索引，插件随即在市场可见。

发布新版本同样发 Issue，改选「更新插件」模板上传新脚本即可——只要 `@id` 不变，用户便能在应用内一键原地更新（详见 [插件更新](/plugins/update)）。

## 技术架构

### 进程模型

**所有启用的插件共享一个独立的「插件 host」进程**，每个插件在其中跑在自己的 `node:vm` 沙箱上下文里。host 与应用主进程/界面之间隔着进程边界，脚本只能访问宿主注入的 `splayer`，既看不到应用内存，也看不到其他插件的数据。

```
┌──────────── SPlayer-Next 主进程 / 界面 ────────────┐
│            播放器 · 插件管理 · 网络 / 存储           │
└─────────────────────────┬──────────────────────────┘
                          │  消息往返（按 pluginId 路由）
               ┌──────────▼───────────┐
               │      插件 host 进程    │
               │  ┌────────┐ ┌───────┐ │  每个插件一个 vm 上下文
               │  │ 插件 A │ │ 插件 B │ │  只能访问注入的 splayer
               │  └────────┘ └───────┘ │
               └──────────────────────┘
```

由此，对你写插件意味着：

- **一个插件出问题不连累全局**：host 是独立进程，单个插件抛错或崩溃不会拖垮应用界面，正在播放的音频也照常播放。
- **别写阻塞或死循环**：所有插件共享 host 的一条事件循环，某个插件长时间卡死会拖住同进程的其它插件，并最终触发看门狗重启整个 host（崩溃自愈见[下文](#生命周期与状态)）。
- **数据是隔离的**：插件读不到应用或别的插件的数据，只能通过 `splayer.storage` 持久化自己的数据。

### 两种交互模型

**音源插件是「被调用方」**：当播放器需要某首歌的播放地址时，会选中一个已就绪、支持该音源的插件，调用你注册的 `musicUrl` 处理器，由你返回真实地址。

**控制插件是「被通知方」**：当播放状态（曲目、歌词、播放态）变化时，宿主把变化推送到你注册的事件回调；你也可以反过来调用 `splayer.player.*` 控制播放器。

### 生命周期与状态

```
安装 → 解析头部 → [启用] → 在 host 里建 vm 上下文并运行脚本 → register() 声明能力 → ready
     → (host 崩溃) → 整体重载 → ready
     → [禁用] → 软卸载（dispose 上下文，不影响其它插件） → disabled
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
插件 host 崩溃或卡死后会自动重启并重载所有已启用插件（按 **2s → 8s → 30s** 退避），连续失败 3 次后置为 `error`。单个插件加载/运行出错只置该插件为 `error`，不影响其它插件。
:::

## 脚本头部（Manifest）

脚本以一段头部 JSDoc 块注释声明元数据：

```js
/**
 * @name        Example
 * @id          you.example
 * @version     1.0.0
 * @description 示例插件
 * @author      you
 * @homepage    https://example.com
 * @type        source
 * @apiLevel    2
 */
```

| 字段           | 必填 | 说明                                                                                                                         |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@name`        |      | 插件展示名（最长 24 字符）；缺省时使用脚本内容生成的兼容名称                                                                 |
| `@version`     |      | 版本号；缺省为 `0.0.0`                                                                                                       |
| `@id`          |      | 插件身份标识（建议反向域名式，如 `you.my-plugin`）；不写则由名称推导                                                         |
| `@description` |      | 简介                                                                                                                         |
| `@author`      |      | 作者                                                                                                                         |
| `@homepage`    |      | 主页 URL                                                                                                                     |
| `@grant`       |      | 控制插件声明权限：`network`（联网）/ `control`（控制播放器）/ `ui`（扩展界面，如菜单项），逗号分隔；音源插件自动获 `network` |
| `@type`        |      | `source`（音源，默认）或 `control`（控制）；**建议显式声明**，决定插件类型与权限默认                                         |
| `@apiLevel`    |      | 声明兼容的 [API 级别与变更记录](#api-级别与变更记录)，当前宿主为 `3`；具体能力所需级别以该表为准                             |
| `@updateUrl`   |      | 更新检查地址，详见 [插件更新](/plugins/update)                                                                               |
| `@changelog`   |      | 更新说明，详见 [插件更新](/plugins/update)                                                                                   |

::: warning
为了获得稳定的展示与更新行为，原生 SPlayer 插件应显式声明 `@name`、`@version` 和 `@id`，插件市场也会校验这些字段。插件**身份 ID** 优先取 `@id`（作者声明，跨版本或改名都不变）；未声明时由名称推导（纯非 ASCII 名会退化为名称哈希以避免冲突）。ID 与源码内容无关，因此**重新导入同一身份的脚本会原地替换**。发布新版时只改 `@version` 与脚本内容，别动 `@id`（未声明 ID 时也别动 `@name`），详见 [插件更新](/plugins/update)。
:::

## 权限

宿主按权限放行插件的敏感能力：

| 权限      | 门控的 API            | 说明                   |
| --------- | --------------------- | ---------------------- |
| `network` | `splayer.request`     | 发起网络请求           |
| `control` | `splayer.player.*`    | 反向控制播放器         |
| `ui`      | `register({ menus })` | 向歌曲菜单等界面添加项 |

- **音源插件**（`@type source`，含缺省）**自动获得 `network`**，无需声明——联网解析 URL 是其本职。
- **控制插件**（`@type control`）要联网（如把当前曲目/歌词推给外部服务）必须声明 `@grant network`；要反向控制播放器必须声明 `@grant control`；要向歌曲菜单添加菜单项必须声明 `@grant ui`（详见 [控制插件 · 菜单扩展](/plugins/control#菜单扩展)）。
- 未授予对应权限时，`splayer.request` 以 `PLUGIN_PERMISSION_DENIED` 失败，`splayer.player.*` 调用被忽略，未授权的 `menus` 声明会被丢弃。

## API 级别与变更记录

`@apiLevel` 声明插件需要的宿主能力级别。能力是**累加**的：高级别包含低级别的全部能力，新增能力会提升级别。这里是插件 API 级别的唯一变更记录；其它页面只说明具体能力要求的最低级别。

| 级别 | 相对上一等级新增的能力                                                                                                                                                                  | 用到这些能力时                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `1`  | 基础音源能力：`register({ sources })`、`musicUrl` 处理器；元数据兜底处理器：`musicSearch` / `musicLyric` / `musicPic`；通用 API：`request` / `storage` / `log` / `getSetting` / `utils` | 播放地址、歌词、封面插件声明 `@apiLevel 1` 即可 |
| `2`  | 控制能力：`register({ events, controls, settings })`、`splayer.player` 事件订阅与反向控制、`onSettingChange`；界面能力：`register({ menus })`、`menuClick` 处理器（需 `@grant ui`）     | 控制插件或菜单扩展声明 `@apiLevel 2`            |
| `3`  | 评论能力：`musicComment` 处理器。宿主先用 `musicSearch` 匹配曲目，再向声明了 `musicComment` 的源请求热门 / 最新评论                                                                     | 评论插件能力声明 `@apiLevel 3`                  |

当前宿主级别为 **3**。规则：

- 声明值**必须 ≤ 当前宿主级别**，否则拒绝加载并报 `PLUGIN_API_LEVEL_MISMATCH`（需等应用升级）；
- 声明你实际用到的**最低**级别即可——只做播放地址 / 歌词 / 封面写 `1`，用到任何控制能力写 `2`，用到评论能力写 `3`；
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
| 在线导入大小 | ~9 MB | 在线安装脚本的体积上限                   |

- 网络仅允许 `http(s)`，其余协议（`file://` 等）一律拒绝；
- 插件通过 `splayer.*` 与宿主交互，持久化只走 `splayer.storage`；
- 反向播放控制由宿主统一校验（如音量限定 `0~1`、`seek` 不得为负），非法入参会被忽略。

::: warning 沙箱是稳定性边界，不是安全边界
插件运行在独立子进程里，崩溃或卡死不会拖垮主程序——但这套隔离防的是**故障**，不是**恶意**。脚本本质上是在你机器上以你的权限执行的代码，能联网、能持久化数据。**安装一个插件等同于信任它，如同运行一个程序**，请只安装来源可信的脚本。
:::

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
  pluginId: "my-plugin-splayer",
  source: "wy",
  quality: "hq",
  musicInfo: { songmid: "123" },
});

// 修改某控制类插件的设置（会实时下发到插件）
await window.api.plugins.setSetting("my-plugin-splayer", "someKey", true);
```

插件内的 `console.*` / `splayer.log.*` 输出会汇入应用主日志（`{userData}/app-data/logs/`）。修改脚本后重新导入一次即可，旧版本会被自动替换。
