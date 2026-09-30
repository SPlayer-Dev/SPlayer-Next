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

## Linux installation

### Arch Linux

SPlayer-Next is now available in the [Arch Linux Chinese Community Repository](https://www.archlinuxcn.org/archlinux-cn-repo-and-mirror/).

If the repository is not configured yet, follow the [wiki](https://wiki.archlinuxcn.org/zh/Arch_Linux_%E4%B8%AD%E6%96%87%E7%A4%BE%E5%8C%BA%E4%BB%93%E5%BA%93) to set it up.

Once configured, install it directly:

```bash
sudo pacman -S splayer-next
```

The repository also provides a debug symbols package, useful when investigating crashes:

```bash
sudo pacman -S splayer-next-debug
```

> [!IMPORTANT]
> If the package is out of date, or you run into an error caused by packaging, **please do not report it in this project's repository, but to the Arch Linux Chinese Community Repository**.
> Open an issue [here](https://github.com/archlinuxcn/repo/issues/new/choose), or [email the package maintainer](mailto:nlsdt@archlinuxcn.org).

### Linux package formats

| Format   | Distributions                                    |
| -------- | ------------------------------------------------ |
| AppImage | Distribution-independent; no installation needed |
| deb      | Debian, Ubuntu, Linux Mint                       |
| rpm      | Fedora, RHEL, openSUSE                           |
| pacman   | Manjaro                                          |
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
