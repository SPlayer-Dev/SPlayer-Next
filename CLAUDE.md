# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SPlayer-Next — desktop music player on **Electron + Vue 3 + TypeScript**, with Rust native modules (NAPI-RS) for audio decoding, system media integration, and Windows taskbar lyric. Successor to SPlayer.

## Commands

```bash
pnpm install              # Install deps
pnpm dev                  # Build native (debug) + start Electron dev
pnpm build                # Full build (rimraf → native → typecheck → electron-vite)
pnpm build:{win,mac,linux}# Platform packages
pnpm typecheck            # tsc + vue-tsc (node + web targets)
pnpm lint / format        # ESLint / Prettier
pnpm build:native         # Rust only; add `-- --dev` for debug
```

`SKIP_NATIVE_BUILD=true` skips Rust during dev.

`audio-engine` static-links FFmpeg via the `ffmpeg_audio` crate (vendor zip + cc-built at compile time). Zero environment dependency — no `FFMPEG_DIR` / `PKG_CONFIG_PATH`, no system FFmpeg required.

## Architecture

### Process Model

- **Main** (`electron/main/`) — windows, IPC, native modules
- **Preload** (`electron/preload/`) — `contextBridge` exposing `window.api` (player/config/system/library/streaming/lyrics)
- **Renderer** (`src/`) — Vue 3 SPA
- **Lyric windows** (`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric`) — independent Vue entries sharing `windows/shared/`

### Native Modules (Rust + NAPI-RS)

Three `.node` modules in `native/`, built via `scripts/build-native.ts`, lazy-loaded by `electron/main/utils/nativeLoader.ts`. NAPI-RS auto-generates `index.d.ts`, imported via path aliases `@splayer/audio-engine`, `@splayer/media-ctrl`, `@splayer/taskbar-lyric`.

- `audio-engine` — `ffmpeg_audio` decode (static FFmpeg) + rodio playback + FFT + cover extraction. URLs wrapped as `Read + Seek` via `HttpRangeSource` (ureq + rustls) — TLS handled in Rust, cross-platform with no system deps. Pushes events (state/position/ended/outputStalled) via ThreadsafeFunction. Has load_token race protection and a cancel flag (injected into `HttpRangeSource`) for instant stop on blocking IO.
- `media-ctrl` — Cross-platform system media controls (Windows SMTC / Linux MPRIS / macOS MPNowPlaying) + Discord RPC.
- `taskbar-lyric` — Windows taskbar lyric text rendering with RegistryWatcher / UiaWatcher / TrayWatcher.

### Playback Data Flow

```
User action → status store → IPC (player:load/play/pause/seek)
  → main process player.ts → audio-engine
  → Rust events (stateChanged/position/ended/outputStalled)
  → main broadcasts to renderer + syncs to media-ctrl
  → status store updates reactive state
  → playback.ts updates non-reactive time source
```

### State Management

Two-tier position tracking — high-frequency animation vs. low-frequency UI:

- `src/stores/status.ts` — Pinia reactive. `position / duration / state / volume`, pushed ~5Hz from main. Drives progress bar, time display, play button.
- `src/services/playback.ts` — Non-reactive plain vars. `getCurrentTime()` interpolates between pushes; `usePlaybackTime()` reads in RAF loop for 60fps lyrics/spectrum without Vue reactivity.
- `src/stores/media.ts` — Pinia + shallowRef. Current `Track` (lightweight) + `TrackDetail` (lyrics, quality). Only `track + activeLyric` persisted to sessionStorage; never persist `TrackDetail` (large lyric strings cause memory issues).

### Streaming Subsystem

Server protocol clients live in renderer (`src/services/streaming/`): subsonic / jellyfin / emby clients + unified dispatcher (`index.ts`). Subsonic family (Navidrome / OpenSubsonic / Airsonic / Gonic / LMS) shares `subsonic.ts`; types differ only as UI labels.

- `services/streaming/transform.ts` — Server response → unified `Track / Album / Artist / Playlist`. Trusts server's artist field; no client-side splitting.
- `services/streaming/session.ts` — Jellyfin/Emby `/Sessions/Playing` heartbeat + PlaySessionId state machine; called from `core/player.ts`.
- `stores/streaming.ts` — Server list, active state, connection, browse cache (IndexedDB via localforage `streaming-cache`). `fetchSongs` returns first batch then keeps fetching in background.
- Credentials — main process `electron/main/ipc/streaming.ts` encrypts via Electron `safeStorage` to `{userData}/app-data/config/streaming.json`. `accessToken / userId` not persisted; re-acquired on connect.

### Lyric Windows

`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric` are independent Vue entries. Always use shared composables from `@windows/shared/`:

- `useNowPlayingSync` — playback sync, lyric index, anchor interpolation
- `getNowPlayingCurrentMs()` — non-reactive current time for RAF char highlight
- Line selection: `pickPrimaryIndex` (desktop, considers overlap) vs. `pickLatestStartedIndex` (dynamic island, immediate switch)

Don't reimplement these inside individual windows.

### Type System

- `shared/types/player.ts` — `Track`, `TrackDetail`, `Artist`, `Album`, `AudioQuality`, `PlayerState`, `PlayerStatus`, `PlayerEvent`, `LoadOptions`, `LoadResult`, `IpcResponse`
- `shared/types/lyrics.ts` — `LyricFormat`, `LyricSource (external | embedded | online)`, `LyricData`, `LyricLine`, `LyricWord`, `LyricSpan`
- `shared/types/platform.ts` — `Platform (netease | qqmusic | kugou)`
- `shared/types/streaming.ts` — `StreamingServerType`, `StreamingServerConfig`, `StreamingPingResult`, `StreamingAuthResult` 等

`Track` is for queue storage (no heavy data); `TrackDetail` loads on demand.

### Settings Schema

Declarative — defined in `src/settings/schema.ts`, types in `src/types/settings-schema.ts` (`SettingCategory → SettingSection → SettingItem`). Items bind via `{ store: "settings"|"theme", path: "nested.path" }`; `system.*` paths route through IPC to main config. Tag support on section/item via `SettingTag = { text; type? }` for Beta/experimental badges. i18n keys: `settings.section.{id}` / `settings.{itemKey}.{label,description}`.

### Data Storage

```
{userData}/app-data/        # 统一数据目录（与 Chromium 的 Cache/ 等隔开，便携版整体迁移此目录）
├── config/
│   ├── settings.json       # Main config (electron/main/store/)
│   ├── streaming.json      # Streaming credentials (safeStorage encrypted)
│   └── lastfm.json         # Last.fm credentials (safeStorage encrypted)
├── database/library.db     # Music library (better-sqlite3, WAL)
├── cache/                  # covers/ (cover:// protocol) + artists/ backgrounds/ songs/
├── logs/                   # App logs + native/
└── plugins/                # scripts/ data/ logs/

# 全部路径集中定义于 electron/main/utils/paths.ts，改一处即可整体迁移
```

Renderer IndexedDB (localforage): `splayer/library`, `splayer/queue`, `splayer/playlists`, `splayer/streaming-cache`.

### Cover Image

Rust extracts 300x300 JPEG thumbnail to `{userData}/app-data/cache/covers/` during decode; renderer reads via `cover://{filename}` protocol. Original via `getCoverRaw()` for SMTC, never cached. Streaming covers use remote URLs directly (browser cache).

### Config Store (Main)

`electron/main/store/` is custom (not electron-store). Reads/writes `{userData}/app-data/config/settings.json` (path via `electron/main/utils/paths.ts`), merges with defaults from `shared/defaults/settings.ts`. Supports dot-path access (`store.get("system.taskbarProgress")`), atomic writes, schema migrations.

### i18n

Renderer uses `vue-i18n` with `src/i18n/locales/{zh-CN,en-US}.json`. Main process has a lightweight translation table (`electron/main/utils/i18n.ts`) for tray/thumbar; locale synced via `system:setLocale` IPC.

### Path Aliases

```
@/                     → src/                   (renderer, tsconfig.web.json)
@shared/               → shared/                (both processes)
@main/                 → electron/main/         (main, tsconfig.node.json)
@windows/              → windows/               (lyric windows)
@splayer/audio-engine  → native/audio-engine    (main)
@splayer/media-ctrl    → native/media-ctrl      (main)
@splayer/taskbar-lyric → native/taskbar-lyric   (main)
```

## Conventions

### Comments — Chinese, with JSDoc

All comments in Chinese. Methods use standard JSDoc with `@param 名 - 说明` and `@returns` when meaningful:

```ts
/**
 * 取或生成 PlaySessionId，trackId 不变则复用
 * @param trackId - Track 全局 id
 * @returns PlaySessionId（UUID）
 */
```

Forbidden: `// ───` separator lines (including ones with section titles), prose-style multi-paragraph comments, restating-the-obvious comments, numbered enumerations (`1. 2. 3.`) inside comments. Write comments only when the **why** is non-obvious.

### Code Organization

Split logic into files rather than separator comments. Don't extract a helper for one-place callers (3+ uses justify it). No "just in case" defensive code or fallbacks for impossible scenarios. No configurable knobs (timeouts / retries / buffer sizes) unless required — write constants. Don't break errors into per-case enums; `anyhow` or plain `Error` is usually enough.

### Memory Discipline

Memory is a hard requirement. Main process logs `内存占用:` (`app.getAppMetrics()`, 60s after launch then every 10 min); when a change touches rendering, caching, or IPC, verify before/after with these samples.

- **Images by display size** — anything blurred, sampled, or rendered small uses the 300px `cover` thumbnail (player blur background, color extraction, lists). `coverOriginal` only for the visible large cover and poster export. Large `<img>`: add `decoding="async"`; preload with `img.decode()` before fading in.
- **Compositing layers are budgeted** — never put `will-change` in CSS on unbounded element collections; promote dynamically and only near the viewport (lyric engine `lineWillChange` pattern). New full-screen `filter: blur` / `backdrop-filter` layers need justification.
- **Hidden = silent** — high-frequency pushes (`position` / `fftData` / `position-sync`) must not reach hidden windows: `broadcast(channel, data, true)` or an `isVisible()` gate; consumers recover from the next push (≤200ms), no resync needed. Low-frequency state events (`stateChanged` / `ended` / track-change) always go through. RAF loops and canvases must stop when their surface is hidden (engine `freeze()` / `visibilitychange` pattern).
- **In-memory caches must be bounded** — every module-level Map/array cache needs an eviction rule (subsonic `viewAuthCache` evicts per-server). Never retain `TrackDetail`-sized data beyond the current track.

### Units

Frontend time is **milliseconds** everywhere. Rust engine uses seconds internally; `toMs()` in `electron/main/ipc/player.ts` converts.

### Types & Persistence

Never hand-write native module types — import from `@splayer/*`. Use `shallowRef` for `Track` arrays/collections (avoid deep proxy). Vue proxied objects can't be cloned by IDB (`DataCloneError`); use `toRaw` before persisting.

### Auto-generated Files

Don't edit `auto-imports.d.ts`, `components.d.ts`, `native/*/index.d.ts` — regenerated by tooling.

### Auto-imports

In Vue components, `vue / pinia / vue-router / @vueuse/core / vue-i18n` are auto-imported, and UI components in `src/components/` are auto-registered.

### Logging (Main Process)

Use scoped loggers from `@main/utils/logger` (`coreLog / playerLog / mediaLog / trayLog / taskbarLog / nativeLog`, etc.). Don't import `electron-log` directly.

### IPC Listeners

In preload's `onEvent`, always `ipcRenderer.removeAllListeners()` before adding a new listener (HMR accumulates otherwise). Renderer composables call the returned `unsubscribe` in `onBeforeUnmount`.

### Prettier

Double quotes, semicolons, 100-char width, trailing commas.

### Shared Types

Put cross-process types (`LocaleCode / SystemConfig / StreamingServerType`, etc.) in `shared/types/`.

### Commit Messages

Single-line title in Chinese; no body/bullets unless explicitly requested.
