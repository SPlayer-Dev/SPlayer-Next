# Common macOS Issues

## Application signing

### macOS cannot verify the developer

1. Open **System Settings → Privacy & Security**, find the blocked app, and click **Open Anyway**.
2. Or run:

```bash
sudo xattr -rd com.apple.quarantine /Applications/SPlayer-Next.app
```

If macOS says the app is damaged, see [macOS reports a damaged app](/en/troubleshooting/macos-damaged).

To remove all extended attributes:

```bash
sudo xattr -cr /Applications/SPlayer-Next.app
```

## System integration

SPlayer-Next integrates with macOS Now Playing through the native `media-ctrl` module. If Control Center or lock-screen controls do not update, restart the app and close another player that may own the media session.

If media keys do not work, close applications that may capture them and review **System Settings → Keyboard → Keyboard Shortcuts**.

## Update failures

1. Download the latest build from [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases).
2. Remove the old application and reinstall.
3. Check your network connection.
