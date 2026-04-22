# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SPlayer-Next is a desktop music player built with **Electron + Vue 3 + TypeScript**, using Rust native modules for audio decoding and system media integration. It is the successor to SPlayer, redesigned with a cleaner architecture.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Build native modules (debug) + start Electron dev server
pnpm build                # Full production build (rimraf dist → native → typecheck → electron-vite)
pnpm build:win            # Package for Windows (nsis + portable, x64/arm64)
pnpm build:mac            # Package for macOS (dmg + zip, x64/arm64)
pnpm build:linux          # Package for Linux (AppImage/deb/rpm/tar.gz, x64/arm64)
pnpm typecheck            # TypeScript check (both node + web targets)
pnpm lint                 # ESLint check
pnpm format               # Prettier format (--write)
pnpm build:native         # Build Rust native modules only (add `-- --dev` for debug)
```

Set `SKIP_NATIVE_BUILD=true` to skip Rust compilation during dev.

## Architecture

### Process Model

- **Main process** (`electron/main/`): Window management, IPC handlers, native module orchestration
- **Preload** (`electron/preload/`): Context bridge exposing `window.api` (player, config, system, library) to renderer
- **Renderer** (`src/`): Vue 3 SPA

### Native Modules (Rust + NAPI-RS)

Two `.node` modules in `native/`, built via `scripts/build-native.ts`:

- **`audio-engine`** — FFmpeg-based audio decoding + rodio playback + FFT analysis + cover extraction. Pushes events (state changes, position updates, playback ended) to JS via ThreadsafeFunction.
- **`media-ctrl`** — Cross-platform system media controls (Windows SMTC, Linux MPRIS, macOS MPNowPlaying) + Discord RPC. Trait-based platform abstraction in `sys_media/`.

Native modules are loaded lazily via `loadNativeModule()` in `electron/main/utils/nativeLoader.ts`. Types are auto-generated as `index.d.ts` by NAPI-RS and imported via path aliases `@splayer/audio-engine` and `@splayer/media-ctrl`.

### Data Flow: Playback

```
User action → status store → IPC (player:load/play/pause/seek)
  → main process player.ts → audio-engine native module
  → Rust events (stateChanged/position/ended)
  → main process broadcasts to renderer + syncs to media-ctrl
  → status store updates reactive state
  → playback.ts updates non-reactive time source
```

### State Management

Two-tier position tracking to separate high-frequency animation from low-frequency UI:

- **`src/stores/status.ts`** — Reactive (Pinia). Holds `position`, `duration`, `state`, `volume`. Updated on main process push (~5Hz). Drives progress bar, time display, play button.
- **`src/services/playback.ts`** — Non-reactive (plain variables). `getCurrentTime()` interpolates between pushes. Read by `usePlaybackTime()` composable in RAF loop for lyrics/spectrum at 60fps without triggering Vue reactivity.
- **`src/stores/media.ts`** — Reactive (Pinia, shallowRef). Holds current `Track` (lightweight) + `TrackDetail` (lyrics, quality info). Persisted to sessionStorage via pinia-plugin-persistedstate (only `track` + `activeLyric`, NOT `detail` to avoid memory issues).

### Type System

- **`shared/types/player.ts`** — `Track` (playlist-friendly, lightweight), `TrackDetail` (on-demand), `Artist`, `Album`, `AudioQuality`, `OnlineMatch`, `PlayerState`, `PlayerStatus`, `PlayerEvent`, `LoadResult`, `PlayerApi`, `IpcResponse`
- **`shared/types/lyrics.ts`** — `LyricFormat`, `LyricSource`（`"external" | "embedded" | "online"`）, `LyricData`（当前激活歌词描述：source + format + 可选 platform）, `LyricLine`, `LyricWord`, `LyricSpan`
- **`shared/types/platform.ts`** — `Platform`（`"netease" | "qqmusic" | "kugou"`）

`Track` is designed for playlist storage (no lyrics/heavy data). `TrackDetail` is loaded on demand when a track becomes active.

### Data Storage

```
{userData}/
├── settings.json                  — 主进程配置（electron/main/store/）
├── app-cache/covers/              — 封面缩略图缓存（cover:// 协议）
├── Database/library.db            — 音乐库（better-sqlite3，WAL 模式）
└── logs/                          — 日志
```

**渲染进程（IndexedDB via localforage）**：

- `splayer/library` — 曲目缓存（加速首屏）
- `splayer/queue` — 播放队列持久化
- `splayer/playlists` — 歌单数据

### Cover Image Handling

Covers are extracted by Rust as 300x300 JPEG thumbnails cached to disk (`{userData}/app-cache/covers/`). Frontend accesses them via `cover://{filename}` custom protocol. Original high-res covers are extracted on-demand via `getCoverRaw()` for SMTC, never cached to disk.

### Config Store (Main Process)

Custom implementation in `electron/main/store/` (not electron-store). Reads/writes `{userData}/settings.json`, merges with defaults from `shared/defaults/settings.ts`. Supports dot-path access (`store.get("system.taskbarProgress")`), atomic writes, and schema migrations.

Settings UI uses a declarative schema (`src/settings/schema.ts`) with binding format `{ store: "settings"|"theme", path: "nested.path" }`. Paths starting with `system.` route through IPC to main process config.

### i18n

- **Renderer**: `vue-i18n` with locale files in `src/i18n/locales/{zh-CN,en-US}.json`
- **Main process**: Lightweight translation table in `electron/main/utils/i18n.ts` for tray menu and thumbar tooltips. Language synced from renderer via `system:setLocale` IPC.

### Main Process Structure

```
electron/main/
├── core/index.ts       — App init, cover:// protocol registration
├── ipc/player.ts       — Player IPC handlers, event routing, media-ctrl sync, taskbar progress
├── ipc/config.ts       — Config persistence with side effects (media, normalization, taskbar)
├── ipc/system.ts       — System IPC (devtools, file explorer, locale sync)
├── services/tray.ts    — System tray menu (i18n-aware)
├── services/thumbar.ts — Windows taskbar thumbnail buttons (i18n-aware)
├── services/media.ts   — MediaService class wrapping media-ctrl native module
├── store/index.ts      — Config store (read/write settings.json)
├── utils/broadcast.ts  — Window broadcast helper
├── utils/i18n.ts       — Main process i18n (tray/thumbar translations)
├── utils/nativeLoader.ts — Native .node module loader
├── utils/protocol.ts   — cover:// URL conversion
└── utils/time.ts       — Time unit conversion (seconds → milliseconds)
```

### Path Aliases

```
@/                    → src/           (renderer, tsconfig.web.json)
@shared/              → shared/        (both renderer and main process)
@splayer/audio-engine → native/audio-engine (main process, tsconfig.node.json)
@splayer/media-ctrl   → native/media-ctrl   (main process, tsconfig.node.json)
```

## Key Conventions

- **Language**: Comments and commit messages in Chinese
- **Units**: All time values in the frontend are **milliseconds**. Rust engine uses seconds internally; conversion happens in `electron/main/ipc/player.ts` via `toMs()`.
- **Auto-imports**: `vue`, `pinia`, `vue-router`, `@vueuse/core` are auto-imported (no explicit imports needed in Vue components)
- **Prettier**: Double quotes, semicolons, 100 char width, trailing commas
- **Native module types**: Never hand-write — import from `@splayer/audio-engine` or `@splayer/media-ctrl` (auto-generated `index.d.ts`)
- **Store persist**: Only persist lightweight data to sessionStorage. Never persist `TrackDetail` (contains large lyric strings, causes memory issues).
- **IPC event listeners**: Always call `ipcRenderer.removeAllListeners()` before adding new listener in preload's `onEvent` to prevent HMR listener accumulation.
- **Auto-generated files**: Do not edit `auto-imports.d.ts`, `components.d.ts`, `native/*/index.d.ts` — they are regenerated by tooling.
- **Shared types**: `LocaleCode`, `SystemConfig`, etc. live in `shared/types/settings.ts` — used by both renderer and main process.
- **Reactivity & IDB**: Use `shallowRef` for Track arrays/collections to avoid deep proxy. Vue proxied objects cannot be cloned by IndexedDB (`DataCloneError`).
