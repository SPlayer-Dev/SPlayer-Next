# Linux Wayland Compatibility

Some window features are restricted under Wayland. Certain environments may show flicker, corrupted frames, or even compositor hangs. These are common Electron/Chromium Wayland limitations rather than SPlayer-Next-specific behavior.

## Using Xwayland

For flicker, hangs, or broken floating windows, run through X11/Xwayland:

```bash
pnpm dev -- --ozone-platform=x11
```

For an installed package, copy `top.imsyy.splayer_next.desktop` from `/usr/share/applications/` to `~/.local/share/applications/` and add the argument to `Exec`:

```desktop
Exec=/opt/SPlayer-Next/SPlayer-Next --ozone-platform=x11 %U
```

In KDE Plasma, the same change can be made by editing the application's desktop entry and replacing `%U` with `--ozone-platform=x11 %U`.

> [!IMPORTANT]
> Xwayland may not fix global shortcuts and can make them unavailable because it cannot listen to native Wayland input or register through XDG Desktop Portal. KDE users can adjust **System Settings → Application Permissions → Legacy X11 App Support** if they accept the security trade-off.

## Known window limitations

Wayland intentionally prevents applications from reading or setting global coordinates and applies stricter rules to transparent, borderless, always-on-top windows.

| Feature                           | Possible behavior under Wayland                     |
| --------------------------------- | --------------------------------------------------- |
| Desktop lyrics / Dynamic Island   | Rendering errors, opaque background, wrong position |
| Absolute positioning and snapping | Unavailable or inaccurate                           |
| Always on top                     | Limited compositor support                          |
| Click-through                     | May not work                                        |
| Global cursor hover detection     | Hidden/interactive behavior may be inaccurate       |
| Global shortcuts                  | May fail to register                                |

Behavior varies between GNOME Mutter, KDE KWin, wlroots-based compositors, and other environments.

## Desktop lyric window rules

The desktop lyric window has the fixed title `SPlayer-Next - Desktop Lyric`. In KWin, create a rule matching window class `top.imsyy.splayer_next` and this exact title. You can force Always on Top, Overlay layer, All Desktops, and skip taskbar/pager/switcher behavior.

Example KWin rule:

```ini
[SPlayer Next Desktop Lyric]
Description=SPlayer Next Desktop Lyric
above=true
aboverule=2
desktops=\0
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

Example Niri rule, which has not been extensively tested:

```kdl
window-rule {
    match app-id="top.imsyy.splayer_next" title="SPlayer-Next - Desktop Lyric"
    open-floating true
}
```

If normal mouse dragging does not work, enable **Settings → External Lyrics → Desktop Lyrics → Use CSS dragging**. Otherwise, use the compositor shortcut, such as Meta + left mouse button in KWin or Alt + left mouse button in Mutter.

Click-through while locked is a known issue; Xwayland may help.

## Global shortcuts

On native Wayland, Electron registers global shortcuts through `xdg-desktop-portal`. New shortcuts should trigger a permission request when the app starts. KDE lists them under **System Settings → Keyboard → Shortcuts → SPlayer-Next**.

Electron registers a display name such as `SPlayer-Next shortcut: Ctrl+Shift+Left`. The actual key combination is the binding assigned to that entry in system settings. Changing a shortcut in the app changes the registered name; restart SPlayer-Next after each change so the portal can request permission again.

Check whether the active portal backend exposes GlobalShortcuts:

```bash
dbus-send --session --dest=org.freedesktop.portal.Desktop --print-reply \
  --type=method_call /org/freedesktop/portal/desktop \
  org.freedesktop.DBus.Introspectable.Introspect | grep GlobalShortcuts
```

See the [XDG Desktop Portal ArchWiki page](https://wiki.archlinux.org/title/XDG_Desktop_Portal#List_of_backends_and_interfaces) for backend support.

## External display alternatives

If Electron floating windows do not work well, a desktop-native panel or widget can read the [HTTP API](/en/api) or [WebSocket API](/en/socket) and render lyrics through the compositor's own UI.

## Reporting a problem

Include the distribution, desktop environment, compositor, whether SPlayer-Next is using native Wayland or Xwayland, and the exact window behavior.

Run `xprop` and click the window: output indicates Xwayland, while no response usually indicates native Wayland. `xeyes` can also distinguish them because its eyes follow the pointer over Xwayland windows but not native Wayland windows.
