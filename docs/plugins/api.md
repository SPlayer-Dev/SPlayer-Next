# 通用 API

本页介绍插件共用的方法。方法名均以 `splayer` 开头，时间单位为毫秒。

## 宿主信息 {#host}

以下属性无需权限，最低 API 级别为 1。

| 属性         | 类型     | 说明                 |
| ------------ | -------- | -------------------- |
| `pluginId`   | `string` | 插件 ID              |
| `apiLevel`   | `number` | 当前宿主 API 级别    |
| `locale`     | `string` | 应用语言，如 `zh-CN` |
| `appVersion` | `string` | 应用版本             |

## 能力注册 {#register}

在初始化阶段声明插件提供的能力。同一插件可以同时提供音源、订阅事件、设置和菜单。多次调用时，未传入的字段保持不变；传入的事件、控制标记、设置和菜单会替换对应声明。

**调用：** `splayer.register(args)`

**API 版本：** 1；事件、控制标记、设置和菜单声明从 2 起可用。

**权限：** 无；菜单显示和执行需要 `ui`。

**参数：**

- `args.sources`（`Record<string, SourceCapability>`，可选）：[音源能力](/plugins/source#register)。
- `args.events`（`PlaybackEventKind[]`，可选）：订阅的[播放事件](/plugins/control#event-types)，默认不订阅。
- `args.controls`（`boolean`，可选）：播放控制标记，默认 `false`。
- `args.settings`（`PluginSettingItem[]`，可选）：[用户设置](#setting-declarations)。
- `args.menus`（`PluginMenuItem[]`，可选）：[歌曲菜单](#menu-items)。

**返回：** `void`。

## 音乐服务 {#music}

### 在线搜索 {#search-online}

搜索在线歌曲，返回可直接播放或加入队列的 [Track](/types#track)。

**调用：** `splayer.music.searchOnline(options)`

**API 版本：** 4

**权限：** `network`

**参数：**

- `options.platform`（`"netease" | "qqmusic" | "kugou"`）：平台标识，必填
- `options.query`（`string`）：搜索词，去除首尾空格后 1–200 字符
- `options.page`（`number`）：可选，整数 1–100，默认 1
- `options.limit`（`number`）：可选，整数 1–50，默认 20

**返回：** `Promise<{ platform, page, total, hasMore, tracks }>`。`platform: string`、`page: number` 为本次查询的平台和页码；`total: number` 为匹配总数，`hasMore: boolean` 表示是否还有下一页，`tracks: Track[]` 为当前页曲目。

```js
const result = await splayer.music.searchOnline({
  platform: "netease",
  query: "demo",
  limit: 5,
});
splayer.log.info(result.tracks);
```

### 曲库搜索 {#search-library}

按标题、艺术家或专辑搜索已扫描的本地曲库。

**调用：** `splayer.music.searchLibrary(query, limit?)`

**API 版本：** 4

**权限：** `library`

**参数：**

- `query`（`string`）：搜索词，去除首尾空格后 1–200 字符
- `limit`（`number`）：可选，整数 1–100，默认 20

**返回：** `Promise<{ total: number; tracks: Track[] }>`，`total` 为匹配总数，`tracks` 为不超过 `limit` 的曲目列表。

```js
const { total, tracks } = await splayer.music.searchLibrary("demo", 10);
splayer.log.info(total, tracks);
```

### 平台接口 {#platform-api}

调用应用已有的平台接口，复用当前登录状态和请求处理。支持已有的读取与写入接口，无需另填 Cookie。

**调用：** `splayer.api.call(platform, name, params?)`

**API 版本：** 4

**权限：** `api`

**参数：**

- `platform`（`"netease" | "qqmusic" | "kugou"`）：平台标识
- `name`（`string`）：接口名，1–256 字符；`netease` 还支持 `/api/` 开头的业务路径
- `params`（`Record<string, unknown>`）：可选，默认 `{}`；字段由具体接口决定

**返回：** `Promise<ApiCallResponse>`，保留原接口的业务数据格式：

| 情况               | 响应                                                        |
| ------------------ | ----------------------------------------------------------- |
| `netease` 调用成功 | `{ ok: true, status: number, body: unknown }`               |
| 其他平台调用成功   | `{ ok: true, data: unknown }`                               |
| 接口调用失败       | `{ ok: false, error: string }`，可能附带 `status` 与 `body` |

`ok` 表示接口调用结果，业务是否成功还需检查 `body` 或 `data` 内的状态码。响应中的 Cookie、登录令牌等认证凭据会被移除。参数校验失败会 reject。

按路径调用时，`params` 是请求数据，可用 `crypto` 选择 `weapi`、`eapi`、`linuxapi`、`xeapi` 或 `api` 请求模式，默认 `api`：

::: code-group

```js [接口名称]
const result = await splayer.api.call("netease", "song_detail", { ids: "123" });
if (!result.ok) throw new Error(result.error);
if (result.body.code !== 200) throw new Error(result.body.message || "Request failed");
splayer.log.info(result.body.songs);
```

```js [业务路径]
const result = await splayer.api.call("netease", "/api/listen/together/status/get", {
  crypto: "api",
});
```

:::

路径不能是完整 URL。`params` 不接受 `cookie`、`domain`、`proxy` 和 `headers`；外部服务请求使用 [request](#request)。接口名及业务参数与应用接口模块一致，可查阅 [接口实现](https://github.com/SPlayer-Dev/SPlayer-Next/tree/dev/electron/main/apis)。

## 网络与通知 {#network}

### 网络请求 {#request}

通过系统代理发起 HTTP(S) 请求，只发送插件显式设置的 Cookie，不使用应用的 Cookie 存储。

**调用：** `splayer.request(url, options?)`

**API 版本：** 1

**权限：** `network`

**参数：**

- `url`（`string`）：完整的 `http://` 或 `https://` 地址
- `options`（`object`）：可选，请求选项
- `options.method`（`"GET" | "POST"`）：`"GET"`；请求方法
- `options.headers`（`Record<string, string>`）：请求头
- `options.body`（`string | ArrayBuffer | Uint8Array`）：请求体，JSON 需自行序列化
- `options.timeout`（`number`）：`15000`；超时，限制在 `1000`–`60000`
- `options.responseType`（`"text" | "json" | "arraybuffer"`）：`"text"`；响应解析方式

**返回：** `Promise<{ status: number; headers: Record<string, string>; body: unknown }>`。`body` 分别为字符串、解析后的 JSON 或 `Uint8Array`；JSON 解析失败时返回原始文本。检查 `status` 判断 HTTP 结果，网络失败会 reject。

```js
const response = await splayer.request("https://api.example.com/search?q=demo", {
  responseType: "json",
});
splayer.log.info(response.status, response.body);
```

### 系统通知 {#notify}

发送系统通知，标题为插件名称。

**调用：** `splayer.notify(message)`

**API 版本：** 4

**权限：** `ui`

**参数：**

- `message`（`string`）：通知正文，去除首尾空格后 1–1000 字符。

**返回：** `Promise<void>`。系统不支持通知时 reject；实际显示受系统通知设置影响。

```js
await splayer.notify("任务已完成");
```

## 数据存储 {#storage}

数据按插件 ID 保存，重启后保留，卸载插件时删除。`key` 为字符串，`value` 应为可 JSON 序列化的值。

### 读取值 {#storage-get}

读取指定键的值，不存在时返回 `null`。

**调用：** `splayer.storage.get(key)`

**API 版本：** 1

**权限：** 无

**参数：**

- `key`（`string`）：存储键名。

**返回：** `Promise<T | null>`。

### 写入值 {#storage-set}

保存数据，键已存在时覆盖原值。

**调用：** `splayer.storage.set(key, value)`

**API 版本：** 1

**权限：** 无

**参数：**

- `key`（`string`）：存储键名。
- `value`（`unknown`）：可 JSON 序列化的值。

**返回：** `Promise<void>`。

### 删除值 {#storage-remove}

删除指定键及其值，键不存在时不做处理。

**调用：** `splayer.storage.remove(key)`

**API 版本：** 1

**权限：** 无

**参数：**

- `key`（`string`）：存储键名。

**返回：** `Promise<void>`。

### 列出键名 {#storage-keys}

列出当前插件保存的所有键名。

**调用：** `splayer.storage.keys()`

**API 版本：** 1

**权限：** 无

**参数：** 无。

**返回：** `Promise<string[]>`。

```js
await splayer.storage.set("preferences", { enabled: true });
const preferences = await splayer.storage.get("preferences");
const keys = await splayer.storage.keys();
await splayer.storage.remove("preferences");
```

## 设置 {#settings}

### 声明设置 {#setting-declarations}

声明用户可编辑的插件配置项。

**调用：** `splayer.register({ settings })`

**API 版本：** 2

**权限：** 无

**参数：** `settings: PluginSettingItem[]`，每个设置项包含以下字段。

- `key`（`string`）：必填，设置键名
- `type`（`"switch" | "number" | "text" | "select"`）：必填，控件类型
- `label`（`string`）：必填，展示名称
- `default`（`boolean | number | string`）：必填，默认值，类型与控件一致
- `description`（`string`）：可选，说明
- `min` / `max`（`number`）：数字控件的范围，超出会被夹取
- `placeholder`（`string`）：文本控件占位文本
- `options`（`{ label: string; value: string }[]`）：选择控件的选项，保存 `value`

**控件类型**

| `type`   | 控件     | 值类型    | 专用字段                      |
| -------- | -------- | --------- | ----------------------------- |
| `switch` | 开关     | `boolean` | —                             |
| `number` | 数字输入 | `number`  | `min`、`max`                  |
| `text`   | 文本输入 | `string`  | `placeholder`                 |
| `select` | 下拉选择 | `string`  | `options`，值为选项的 `value` |

**返回：** `void`。

```js
splayer.register({
  settings: [
    { key: "enabled", type: "switch", label: "启用同步", default: true },
    { key: "interval", type: "number", label: "间隔（秒）", default: 30, min: 5 },
    { key: "token", type: "text", label: "访问令牌", default: "" },
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

### 读取设置 {#get-setting}

同步读取设置的当前值，未定义时返回 `undefined`。

**调用：** `splayer.getSetting(key)`

**API 版本：** 1

**权限：** 无

**参数：**

- `key`（`string`）：设置键名。

**返回：** `T | undefined`。

### 监听变更 {#setting-change}

设置变化时调用回调并传入新值，注册时不触发。

**调用：** `splayer.onSettingChange(key, handler)`

**API 版本：** 2

**权限：** 无

**参数：**

- `key`（`string`）：设置键名。
- `handler`（`(value: unknown) => void`）：接收新设置值的回调。

**返回：** `void`。

```js
const enabled = splayer.getSetting("enabled");
splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("enabled", value);
});
```

## 菜单扩展 {#menus}

### 菜单声明 {#menu-items}

在 `register.menus` 中声明菜单，展示于歌曲右键菜单及底栏「更多」菜单。

**调用：** `splayer.register({ menus })`

**API 版本：** 2

**权限：** `ui`

**参数：** `menus: PluginMenuItem[]`，每个菜单项包含以下字段。

- `id`（`string`）：必填，插件内唯一标识
- `label`（`string`）：必填，展示文本
- `sources`（`string[]`）：可选，曲目来源列表，取值见 [TrackSource](/types#tracksource)；省略时不限来源

**返回：** `void`。

### 菜单响应 {#menu-click}

注册菜单点击处理器，由宿主在用户点击时调用。重复注册同一动作会替换旧处理器。

**调用：** `splayer.on("menuClick", handler)`

**API 版本：** 2

**权限：** `ui`

**参数：**

- `handler`（`(req) => Promise<MenuClickRes>`）：菜单点击回调。
- `req.menuId`（`string`）：菜单标识。
- `req.track`（[Track](/types#track)）：操作的曲目。

**返回：** 注册方法返回 `void`；处理器返回对象，可组合以下字段，也可返回 `{}`。

| 结果字段   | 类型     | 说明                            |
| ---------- | -------- | ------------------------------- |
| `toast`    | `string` | 可选，显示轻提示                |
| `openUrl`  | `string` | 可选，用浏览器打开 HTTP(S) 链接 |
| `copyText` | `string` | 可选，复制到剪贴板              |

处理器限时 15 秒。菜单回调中的其他方法遵循各自的权限要求。

```js
/**
 * @name 歌曲工具
 * @id you.track-tools
 * @version 1.0.0
 * @apiLevel 2
 * @grant ui
 */
splayer.register({ menus: [{ id: "copy", label: "复制歌曲信息" }] });
splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId === "copy") {
    return { copyText: track.title + " - " + track.artists.map((a) => a.name).join(" / ") };
  }
  return {};
});
```

## 日志 {#log}

`args` 接收任意数量的值，输出到应用日志。各方法返回 `void`。

### 调试日志 {#log-debug}

输出调试信息。

**调用：** `splayer.log.debug(...args)`

**API 版本：** 1

**权限：** 无

**参数：**

- `...args`（`unknown[]`）：任意数量的日志内容。

**返回：** `void`。

### 普通日志 {#log-info}

输出普通信息。

**调用：** `splayer.log.info(...args)`

**API 版本：** 1

**权限：** 无

**参数：**

- `...args`（`unknown[]`）：任意数量的日志内容。

**返回：** `void`。

### 警告日志 {#log-warn}

输出警告信息。

**调用：** `splayer.log.warn(...args)`

**API 版本：** 1

**权限：** 无

**参数：**

- `...args`（`unknown[]`）：任意数量的日志内容。

**返回：** `void`。

### 错误日志 {#log-error}

输出错误信息。

**调用：** `splayer.log.error(...args)`

**API 版本：** 1

**权限：** 无

**参数：**

- `...args`（`unknown[]`）：任意数量的日志内容。

**返回：** `void`。

```js
splayer.log.debug("response", { status: 200 });
splayer.log.info("ready");
splayer.log.warn("empty result");
splayer.log.error("request failed");
```

## 哈希与加密 {#crypto}

以下方法均同步返回。`Bytes` 表示 `Buffer | Uint8Array`，`Input` 表示 `string | Uint8Array`。字符串输入默认使用 UTF-8，二进制输出为 `Buffer`。

**命名空间：** `splayer.utils.crypto`

### MD5 摘要 {#crypto-md5}

计算 MD5 摘要，返回十六进制字符串。

**调用：** `splayer.utils.crypto.md5(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Input`）：要处理的数据。

**返回：** `string`。

### SHA-1 摘要 {#crypto-sha1}

计算 SHA-1 摘要，返回十六进制字符串。

**调用：** `splayer.utils.crypto.sha1(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Input`）：要处理的数据。

**返回：** `string`。

### SHA-256 摘要 {#crypto-sha256}

计算 SHA-256 摘要，返回十六进制字符串。

**调用：** `splayer.utils.crypto.sha256(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Input`）：要处理的数据。

**返回：** `string`。

### HMAC 摘要 {#crypto-hmac}

使用指定算法和密钥计算 HMAC，返回十六进制字符串。

**调用：** `splayer.utils.crypto.hmac(algo, key, data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `algo`（`string`）：摘要算法，如 `sha256`。
- `key`（`Input`）：密钥。
- `data`（`Input`）：要处理的数据。

**返回：** `string`。

### 随机字节 {#crypto-random}

生成指定数量的随机字节。

**调用：** `splayer.utils.crypto.randomBytes(size)`

**API 版本：** 1

**权限：** 无

**参数：**

- `size`（`number`）：非负整数，随机字节数量。

**返回：** `Buffer`。

### AES 加密 {#crypto-aes-encrypt}

使用指定 AES 算法加密数据，密钥和初始化向量的长度须匹配算法。

**调用：** `splayer.utils.crypto.aesEncrypt(data, key, mode, iv?)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Input`）：要处理的数据。
- `key`（`Bytes`）：密钥。
- `mode`（`string`）：AES 算法名称，如 `aes-128-cbc`。
- `iv?`（`Bytes`）：可选，初始化向量，长度与算法匹配。

**返回：** `Buffer`。

### AES 解密 {#crypto-aes-decrypt}

使用加密时的密钥、算法和初始化向量解密数据。

**调用：** `splayer.utils.crypto.aesDecrypt(data, key, mode, iv?)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。
- `key`（`Bytes`）：密钥。
- `mode`（`string`）：AES 算法名称，如 `aes-128-cbc`。
- `iv?`（`Bytes`）：可选，初始化向量，长度与算法匹配。

**返回：** `Buffer`。

### RSA 加密 {#crypto-rsa}

使用 PEM 格式的公钥加密数据，采用 OAEP 填充。

**调用：** `splayer.utils.crypto.rsaEncrypt(data, publicKey)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。
- `publicKey`（`string`）：PEM 格式公钥。

**返回：** `Buffer`。

```js
const { crypto, buffer } = splayer.utils;
const data = buffer.from("demo");
splayer.log.info(crypto.md5(data), crypto.sha1(data), crypto.sha256(data));
const signature = crypto.hmac("sha256", "secret", data);
const key = crypto.randomBytes(16);
const iv = crypto.randomBytes(16);
const encrypted = crypto.aesEncrypt(data, key, "aes-128-cbc", iv);
const decrypted = crypto.aesDecrypt(encrypted, key, "aes-128-cbc", iv);
splayer.log.info(buffer.bufToString(decrypted));
```

`rsaEncrypt` 调用示例，`publicKeyPem` 为服务方提供的有效 PEM 公钥：

```js
const encrypted = splayer.utils.crypto.rsaEncrypt(splayer.utils.buffer.from("demo"), publicKeyPem);
```

## 字节数组 {#buffer}

**命名空间：** `splayer.utils.buffer`

### 创建字节数组 {#buffer-from}

将字符串或二进制数据转换为 Buffer。

**调用：** `splayer.utils.buffer.from(data, enc?)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`string | ArrayBuffer | SharedArrayBuffer | Uint8Array | number[]`）：要处理的数据。
- `enc?`（`string`）：可选，字符串编码，默认 `utf8`。

**返回：** `Buffer`。

### 解码文本 {#buffer-string}

按指定编码将字节数组转换为字符串，默认使用 UTF-8。

**调用：** `splayer.utils.buffer.bufToString(buf, enc?)`

**API 版本：** 1

**权限：** 无

**参数：**

- `buf`（`Bytes`）：要解码的字节数组。
- `enc?`（`string`）：可选，字符串编码，默认 `utf8`。

**返回：** `string`。

### 合并字节数组 {#buffer-concat}

按顺序连接多个字节数组。

**调用：** `splayer.utils.buffer.concat(list)`

**API 版本：** 1

**权限：** 无

**参数：**

- `list`（`Bytes[]`）：按顺序连接的字节数组列表。

**返回：** `Buffer`。

```js
const a = splayer.utils.buffer.from("hello");
const b = splayer.utils.buffer.from("20776f726c64", "hex");
const joined = splayer.utils.buffer.concat([a, b]);
splayer.log.info(splayer.utils.buffer.bufToString(joined, "utf8"));
```

## Base64 编码 {#base64}

**命名空间：** `splayer.utils.base64`

### 编码文本 {#base64-encode}

将数据编码为 Base64 字符串。

**调用：** `splayer.utils.base64.encode(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Input`）：要处理的数据。

**返回：** `string`。

### 解码文本 {#base64-decode}

将 Base64 字符串解码为 UTF-8 文本。

**调用：** `splayer.utils.base64.decode(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`string`）：要处理的数据。

**返回：** `string`。

```js
const encoded = splayer.utils.base64.encode("hello");
const text = splayer.utils.base64.decode(encoded);
```

## 压缩与解压 {#zlib}

**命名空间：** `splayer.utils.zlib`

### zlib 压缩 {#zlib-deflate}

将数据压缩为 zlib 格式。

**调用：** `splayer.utils.zlib.deflate(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。

**返回：** `Buffer`。

### zlib 解压 {#zlib-inflate}

解压 zlib 格式的数据。

**调用：** `splayer.utils.zlib.inflate(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。

**返回：** `Buffer`。

### gzip 压缩 {#zlib-gzip}

将数据压缩为 gzip 格式。

**调用：** `splayer.utils.zlib.gzip(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。

**返回：** `Buffer`。

### gzip 解压 {#zlib-gunzip}

解压 gzip 格式的数据。

**调用：** `splayer.utils.zlib.gunzip(data)`

**API 版本：** 1

**权限：** 无

**参数：**

- `data`（`Bytes`）：要处理的数据。

**返回：** `Buffer`。

```js
const data = splayer.utils.buffer.from("hello");
const packed = splayer.utils.zlib.deflate(data);
const unpacked = splayer.utils.zlib.inflate(packed);
const gzipped = splayer.utils.zlib.gzip(data);
const restored = splayer.utils.zlib.gunzip(gzipped);
```
