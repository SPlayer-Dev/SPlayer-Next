# WebSocket API

WebSocket 接口在 [外部 API](/api) 的基础上提供**实时双向**通信：既能下发控制命令，也能订阅播放状态推送。

::: warning 默认关闭
WebSocket 需要在 **设置 → 外部 API** 中开启外部 API 后，**额外开启 WebSocket** 才会生效。安全约束与 HTTP 接口一致（默认仅本机、无鉴权）。
:::

## 连接

- **地址**：`ws://127.0.0.1:<port>/ws`
- **默认端口**：`14558`（与 HTTP 接口共用）

```javascript
const ws = new WebSocket("ws://127.0.0.1:14558/ws");
```

## 服务器 → 客户端

所有下行消息都带有 `kind` 字段：

| `kind`   | 形态                                                       | 说明                               |
| -------- | ---------------------------------------------------------- | ---------------------------------- |
| `hello`  | `{ "kind": "hello", "clients": N }`                        | 连接建立时发送，附当前连接数       |
| `event`  | `{ "kind": "event", "type", "data" }`                      | 播放事件推送（状态、进度、切歌等） |
| `ack`    | `{ "kind": "ack", "op" }`                                  | 命令执行成功的回执                 |
| `error`  | `{ "kind": "error", "op", "error" }`                       | 命令失败，`error` 为原因           |
| `result` | `{ "kind": "result", "op", "platform", "status", "body" }` | 查询结果；`body` 为网易云原始响应  |

## 客户端 → 服务器

下行命令为 JSON，统一通过 `op` 字段标识：

```json
{ "op": "play" }
```

| `op`          | 附加字段                                                     | 说明                                                            |
| ------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `play`        | —                                                            | 播放                                                            |
| `pause`       | —                                                            | 暂停                                                            |
| `stop`        | —                                                            | 停止                                                            |
| `next`        | —                                                            | 下一曲                                                          |
| `prev`        | —                                                            | 上一曲                                                          |
| `seek`        | `{ "positionMs": number }`                                   | 跳转（毫秒，≥0）                                                |
| `setVolume`   | `{ "volume": number }`                                       | 音量（0 ~ 1）                                                   |
| `searchSongs` | `{ "keyword": string, "offset"?: number, "limit"?: number }` | 搜索歌曲，固定使用网易云；默认 `offset=0`、`limit=30`，最大 100 |

非法 JSON 或未知 `op` 会收到 `{ "kind": "error", ... }`。

`searchSongs` 成功时返回网易云 `cloudsearch` 的原始响应体。网易云返回 `405` 时同样通过
`result` 原样返回其 `status` 和 `body`，不会切换到其它音源或改写错误内容。

## 示例

```javascript
const ws = new WebSocket("ws://127.0.0.1:14558/ws");

ws.onopen = () => {
  // 暂停播放
  ws.send(JSON.stringify({ op: "pause" }));
  // 跳转到 1 分钟处
  ws.send(JSON.stringify({ op: "seek", positionMs: 60000 }));
  // 搜索歌曲
  ws.send(JSON.stringify({ op: "searchSongs", keyword: "Daft Punk", limit: 10 }));
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  switch (msg.kind) {
    case "hello":
      console.log("已连接，当前客户端数：", msg.clients);
      break;
    case "event":
      console.log("播放事件：", msg.type, msg.data);
      break;
    case "ack":
      console.log("命令成功：", msg.op);
      break;
    case "error":
      console.warn("命令失败：", msg.op, msg.error);
      break;
    case "result":
      console.log("网易云搜索结果：", msg.status, msg.body);
      break;
  }
};
```
