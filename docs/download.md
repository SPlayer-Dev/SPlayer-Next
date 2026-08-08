---
title: 下载
---

# 下载 SPlayer-Next

下方会自动从 GitHub 拉取最新版本，并根据你的系统推荐合适的安装包。若下载缓慢，可切换为镜像线路。

<DownloadPage />

## 其他获取方式

- **历史版本**：前往 [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases) 查看全部归档。
- **开发版**：可在 [GitHub Actions](https://github.com/SPlayer-Dev/SPlayer-Next/actions) 工作流产物中获取最新构建（需登录 GitHub）。

## 安装提示

- **Windows**：提供安装版（含自动更新）与单文件便携版，按需选择。
- **macOS**：首次打开若提示「应用已损坏」或无法验证，请参考 [Mac 应用显示已损坏](/troubleshooting/macos-damaged)。
- **Linux**：不确定发行版格式时优先选择 AppImage；启动异常可参考 [Ubuntu 沙箱启动失败](/troubleshooting/ubuntu-sandbox)。

### Linux 安装包选择

| 格式     | 适用发行版                       |
| -------- | -------------------------------- |
| AppImage | 通用 Linux，无需安装             |
| deb      | Debian、Ubuntu、Linux Mint       |
| rpm      | Fedora、RHEL、openSUSE           |
| pacman   | Arch Linux、Manjaro、EndeavourOS |
| tar.gz   | 通用压缩包，适合手动解压运行     |

```bash
# AppImage
chmod +x ./splayer-next-*.AppImage
./splayer-next-*.AppImage # 直接运行
./splayer-next-*.AppImage --appimage-extract # 或解压到 squashfs-root 目录

# deb
sudo apt install ./splayer-next-*.deb

# rpm
sudo dnf install ./splayer-next-*.rpm # Fedora
sudo zypper install ./splayer-next-*.rpm # openSUSE

# pacman
sudo pacman -U ./splayer-next-*.pacman

# 压缩包
tar -xzf ./splayer-next-*.tar.gz
cd splayer-next-*/
./SPlayer-Next
```
