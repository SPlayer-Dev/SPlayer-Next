# MCP Interface

SPlayer-Next includes a [Model Context Protocol](https://modelcontextprotocol.io/) service that lets MCP clients inspect playback, search the local library, and control the player.

## Connection

MCP is disabled by default. Enable **Settings → AI Integration → MCP**, then use the port and connection key shown in Settings.

- **Transport:** Streamable HTTP
- **URL:** `http://127.0.0.1:<port>/mcp`
- **Default port:** `14559`
- **Session mode:** Stateful JSON responses; idle sessions are released automatically

```json
{
  "mcpServers": {
    "splayer-next": {
      "type": "http",
      "url": "http://127.0.0.1:14559/mcp",
      "headers": {
        "X-MCP-Key": "connection key shown in Settings"
      }
    }
  }
}
```

Client configuration fields vary. Keep SPlayer-Next running while the client is connected.

## Tools

| Tool                            | Parameters                             | Description                                            |
| ------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `get_playback_status`           | —                                      | Playback state, position, volume, and modes            |
| `get_now_playing`               | —                                      | Lightweight current-track snapshot without full lyrics |
| `play` / `pause` / `stop`       | —                                      | Playback control                                       |
| `next_track` / `previous_track` | —                                      | Change track                                           |
| `seek`                          | `positionMs`                           | Seek to a millisecond position                         |
| `set_volume`                    | `volume`                               | Set volume from `0` to `1`                             |
| `set_play_mode`                 | `repeat?`, `shuffle?`                  | Configure repeat and shuffle                           |
| `play_track`                    | `trackId?` or `track?`                 | Play by track ID (preferred) or full Track             |
| `add_to_queue`                  | `trackIds?` or `tracks?`, `position?`  | Add up to 50 tracks at `next` or `end`                 |
| `search_library`                | `query`, `limit?`                      | Search the local library; default 20, max 100          |
| `search_online_songs`           | `platform`, `query`, `page?`, `limit?` | Search online sources; max 50 per page                 |
| `get_random_tracks`             | `limit?`                               | Random tracks; default 10, max 50                      |
| `list_albums`                   | `limit?`                               | Album summaries; default 50, max 100                   |
| `list_artists`                  | `limit?`                               | Artist summaries; default 50, max 100                  |

## Resources

| URI                         | Description                        |
| --------------------------- | ---------------------------------- |
| `splayer://now-playing`     | Lightweight current-track snapshot |
| `splayer://library/summary` | Track, album, and artist counts    |

## Debugging with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Choose Streamable HTTP and enter `http://127.0.0.1:14559/mcp`. If it cannot connect, check the MCP switch, port, and connection key in Settings.
