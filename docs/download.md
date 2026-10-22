---
title: 下载
---

# 下载 SPlayer-Next

下方会自动从 GitHub 拉取对应更新通道的最新版本，并根据你的系统推荐合适的安装包。默认选择 Stable 正式版；若下载缓慢，可切换镜像线路。

<DownloadPage />

## 更新通道

| 通道       | 适合人群           | 可收到的版本               | 版本格式示例    |
| ---------- | ------------------ | -------------------------- | --------------- |
| **Stable** | 日常使用           | Stable                     | `1.2.0`         |
| **Beta**   | 愿意提前体验新功能 | Beta、后续 Stable          | `1.3.0-beta.1`  |
| **Alpha**  | 开发测试与问题反馈 | Alpha、后续 Beta 和 Stable | `1.4.0-alpha.1` |

应用内可在 **设置 → 通用 → 更新通道** 中切换。Alpha 版本可能非常不稳定，切换到更稳定的通道时，应用可能需要安装版本号更低的构建。

## 其他获取方式

- **历史版本**：前往 [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases) 查看全部归档。
- **开发版**：可在 [GitHub Actions](https://github.com/SPlayer-Dev/SPlayer-Next/actions) 工作流产物中获取最新构建（需登录 GitHub）。

## 安装提示

- **Windows**：提供安装版（含自动更新）与单文件便携版，按需选择。
- **macOS**：首次打开若提示「应用已损坏」或无法验证，请参考 [Mac 应用显示已损坏](/troubleshooting/macos-damaged)。
- **Linux**：不确定发行版格式时优先选择 AppImage；启动异常可参考 [Ubuntu 沙箱启动失败](/troubleshooting/ubuntu-sandbox)。

## Linux 安装

### Arch Linux

本软件现已收录于 [Arch Linux 中文社区仓库](https://www.archlinuxcn.org/archlinux-cn-repo-and-mirror/)

若还未配置 Arch Linux 中文社区仓库，前往 [Wiki](https://wiki.archlinuxcn.org/zh/Arch_Linux_%E4%B8%AD%E6%96%87%E7%A4%BE%E5%8C%BA%E4%BB%93%E5%BA%93) 进行配置

若已配置，可直接安装：

```bash
sudo pacman -S splayer-next
```

该仓库另提供调试符号包，排查崩溃时可用：

```bash
sudo pacman -S splayer-next-debug
```

> [!IMPORTANT]
> 如果遇到软件包过期（out-of-date）或者打包问题造成的运行错误，**请不要在本项目仓库反馈，而是向 Arch Linux 中文社区仓库反馈**
>
> 前往 [此处](https://github.com/archlinuxcn/repo/issues/new/choose) 建立 issue
>
> 或者向软件包维护者[发送邮件](mailto:nlsdt@archlinuxcn.org)\<nlsdt@archlinuxcn.org>进行反馈

### Linux 安装包选择

| 格式     | 适用发行版                   |
| -------- | ---------------------------- |
| AppImage | 通用 Linux，无需安装         |
| deb      | Debian、Ubuntu、Linux Mint   |
| rpm      | Fedora、RHEL、openSUSE       |
| pacman   | Manjaro                      |
| tar.gz   | 通用压缩包，适合手动解压运行 |

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
