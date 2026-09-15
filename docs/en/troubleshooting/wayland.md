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

> [!NOTE]
>
> Under Xwayland the Dynamic Island used to be completely invisible (the window was clipped to nothing). The issue is fixed in the latest version, so if you gave up on Xwayland because of that, please upgrade and retry. Under Xwayland, always-on-top, snap centering and absolute positioning all go through the X11 protocol and work normally.

> [!IMPORTANT]
> Xwayland may not fix global shortcuts and can make them unavailable because it cannot listen to native Wayland input or register through XDG Desktop Portal. KDE users can adjust **System Settings → Application Permissions → Legacy X11 App Support** if they accept the security trade-off.

## Known window limitations

Wayland intentionally prevents applications from reading or setting global coordinates and applies stricter rules to transparent, borderless, always-on-top windows.

| Feature                           | Possible behavior under Wayland                              |
| --------------------------------- | ------------------------------------------------------------ |
| Desktop lyrics / Dynamic Island   | Rendering errors, opaque background, wrong position          |
| Absolute positioning and snapping | Unavailable or inaccurate                                    |
| Always on top                     | Not possible on native Wayland; use window rules or Xwayland |
| Click-through                     | May not work                                                 |
| Global cursor hover detection     | Hidden/interactive behavior may be inaccurate                |
| Global shortcuts                  | May fail to register                                         |

Behavior varies between GNOME Mutter, KDE KWin, wlroots-based compositors, and other environments.

## Desktop lyric window rules

The desktop lyric window has the fixed title `SPlayer-Next - Desktop Lyric`. In KWin, create a rule matching window class `top.imsyy.splayer_next` and this exact title. You can force Always on Top, Overlay layer, All Desktops, and skip taskbar/pager/switcher behavior.

The Dynamic Island window uses the fixed title **`Dynamic Island`** and can be matched the same way.

> [!NOTE]
>
> Native Wayland does not let applications set absolute window coordinates, so the Island grows rightward from its fixed top-left corner as lyrics change (side-to-side jumping); snap centering cannot truly work on native Wayland. Three options:
>
> 1. Run under Xwayland (see above) — centering and always-on-top both work through the X11 protocol;
> 2. In KWin, **force a fixed position / always-on-top** with the rule below so the compositor replaces the app's own positioning.
> 3. Use the [KWin script](#dynamic-centering-with-a-kwin-script) below to center it dynamically, so it stays centered as the lyrics widen.

Example KWin rule:

> Save any rule snippet below as a `*.kwinrule` file (UTF-8) and import it via **System Settings → Window Management → Window Rules → Import…**, or append it to `~/.config/kwinrulesrc`.

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

Dynamic Island (set **Position** separately for your resolution):

```ini
[SPlayer Next Dynamic Island]
Description=SPlayer Next Dynamic Island
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
title=Dynamic Island
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

## Dynamic centering with a KWin script

The window rule above is static — it fixes a position/size, but as the lyric text changes the Island still grows rightward from its fixed left edge, so it cannot stay centered. To center it dynamically, use a **KWin script** (it runs inside the compositor and can read/write window geometry, bypassing the client-side Wayland restriction).

The script below keeps the Dynamic Island horizontally centered and flush with the top of the work area:

```js
// Horizontal centering; vertical flush with work-area top (below the panel). Width/height are left to the app.
const WM_CLASS = "top.imsyy.splayer_next";
const ISLAND_TITLE = "Dynamic Island";
const TOP_OFFSET = 0; // extra offset below the work-area top, increase if you want a gap

function isIsland(w) {
  return (
    (w.resourceClass === WM_CLASS || w.resourceName === WM_CLASS) && w.caption === ISLAND_TITLE
  );
}

function centerIsland(w) {
  const area = workspace.clientArea(KWin.MaximizeArea, w); // work area excluding panels
  const fb = w.frameGeometry;
  if (fb.width <= 0 || fb.height <= 0) return;

  const x = Math.round(area.x + (area.width - fb.width) / 2);
  const y = area.y + TOP_OFFSET;
  // only write back if there is an offset, to avoid re-triggering frameGeometryChanged
  if (Math.abs(fb.x - x) > 1 || Math.abs(fb.y - y) > 1) {
    w.frameGeometry = { x: x, y: y, width: fb.width, height: fb.height };
  }
}

function attach(w) {
  if (!isIsland(w) || w._splayerCentered) return;
  w._splayerCentered = true;
  w.frameGeometryChanged.connect(() => centerIsland(w));
  centerIsland(w);
}

workspace.windowList().forEach(attach); // existing windows
workspace.windowAdded.connect(attach); // windows created later
```

Install the script as `~/.local/share/kwin/scripts/splayer-island-center/contents/code/main.js` and create `metadata.json` next to it:

```json
{
  "KPlugin": {
    "Id": "splayer-island-center",
    "Name": "SPlayer Dynamic Island Center",
    "Description": "Keep the SPlayer Dynamic Island centered on native Wayland",
    "Authors": [{ "Name": "expoli" }],
    "License": "MIT",
    "Version": "1.0"
  },
  "KPackageStructure": "KWin/Script"
}
```

Then enable it under **System Settings → Window Management → KWin Scripts** (or log out and back in).

> [!NOTE]
>
> Debugging gotchas found when writing this script:
>
> - `window.geometry` reads as `undefined` on native Wayland — use `window.frameGeometry` instead;
> - `Qt.rect(...)` is not available in KWin 6 scripting — assign an object literal `{ x, y, width, height }`;
> - guard the write with `Math.abs(...) > 1` so the set does not re-trigger `frameGeometryChanged` (feedback loop);
> - match on `resourceClass` **and** the caption — the main window uses the same `top.imsyy.splayer_next` class.

Reload without logging out after editing the script:

```bash
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript splayer-island-center
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript \
  ~/.local/share/kwin/scripts/splayer-island-center/contents/code/main.js splayer-island-center
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
```

> This only works on KDE / KWin; GNOME needs a Mutter extension to do the same dynamic centering.

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
