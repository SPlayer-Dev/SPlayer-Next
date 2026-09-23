# WebSocket API

The WebSocket interface adds realtime bidirectional communication to the [HTTP API](/en/api): clients can send controls and receive playback events.

::: warning Disabled by default
Enable **Settings → External API**, then enable WebSocket separately. It has the same security model as HTTP: loopback-only by default and no authentication.
:::

## Connection

- **URL:** `ws://127.0.0.1:<port>/ws`
- **Default port:** `14558`, shared with HTTP

```javascript
const ws = new WebSocket("ws://127.0.0.1:14558/ws");
```

## Server to client

Every message has a `kind` field:

| `kind`  | Shape                                 | Description                              |
| ------- | ------------------------------------- | ---------------------------------------- |
| `hello` | `{ "kind": "hello", "clients": N }`   | Sent on connection with the client count |
| `event` | `{ "kind": "event", "type", "data" }` | Playback event                           |
| `ack`   | `{ "kind": "ack", "op" }`             | Command succeeded                        |
| `error` | `{ "kind": "error", "op", "error" }`  | Command failed                           |

## Client to server

Commands are JSON objects identified by `op`:

```json
{ "op": "play" }
```

| `op`        | Additional fields          | Description            |
| ----------- | -------------------------- | ---------------------- |
| `play`      | —                          | Play                   |
| `pause`     | —                          | Pause                  |
| `stop`      | —                          | Stop                   |
| `next`      | —                          | Next track             |
| `prev`      | —                          | Previous track         |
| `seek`      | `{ "positionMs": number }` | Seek in milliseconds   |
| `setVolume` | `{ "volume": number }`     | Set volume from 0 to 1 |

Invalid JSON or an unknown `op` receives an error message.

## Example

```javascript
const ws = new WebSocket("ws://127.0.0.1:14558/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({ op: "pause" }));
  ws.send(JSON.stringify({ op: "seek", positionMs: 60000 }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  switch (message.kind) {
    case "hello":
      console.log("Connected clients:", message.clients);
      break;
    case "event":
      console.log("Playback event:", message.type, message.data);
      break;
    case "ack":
      console.log("Command succeeded:", message.op);
      break;
    case "error":
      console.warn("Command failed:", message.op, message.error);
      break;
  }
};
```
