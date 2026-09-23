# Windows 7 Compatibility

::: warning Unsupported system
Electron 23 and later no longer support Windows 7, 8, or 8.1. The Electron version used by SPlayer-Next is incompatible with these systems. **Windows 10 1903 or later is recommended.**
:::

Installing all Windows updates and the [Visual C++ Redistributable 2015–2022](https://aka.ms/vs/17/release/vc_redist.x64.exe) may resolve some startup errors, but it cannot restore full compatibility.

Windows 7 lacks modern APIs used by Electron and does not support SMTC system media controls. Its default TLS configuration may also reject modern services.

Windows 7 reached end of support in January 2020. Upgrade to Windows 10 or 11 for security, compatibility, and current media integration. Older builds may exist on [GitHub Releases](https://github.com/SPlayer-Dev/SPlayer-Next/releases), but they can contain known security issues.
