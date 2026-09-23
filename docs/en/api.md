# External API (HTTP)

SPlayer-Next provides an optional local HTTP API for inspecting and controlling playback. Use the [WebSocket API](/en/socket) for realtime events and [MCP](/en/mcp) for AI applications.

::: warning Disabled by default
Enable it under **Settings → External API**. The server binds to `127.0.0.1` by default and has **no authentication**. Enable LAN access only on a trusted network.
:::

MCP has its own switch, port, and lifecycle and does not depend on this API.

## Conventions

- **Base URL:** `http://127.0.0.1:<port>/api`
- **Default port:** `14558`
- **Format:** JSON requests and responses (`Content-Type: application/json`)
- **Time unit:** milliseconds
- **Successful controls:** `{ "ok": true }`
- **Invalid input:** HTTP `400` with `{ "error": "<reason>" }`

## Endpoints

| Method | Path               | Description                               |
| ------ | ------------------ | ----------------------------------------- |
| `GET`  | `/api/info`        | Application and connection information    |
| `GET`  | `/api/status`      | Playback status                           |
| `GET`  | `/api/volume`      | Current volume                            |
| `GET`  | `/api/now-playing` | Lightweight snapshot without full lyrics  |
| `GET`  | `/api/lyrics`      | Fully parsed lyrics for the current track |
| `POST` | `/api/play`        | Play                                      |
| `POST` | `/api/pause`       | Pause                                     |
| `POST` | `/api/stop`        | Stop                                      |
| `POST` | `/api/next`        | Next track                                |
| `POST` | `/api/prev`        | Previous track                            |
| `POST` | `/api/seek`        | Seek                                      |
| `POST` | `/api/volume`      | Set volume                                |

## Queries

### Application information

```http
GET /api/info
```

```json
{ "name": "SPlayer-Next", "version": "1.0.0", "wsClients": 0 }
```

### Playback status

```http
GET /api/status
```

```json
{
  "state": "playing",
  "position": 12000,
  "duration": 240000,
  "volume": 1,
  "isFinished": false
}
```

| Field        | Type      | Description                         |
| ------------ | --------- | ----------------------------------- |
| `state`      | `string`  | State such as `playing` or `paused` |
| `position`   | `number`  | Current position in milliseconds    |
| `duration`   | `number`  | Total duration in milliseconds      |
| `volume`     | `number`  | Volume from 0 to 1                  |
| `isFinished` | `boolean` | Whether the current track has ended |

### Volume

```http
GET /api/volume
```

```json
{ "volume": 1 }
```

### Now playing

```http
GET /api/now-playing
```

Returns a lightweight snapshot suitable for frequent polling. `lyricAvailable` indicates whether lyrics exist and `lyricLineCount` is their line count. Fetch `/api/lyrics` only when needed.

### Lyrics

```http
GET /api/lyrics
```

Returns parsed lyrics, source information, and offset. `lyric` is a structured JSON array, avoiding double-encoded JSON strings.

## Playback control

The following endpoints take no body and return `{ "ok": true }`:

```http
POST /api/play
POST /api/pause
POST /api/stop
POST /api/next
POST /api/prev
```

### Seek

```http
POST /api/seek
```

```json
{ "positionMs": 60000 }
```

`positionMs` is required, must be a number, and must be at least `0`.

### Set volume

```http
POST /api/volume
```

```json
{ "volume": 0.5 }
```

`volume` is required and must be between `0` and `1`.

## Examples

```bash
curl http://127.0.0.1:14558/api/status

curl -X POST http://127.0.0.1:14558/api/play
curl -X POST http://127.0.0.1:14558/api/pause
curl -X POST http://127.0.0.1:14558/api/next

curl -X POST http://127.0.0.1:14558/api/seek \
  -H "Content-Type: application/json" \
  -d '{ "positionMs": 60000 }'

curl -X POST http://127.0.0.1:14558/api/volume \
  -H "Content-Type: application/json" \
  -d '{ "volume": 0.5 }'
```
