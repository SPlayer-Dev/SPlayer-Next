# SPlayer-Next Copilot 指引

本仓库所有 Copilot 会话、Code Review、建议，**一律使用中文作答**（代码、标识符、注释保持原项目语言）。

## 项目概述

SPlayer-Next 是基于 **Electron + Vue 3 + TypeScript** 的桌面音乐播放器，后继 SPlayer，搭配 **Rust NAPI-RS** 原生模块做音频解码、系统媒体集成、任务栏集成。

### 进程架构

- **主进程** `electron/main/`：窗口管理、IPC、原生模块调度
- **Preload** `electron/preload/`：通过 contextBridge 暴露 `window.api`
- **渲染进程** `src/`：Vue 3 SPA；另有三个独立窗口 `windows/desktop-lyric`、`windows/dynamic-island`、`windows/taskbar-lyric`

### 原生模块（`native/`）

- `audio-engine`：`ffmpeg_audio` 解码（静态编 FFmpeg，零环境依赖）+ rodio 播放 + FFT + 封面提取；URL 通过 `HttpRangeSource`（ureq + rustls）包成 Read+Seek 流喂给 ffmpeg_audio
- `media-ctrl`：跨平台系统媒体控件（Windows SMTC / Linux MPRIS / macOS MPNowPlaying）+ Discord RPC
- `taskbar-lyric`：Windows 专属，把窗口嵌入任务栏 + RegistryWatcher / UiaWatcher / TrayWatcher 四路监听

所有原生模块通过 `loadNativeModule()`（`electron/main/utils/nativeLoader.ts`）懒加载。

### 路径别名

| 别名                     | 指向                   | 使用范围                                   |
| ------------------------ | ---------------------- | ------------------------------------------ |
| `@/*`                    | `src/*`                | 渲染进程                                   |
| `@shared/*`              | `shared/*`             | 主进程 + 渲染进程 + 原生类型               |
| `@main/*`                | `electron/main/*`      | 主进程                                     |
| `@windows/*`             | `windows/*`            | 三个独立歌词窗口（复用 `windows/shared/`） |
| `@splayer/audio-engine`  | `native/audio-engine`  | 主进程，类型从自动生成的 `index.d.ts` 导入 |
| `@splayer/media-ctrl`    | `native/media-ctrl`    | 同上                                       |
| `@splayer/taskbar-lyric` | `native/taskbar-lyric` | 同上                                       |

## 代码约定

- **语言**：注释、Git commit、PR 描述一律中文
- **时间单位**：渲染端所有时间值是**毫秒**；Rust 引擎内部用秒，转换在 `electron/main/ipc/player.ts` 里做（`toMs()`）
- **Prettier**：双引号、分号、100 字符宽、末尾逗号
- **Auto-imports**（无需手写 `import`）：`vue`、`pinia`、`vue-router`、`@vueuse/core`、`vue-i18n`；UI 组件自动从 `src/components/` 注入
- **原生模块类型**：**禁止手写**，必须从 `@splayer/<module>` 的自动生成 `index.d.ts` 导入
- **状态管理双层**：`src/stores/status.ts` 走 Pinia 响应式（5Hz 更新）；`src/services/playback.ts` 存非响应式时间源，供 60fps 渲染（歌词 / 频谱）用 RAF 采样
- **Reactivity**：`Track[]` 等大集合用 `shallowRef`，避免深层代理；响应式代理对象存 IndexedDB 会 `DataCloneError`
- **Store 持久化**：只把轻量数据写 sessionStorage；`TrackDetail`（含歌词大字符串）**禁止**持久化
- **IPC 监听器清理**：preload 的 `onEvent` 必须先 `removeAllListeners` 再 `on`，防 HMR 累积；渲染端 composable 在 `onBeforeUnmount` 调用 preload 返回的 `unsubscribe`
- **自动生成文件**（不要编辑）：`auto-imports.d.ts`、`components.d.ts`、`native/*/index.d.ts`
- **Logger**：主进程统一用 `@main/utils/logger` 的 scoped logger（`coreLog` / `playerLog` / `mediaLog` / `trayLog` / `taskbarLog` / `nativeLog` 等），**不要**直接 `import log from "electron-log"`

## 窗口侧（`windows/`）

三个歌词窗口都复用：

- `@windows/shared/composables/useNowPlayingSync` 提供播放同步、歌词索引、锚点插值
- `getNowPlayingCurrentMs()` 非响应式读当前时间，供逐字高亮 RAF 循环用
- 歌词行选择算法按窗口语义选：桌面歌词用 `pickPrimaryIndex`（考虑 overlap）、灵动岛用 `pickLatestStartedIndex`（立即切换）

不要在窗口内重新实现上述逻辑，直接调用共享 composable。

## 设置 schema

- 结构定义在 `src/settings/schema.ts`
- 类型在 `src/types/settings-schema.ts`：`SettingCategory` → `SettingSection` → `SettingItem`
- `SettingSection.tag` / `SettingItem.tag` 支持 `SettingTag = { text: string; type?: "primary" | "warning" | ... }`，用于标题旁的徽标（Beta / 实验等）
- i18n key 约定：`settings.section.{id}` / `settings.{itemKey}.label` / `settings.{itemKey}.description`
- UI 原子组件：`STag` / `SButton` / `SSelect` / `SSlider` / `SSwitch` / `SColor` / `SDialog` 等，统一 7 色 theme token（default / primary / cover / info / success / warning / error）
