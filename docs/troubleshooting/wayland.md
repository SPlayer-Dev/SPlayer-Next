# Linux Wayland 兼容性

在 Wayland 会话下，部分**窗口相关功能**可能受限，个别环境甚至会出现画面闪烁、花屏乃至系统卡死。这是 Electron / Chromium 在 Wayland 下的通用情况，并非应用本身的缺陷。

## 使用 Xwayland

遇到花屏、闪烁、卡死或悬浮窗异常时，最稳妥的办法是让应用以 **X11（Xwayland）** 模式运行——在启动参数中加入 `--ozone-platform=x11`。

开发环境：

```bash
pnpm dev -- --ozone-platform=x11
```

为安装版长期生效，可修改桌面项，避免每次手动加参数：

**KDE Plasma**

1. 右击 SPlayer-Next 的桌面项 → **编辑应用程序…**；
2. 在 **命令行参数** 中，把 `%U` 改为 `--ozone-platform=x11 %U`；
3. 保存退出。

**其他桌面环境**

1. 找到 SPlayer-Next 的 `.desktop` 文件（通常在 `/usr/share/applications/` 下，文件名为 `top.imsyy.splayer_next.desktop`）；
2. 复制到 `~/.local/share/applications/`；
3. 用文本编辑器打开，找到 `Exec=` 开头的行，在可执行文件后追加 `--ozone-platform=x11`，例如：
   ```desktop
   Exec=/opt/SPlayer-Next/SPlayer-Next --ozone-platform=x11 %U
   ```
4. 保存退出。

> [!IMPORTANT]
>
> 使用 Xwayland 可能并不能解决全局快捷键的问题，反而可能导致全局快捷键失效。因为 Xwayland 无法监听原生 Wayland 的按键事件，也无法通过 XDG Desktop Portal 注册全局快捷键。
>
> 部分桌面环境对此有支持。如 KDE Plasma Wayland 可以在 **系统设置 → 应用程序权限 → 旧式 X11 应用程序支持** 中，将 **监听按键** 设置为 「**和上面一样，加上按住 Ctrl、Alt、Meta 等修饰键时按下的任何按键**」

## 已知的窗口限制

Wayland 出于安全考虑，不允许应用读取 / 设置全局屏幕坐标，并对置顶、穿透、透明无边框窗口有更多约束。这会影响 SPlayer-Next 的以下功能：

| 功能                                     | 在 Wayland 下的表现                               |
| ---------------------------------------- | ------------------------------------------------- |
| 桌面歌词 / 灵动岛（无边框 + 透明悬浮窗） | 可能渲染异常、出现不透明背景，或定位错位          |
| 窗口绝对定位（拖拽、吸附、记忆位置）     | Wayland 不允许应用设置绝对坐标，可能失效或错位    |
| 窗口置顶（always-on-top）                | 支持有限，悬浮窗可能无法保持置顶                  |
| 鼠标穿透（click-through）                | 可能不生效                                        |
| 悬停判定（全局光标位置）                 | Wayland 限制读取全局光标，悬停隐藏 / 交互可能不准 |
| 全局快捷键                               | Wayland 下可能无法注册全局快捷键                  |

> 具体表现因合成器（GNOME Mutter、KDE KWin、wlroots 等）而异。

## 桌面歌词的窗口规则

桌面歌词窗口使用固定的窗口标题 **`SPlayer-Next - Desktop Lyric`** 以方便窗口规则匹配。

在 KDE（KWin）下可通过**窗口规则**按标题匹配，手动补齐 Wayland 下缺失的行为（如保持置顶等）：

1. 打开 **系统设置 → 窗口管理 → 窗口规则**，新建一条规则；
2. 在 **窗口匹配** 中，将 **窗口类** 设为 `top.imsyy.splayer_next`（精确匹配），将 **窗口标题** 设为 `SPlayer-Next - Desktop Lyric`（精确匹配）；
3. 添加需要的属性，例如：
   - **窗口置顶**：设为 **强制**、**是**；
   - 可选 **图层**：设为 **强制**、**叠加**（全屏游戏时窗口也在上方）；
   - 可选 **虚拟桌面**：设为 **强制**、**所有桌面**（窗口同时处于所有虚拟桌面）；
   - 可选 **跳过任务栏**、**跳过虚拟桌面切换器**、**跳过窗口切换器**：设为 **强制**、**是**（优化一些细节体验）；
   - 可选固定 **位置** 与 **大小**；
4. 应用并保存。

其它 DE/WM 也可参考此配置方法自行配置。

这里也提供了一些可直接导入的规则。欢迎 PR 补充其它环境或更好的配置

<details>

<summary>可直接导入的规则</summary>

KWin 规则

> 编者用的规则，我觉得挺好用的

```ini
[SPlayer Next 桌面歌词]
Description=SPlayer Next 桌面歌词
above=true
aboverule=2
desktops=\\0
desktopsrule=2
layer=overlay
layerrule=2
skippager=true
skippagerrule=2
skipswitcher=true
skipswitcherrule=2
skiptaskbar=true
skiptaskbarrule=2
title=SPlayer-Next - Desktop Lyric
titlematch=1
wmclass=top.imsyy.splayer_next
wmclassmatch=1
```

Niri 窗口规则

> 编者日常不使用 Niri，未经充分测试

```kdl
window-rule {
    match app-id="top.imsyy.splayer_next" title="SPlayer-Next - Desktop Lyric"
    open-floating true
}
```

---

</details>

拖动时直接按鼠标左键无法拖动。此时可以尝试打开 SPlayer-Next 的 **全局设置 → 外部歌词 → 桌面歌词 → 使用 CSS 拖拽** 功能。若还是无法拖动，请使用 WM 的窗口拖动快捷键（如 KWin 默认的 <kbd>Meta</kbd>+<kbd>鼠标左键</kbd> 或 Mutter 默认的 <kbd>Alt</kbd>+<kbd>鼠标左键</kbd>）

锁定时鼠标穿透不生效是已知问题。可以尝试[使用 Xwayland](#使用-xwayland)

## 全局快捷键

在原生 Wayland 下，Electron 的全局快捷键通过 `xdg-desktop-portal` 实现。

打开应用时，若有新的未申请的全局快捷键，应该会弹出授权请求，点击确定即可。也可以在系统设置中查看 SPlayer-Next 是否有注册全局快捷键（在 KDE Plasma Wayland 中是 **系统设置 → 键盘 → 快捷键 → SPlayer-Next**）

Electron 注册的快捷键名称格式为 `SPlayer-Next shortcut: <组合键>`，但这个名称**并非实际生效的组合键**。实际生效的组合键由**系统设置**中为该名称绑定的按键决定。应用内设置的全局快捷键只决定它在系统中注册的名称，不决定实际按键。

例如：

1. 在应用内设置“上一曲”为 `Ctrl+Shift+←`，系统会注册名为 `SPlayer-Next shortcut: Ctrl+Shift+Left` 的项。
2. 在系统设置中，将该项绑定为 `Ctrl+Alt+Shift+←`，实际生效的全局快捷键就是 `Ctrl+Alt+Shift+←`。
3. 若之后在应用内将“上一曲”改为 `Ctrl+Alt+Shift+←`，旧名称失效，应用会请求注册新名称 `SPlayer-Next shortcut: Ctrl+Alt+Shift+Left`，此时实际生效的按键取决于系统设置中新名称对应的绑定。

> [!TIP]
>
> 授权请求仅在开启应用时弹出。所以每次修改全局快捷键后，都需要重新启动应用以触发授权请求。

> [!TIP]
>
> 若您的 `xdg-desktop-portal` 后端不支持全局快捷键，那我也没有办法咯
>
> 可查看 [XDG Desktop Portal - ArchWiki](https://wiki.archlinux.org/title/XDG_Desktop_Portal#List_of_backends_and_interfaces) 了解支持情况
>
> 也可以使用以下命令检查
>
> ```bash
> dbus-send --session --dest=org.freedesktop.portal.Desktop --print-reply --type=method_call /org/freedesktop/portal/desktop org.freedesktop.DBus.Introspectable.Introspect | grep GlobalShortcuts
> ```
>
> 它应该输出 `<interface name="org.freedesktop.portal.GlobalShortcuts">`

## 第三方 / 外部 API 替代

如果在 Wayland 下内置悬浮窗体验不佳，可改用桌面环境原生的**面板 / 挂件类**第三方歌词组件：它们通过 SPlayer-Next 的 [外部 API（HTTP）](/api) 或 [WebSocket API](/socket) 获取当前播放与歌词，再由桌面环境自身负责显示，从而绕开 Electron 悬浮窗在 Wayland 下的限制。

## 报障信息

如遇问题，请在 Issue 中附上：发行版、桌面环境与合成器、本程序是原生 Wayland 还是 Xwayland，以及具体的窗口异常现象。

> [!TIP]
>
> 要判断一个窗口是原生 Wayland 还是 Xwayland 主要有以下两种方式
>
> - xprop
>
>   安装在终端中执行 `xprop`，然后点击对应的窗口。若什么事情都没发生，则该窗口是原生 Wayland；若终端中出现了该窗口的详细信息，则该窗口是 Xwayland
>
> - xeyes
>
>   安装并打开 `xeyes`，应该会打开一个窗口，上面有 “一双眼睛”。在 Xwayland 窗口中，它的视线会跟随鼠标（一直看向鼠标所在的位置）；在原生 Wayland 窗口中，它保持不动
