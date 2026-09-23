# MCP 接口

SPlayer-Next 内置 [Model Context Protocol](https://modelcontextprotocol.io/) 服务，允许支持 MCP 的 AI 应用查询当前播放状态、本地曲库并控制播放器。

## 连接

MCP 服务默认关闭。先在 **设置 → AI 集成 → MCP** 中启用，再使用设置页显示的实际端口与连接密钥。

- **传输协议**：Streamable HTTP
- **地址**：`http://127.0.0.1:<port>/mcp`
- **默认端口**：`14559`
- **会话模式**：有状态 JSON 响应；空闲会话会自动释放

支持直接填写远程 MCP URL 的客户端可使用：

```json
{
  "mcpServers": {
    "splayer-next": {
      "type": "http",
      "url": "http://127.0.0.1:14559/mcp",
      "headers": {
        "X-MCP-Key": "设置页配置详情中显示的连接密钥"
      }
    }
  }
}
```

不同 AI 客户端的配置字段可能不同，请以客户端当前文档为准。连接前应保持 SPlayer-Next 正在运行。

## 工具

| 工具                  | 参数                                   | 说明                                       |
| --------------------- | -------------------------------------- | ------------------------------------------ |
| `get_playback_status` | —                                      | 获取播放状态、进度、音量和播放模式         |
| `get_now_playing`     | —                                      | 获取不含完整歌词正文的当前曲目轻量快照     |
| `play`                | —                                      | 继续播放                                   |
| `pause`               | —                                      | 暂停播放                                   |
| `stop`                | —                                      | 停止播放                                   |
| `next_track`          | —                                      | 下一曲                                     |
| `previous_track`      | —                                      | 上一曲                                     |
| `seek`                | `positionMs`                           | 跳转到指定毫秒位置                         |
| `set_volume`          | `volume`                               | 设置音量，范围 `0` 到 `1`                  |
| `set_play_mode`       | `repeat?`, `shuffle?`                  | 设置循环和随机播放模式                     |
| `play_track`          | `trackId?` 或 `track?`                 | 按曲目 ID（推荐）或完整 Track 立即播放     |
| `add_to_queue`        | `trackIds?` 或 `tracks?`, `position?`  | 添加最多 50 首；`position` 为 `next`/`end` |
| `search_library`      | `query`, `limit?`                      | 搜索本地曲库，默认返回 20 条，最多 100 条  |
| `search_online_songs` | `platform`, `query`, `page?`, `limit?` | 搜索在线音乐资源，单页最多返回 50 条       |
| `get_random_tracks`   | `limit?`                               | 随机获取曲目，默认 10 条，最多 50 条       |
| `list_albums`         | `limit?`                               | 获取专辑摘要，默认 50 条，最多 100 条      |
| `list_artists`        | `limit?`                               | 获取艺术家摘要，默认 50 条，最多 100 条    |

## 资源

| URI                         | 说明                           |
| --------------------------- | ------------------------------ |
| `splayer://now-playing`     | 不含完整歌词的当前播放轻量快照 |
| `splayer://library/summary` | 曲库歌曲、专辑与艺术家数量     |

## 使用 MCP Inspector 调试

```bash
npx @modelcontextprotocol/inspector
```

在 Inspector 中选择 Streamable HTTP，并填写 `http://127.0.0.1:14559/mcp`。如果连接失败，请检查 MCP 服务开关和设置页显示的实际端口。
