---
title: Download
---

# Download SPlayer-Next

The list below fetches the latest release for the selected channel from GitHub and recommends a package for your system. Stable is selected by default. If GitHub is slow, choose a download mirror.

<DownloadPage />

## Release channels

| Channel    | Intended audience       | Releases received           | Example         |
| ---------- | ----------------------- | --------------------------- | --------------- |
| **Stable** | Everyday use            | Stable                      | `1.2.0`         |
| **Beta**   | Early feature access    | Beta, then Stable           | `1.3.0-beta.1`  |
| **Alpha**  | Development and testing | Alpha, then Beta and Stable | `1.4.0-alpha.1` |

Change the channel under **Settings → General → Release channel**. Alpha builds may be highly unstable. Moving to a more stable channel may require installing a build with a lower version number.

## Other sources

- **Previous versions:** Browse all archived builds on [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases).
- **Development builds:** Download the latest workflow artifact from [GitHub Actions](https://github.com/SPlayer-Dev/SPlayer-Next/actions). A GitHub account is required.

## Installation notes

- **Windows:** Choose the installer for automatic updates or the single-file portable build.
- **macOS:** If macOS reports that the app is damaged or cannot verify it, see [macOS reports a damaged app](/en/troubleshooting/macos-damaged).
- **Linux:** Choose AppImage if you are unsure which package format your distribution uses. See [Ubuntu sandbox startup failure](/en/troubleshooting/ubuntu-sandbox) for launch errors.

### Linux package formats

| Format   | Distributions                                    |
| -------- | ------------------------------------------------ |
| AppImage | Distribution-independent; no installation needed |
| deb      | Debian, Ubuntu, Linux Mint                       |
| rpm      | Fedora, RHEL, openSUSE                           |
| pacman   | Arch Linux, Manjaro, EndeavourOS                 |
| tar.gz   | Generic archive for manual extraction            |

```bash
# AppImage
chmod +x ./splayer-next-*.AppImage
./splayer-next-*.AppImage
./splayer-next-*.AppImage --appimage-extract

# deb
sudo apt install ./splayer-next-*.deb

# rpm
sudo dnf install ./splayer-next-*.rpm
sudo zypper install ./splayer-next-*.rpm

# pacman
sudo pacman -U ./splayer-next-*.pacman

# Archive
tar -xzf ./splayer-next-*.tar.gz
cd splayer-next-*/
./SPlayer-Next
```
