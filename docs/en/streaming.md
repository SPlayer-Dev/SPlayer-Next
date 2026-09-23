# Streaming Services

In addition to local music and online sources, SPlayer-Next can connect to self-hosted streaming servers and browse your private library.

## Supported services

| Type                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| **Subsonic family** | Navidrome, OpenSubsonic, Airsonic, Gonic, LMS, and compatible servers |
| **Jellyfin**        | Open-source media server                                              |
| **Emby**            | Media server                                                          |

> Subsonic-compatible services share the same protocol and differ only by their UI label.

## Adding a server

1. Open **Settings → Streaming** and enable streaming.
2. Add a server and select Subsonic, Jellyfin, or Emby.
3. Enter its URL, username, and password.
4. Save. SPlayer-Next connects automatically and exposes tracks, albums, artists, and playlists in the sidebar.

You can configure and switch between multiple servers. Browsing data is cached locally for faster subsequent access.

::: tip Credential security
The main process prefers the operating system's `safeStorage` to encrypt server credentials locally. `accessToken` and `userId` are not persisted and are acquired again on each connection. If secure storage is unavailable, the app logs a warning and stores the password as Base64. Base64 is not encryption, so use this fallback only on a trusted device and user account.
:::

## Troubleshooting

- **Connection failed:** Verify the protocol (`http://` or `https://`), port, username, and password.
- **Track will not play:** Check that the server can transcode or return a direct URL and that it is reachable from this device.
