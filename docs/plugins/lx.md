# LX 兼容

SPlayer-Next 可导入 LX 的 `user_api` 音源脚本。应用自动注入 `lx` 兼容接口，无需修改脚本入口。

## 导入脚本

在**设置 → 插件管理**中使用本地导入或在线导入，操作见[插件使用](/plugins-usage)。

支持普通 `.js` 脚本及以 `gz_` 开头的压缩脚本内容。压缩内容会自动解码、解压，无需手动处理。

## 兼容范围

兼容层支持播放地址解析、网络请求、更新提示，以及 `lx.utils.crypto`、`lx.utils.buffer`、`lx.utils.zlib` 工具。LX 的歌词、搜索等其他动作尚未接入；依赖这些动作或其他未实现接口的脚本不能直接使用。

| 属性                   | 值或说明                                                                         |
| ---------------------- | -------------------------------------------------------------------------------- |
| `lx.version`           | `"2.0.0"`，兼容接口版本，与[插件 API 级别](/plugins/changelog)无关               |
| `lx.env`               | `"desktop"`                                                                      |
| `lx.currentScriptInfo` | 当前脚本的 `name`、`description`、`version`、`author`、`homepage` 和 `rawScript` |
| `lx.EVENT_NAMES`       | `request`、`inited`、`updateAlert`                                               |

可通过 `lx`、`globalThis.lx` 或 `window.lx` 访问接口。`window` 仅用于脚本兼容，不提供浏览器 DOM。

开发新插件可使用[通用 API](/plugins/api)和[音源解析](/plugins/source)。

## 音源接入

### 声明能力

向宿主声明支持的来源与音质。每次脚本加载只能声明一次。

**调用：** `lx.send(lx.EVENT_NAMES.inited, data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data.sources: Record<string, Source>`：来源声明，播放解析使用 `wy`、`tx`、`kg`。
- `Source.name?: string`：来源显示名称。
- `Source.actions: string[]`：支持的动作，当前仅接入 `"musicUrl"`；未包含此动作的来源会被忽略。
- `Source.qualitys: string[]`：支持的 LX 音质；也接受 `qualities`，同时提供时以 `qualitys` 为准。

**返回：** `Promise<void>`。重复声明会拒绝。

```js
lx.send(lx.EVENT_NAMES.inited, {
  sources: {
    wy: {
      name: "示例来源",
      actions: ["musicUrl"],
      qualitys: ["128k", "320k", "flac"],
    },
  },
}).catch((error) => console.error(error));
```

### 解析地址

注册播放地址处理器，播放器需要解析地址时调用。重复注册会替换上一个处理器。

**调用：** `lx.on(lx.EVENT_NAMES.request, handler)`

**API 版本：** 1

**权限：** 无；处理器内的网络请求需要 `network`

**参数：**

- `handler: (request) => string | { url: string } | Promise<string | { url: string }>`：返回播放地址的处理器。
- `request.source: string`：来源标识。
- `request.action: "musicUrl"`：解析动作。
- `request.info.type?: string`：LX 音质，见下表。
- `request.info.musicInfo: object`：歌曲信息，包含 `id`、`songmid`、`songId`、`name`、`singer`、`albumId`、`albumName`、`img` 等字段；来源相关标识按歌曲数据提供。

**返回：** `Promise<void>`，表示处理器已注册。仅支持订阅 `request` 事件。

| 宿主音质   | LX 请求中的 `type` |
| ---------- | ------------------ |
| `lq`       | `128k`             |
| `sq`       | `192k`             |
| `hq`       | `320k`             |
| `lossless` | `flac`             |
| `hi-res`   | `flac24bit`        |

## 网络请求

### 发送请求

发送 HTTP(S) 请求，通过回调接收结果。网络请求使用系统代理。

**调用：** `lx.request(url, options, callback)`

**API 版本：** 1

**权限：** `network`

**参数：**

- `url: string`：请求地址。
- `options?: object`：请求选项，无需选项时传入 `undefined`。
- `options.method?: "GET" | "POST"`：默认 `"GET"`。
- `options.headers?: Record<string, string>`：请求头。
- `options.timeout?: number`：超时毫秒数，默认 15,000，范围 1,000–60,000。
- `options.body?: string | Uint8Array | ArrayBuffer | object`：请求体，对象会序列化为 JSON。
- `options.form?: Record<string, unknown>`：表单字段，按 URL 编码发送；也接受 `formData`，不支持 multipart。提供 `body` 时优先使用 `body`。
- `callback: (error, response, body) => void`：成功时 `error` 为 `null`；`response` 包含 `statusCode`、`statusMessage`、`headers`、`bytes`、`raw`、`body`。响应文本可解析为 JSON 时，`body` 为解析结果，否则为字符串；失败时传入错误、`undefined` 和 `null`。

**返回：** `() => void`。调用后停止回调交付，底层请求仍会继续执行。`raw` 是响应文本重新编码的 Buffer，不适合下载二进制文件。

```js
lx.request("https://example.com/api/status", undefined, (error, response, body) => {
  if (error) {
    console.error(error);
    return;
  }
  console.log(response.statusCode, body);
});
```

## 插件更新

### 发送提示 {#update-alert}

向宿主上报更新提示。每次脚本加载只能发送一次。

**调用：** `lx.send(lx.EVENT_NAMES.updateAlert, data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data.log?: string`：更新说明。
- `data.updateUrl?: string`：下载或介绍页地址。
- `data.version?: string`：新版本号，省略时显示有更新。

**返回：** `Promise<void>`。重复发送会拒绝。

```js
lx.send(lx.EVENT_NAMES.updateAlert, {
  log: "修复连接问题",
  updateUrl: "https://example.com/plugins/example.js",
}).catch((error) => console.error(error));
```

如果地址指向介绍页，用户可打开该页面下载并重新导入脚本。通过脚本头声明更新地址的方式见[插件更新](/plugins/update)。
