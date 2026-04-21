# AMLL 音频播放架构分析与 Electron 移植方案

## 目录

- [一、原项目架构总览](#一原项目架构总览)
- [二、音频播放模块详解](#二音频播放模块详解)
  - [2.1 四线程模型](#21-四线程模型)
  - [2.2 FFmpeg 解码器](#22-ffmpeg-解码器)
  - [2.3 音频输出](#23-音频输出)
  - [2.4 播放位置追踪](#24-播放位置追踪)
  - [2.5 Seek 实现](#25-seek-实现)
  - [2.6 FFT 频谱分析](#26-fft-频谱分析)
  - [2.7 平台媒体控制](#27-平台媒体控制)
  - [2.8 FFmpeg 裁剪策略与内存占用](#28-ffmpeg-裁剪策略与内存占用)
- [三、歌词解析模块](#三歌词解析模块)
- [四、插件系统](#四插件系统)
- [五、WebSocket 同步协议](#五websocket-同步协议)
- [六、Electron 移植方案](#六electron-移植方案)
  - [6.1 方案对比](#61-方案对比)
  - [6.2 方案 A：napi-rs + FFmpeg（全格式）](#62-方案-anapi-rs--ffmpeg全格式)
  - [6.3 方案 B：Web Audio API（零依赖）](#63-方案-bweb-audio-api零依赖)
  - [6.4 方案 C：napi-rs + Symphonia（纯 Rust）](#64-方案-cnapi-rs--symphonia纯-rust)
- [七、方案选型建议](#七方案选型建议)

---

## 一、原项目架构总览

AMLL（Apple Music Like Lyrics）Player 是一个基于 Tauri 的桌面音乐播放器，采用 pnpm monorepo 组织：

```
applemusic-like-lyrics/
├── packages/
│   ├── player/              # Tauri 桌面应用（React 前端 + Rust 后端）
│   ├── player-core/         # Rust 音频播放引擎（核心）
│   ├── lyric/               # Rust → WASM 多格式歌词解析器
│   ├── core/                # 歌词渲染引擎（DOM/Canvas）
│   ├── fft/                 # WASM FFT 音频可视化
│   ├── ws-protocol/         # WebSocket 外部同步协议
│   ├── react/               # React 歌词组件封装
│   ├── react-full/          # React 完整歌词 UI
│   ├── vue/                 # Vue 版本
│   └── docs/                # 文档站
```

**技术栈**：

| 层       | 技术                                |
| -------- | ----------------------------------- |
| 桌面框架 | Tauri 2.0（Rust + WebView）         |
| 前端     | React + TypeScript + Jotai 状态管理 |
| 音频解码 | FFmpeg（通过 ffmpeg-next）          |
| 音频输出 | rodio + cpal                        |
| 歌词解析 | Rust → WASM（nom + quick-xml）      |
| 歌词渲染 | 自研弹簧物理引擎（DOM/Canvas）      |
| 构建     | Vite + Cargo                        |

---

## 二、音频播放模块详解

### 2.1 四线程模型

```
┌──────────────────────────────────────────────────────────────────┐
│  线程 1: React 前端 (Renderer / UI 线程)                          │
│                                                                  │
│  Jotai atoms ← PlayPosition / FFTData / SyncStatus events       │
│  invoke("local_player_send_msg", JSON) ─────────┐               │
└──────────────────────────────────────────────────│───────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  线程 2: Tauri 主线程                                             │
│                                                                  │
│  反序列化 JSON → AudioThreadMessage                               │
│  通过 tokio mpsc channel 转发给 AudioPlayer                       │
└──────────────────────────────────────────────────────────────────┘
                    │ msg_sender                ▲ evt_sender
                    ▼                           │
┌──────────────────────────────────────────────────────────────────┐
│  线程 3: AudioPlayer 事件循环 (Tokio 异步运行时)                   │
│                                                                  │
│  tokio::select! {                                                │
│      msg_receiver     → process_message()     // 处理前端指令      │
│      media_state_rx   → on_media_state_msg()  // 处理 OS 媒体键   │
│      evt_receiver     → on_event() callback   // 回传事件给 Tauri  │
│      50ms interval    → 检测播放完毕 → 自动下一首                   │
│  }                                                               │
│                                                                  │
│  持有:                                                            │
│  ├── Sink (rodio) — 音频混合/输出                                  │
│  ├── FFmpegDecoderHandle — 控制解码线程                             │
│  ├── MediaStateManager — OS 媒体控制 (MPRIS/SMTC/NSMediaPlayer)   │
│  └── FFTPlayer (Arc<RwLock>) — 频谱数据共享                        │
└──────────────────────────────────────────────────────────────────┘
                    │ start_playing_song()
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  线程 4: 解码器线程 (独立 OS 线程, std::thread::spawn)             │
│                                                                  │
│  decoder_thread_entry() 循环:                                     │
│  1. try_recv(control_rx) → Seek 命令?                             │
│  2. 等待共享缓冲区有空位 (Condvar)                                  │
│  3. decoder.receive_frame() → 解码一帧                             │
│  4. 如果 EAGAIN → input_ctx.packets().next() 送入下一个 packet     │
│  5. 双路重采样:                                                    │
│     ├── player_samples → 目标采样率/声道 (如 48kHz/2ch)             │
│     └── fft_samples    → 44100Hz 单声道                            │
│  6. 封装为 AudioChunk → push 到共享 VecDeque                       │
└──────────────────────────────────────────────────────────────────┘
```

**消息类型定义**（`player-core/src/lib.rs`）：

```rust
// 前端 → 播放器的指令
enum AudioThreadMessage {
    ResumeAudio, PauseAudio, ResumeOrPauseAudio,
    SeekAudio { position: f64 },
    JumpToSong { song_index: usize },
    PrevSong, NextSong, NextSongGapless,
    SetPlaylist { songs: Vec<SongData> },
    SetVolume { volume: f64 },
    SetAudioOutput { name: String },
    SetFFT { enabled: bool },
    SetFFTRange { from_freq: f32, to_freq: f32 },
    SyncStatus, Close,
    SetMediaControlsEnabled { enabled: bool },
}

// 播放器 → 前端的事件
enum AudioThreadEvent {
    PlayPosition { position: f64 },
    LoadProgress { position: f64 },
    LoadAudio { music_id, music_info, quality, current_play_index },
    AudioPlayFinished { music_id },
    SyncStatus { music_id, is_playing, duration, position, volume, ... },
    PlayStatus { is_playing },
    LoadError { error }, PlayError { error },
    VolumeChanged { volume },
    FFTData { data: Vec<f32> },
}
```

### 2.2 FFmpeg 解码器

**文件**: `player-core/src/ffmpeg_decoder.rs`

核心数据结构：

```rust
struct AudioChunk {
    player_samples: Vec<f32>,   // 交错 PCM（左右左右...）
    fft_samples: Vec<f32>,      // 单声道 44100Hz
}

struct Shared {
    buffer: Mutex<VecDeque<AudioChunk>>,  // 容量 64
    is_eof: AtomicBool,
    is_stopping: AtomicBool,
    condvar: Condvar,                      // 生产者-消费者同步
}
```

**解码流程**：

```
ffmpeg::format::input(&path)
       │
       ▼
  AVFormatContext (解封装)
       │
       ▼ packets().next()
  AVPacket (压缩数据)
       │
       ▼ decoder.send_packet() + decoder.receive_frame()
  AVFrame (原始 PCM)
       │
       ├──→ Resampler 1: 源格式 → F32 Planar / 目标采样率 / 目标声道
       │         │
       │         ▼ interleave_planar_frame()
       │    player_samples: Vec<f32> (交错格式)
       │
       └──→ Resampler 2: 源格式 → F32 Planar / 44100Hz / Mono
                 │
                 ▼
            fft_samples: Vec<f32>
```

**FFmpegDecoder 实现了 `rodio::Source` trait**（即 `Iterator<Item=f32>`）：

```rust
impl Iterator for FFmpegDecoder {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        // 1. 先从本地缓冲取
        if let Some(sample) = self.local_buffer.pop_front() {
            return Some(sample);
        }
        // 2. 从共享缓冲取一个 chunk
        let chunk = shared_buffer.pop_front(); // 阻塞等待
        // 3. FFT 数据推送给 FFTPlayer
        fft_player.push_samples(&chunk.fft_samples);
        // 4. 播放数据存入本地缓冲
        self.local_buffer.extend(chunk.player_samples);
        self.local_buffer.pop_front()
    }
}
```

**重采样器自修复机制**：当源格式在播放中变化时（如某些容器格式），自动重建 resampler：

```rust
fn try_resample_with_retry(...) -> Option<Audio> {
    if resampler.run(decoded, &mut output).is_ok() {
        return Some(output);
    }
    // 重建 resampler
    *resampler = Context::get(decoded.format(), ..., target_format, ...);
    resampler.run(decoded, &mut output).ok()
}
```

**当前限制**：仅支持本地文件：

```rust
// player.rs:511-513
let file_path = match song_data {
    SongData::Local { file_path, .. } => file_path,
    _ => return Err(anyhow!("当前实现仅支持本地文件")),
};
```

> 注意：FFmpeg 本身支持网络协议（http/https/rtmp），`format::input(url)` 传入 URL 即可，但原项目未启用此能力。

### 2.3 音频输出

**文件**: `player-core/src/output.rs`

原项目存在**两套输出方案**：

| 方案              | 使用场景    | 实现方式                                              |
| ----------------- | ----------- | ----------------------------------------------------- |
| **rodio Sink**    | 当前主流程  | `Sink::connect_new()` → `sink.append(source)`         |
| **cpal 直接输出** | 备用/旧方案 | `cpal::Device::build_output_stream()` + SPSC 环形缓冲 |

**rodio 方案**（当前使用）：

```rust
// player.rs:98
let sink = Arc::new(Sink::connect_new(&handle.mixer()));
// player.rs:541
self.sink.append(source);  // source = FFmpegDecoder (实现了 Source trait)
```

Sink 内部会在自己的线程中不断调用 `source.next()` 拉取采样，写入 `OutputStream`。

**cpal 备用方案**的特点：

- SPSC 环形缓冲 (`rb::SpscRb`) 做无锁传输
- 音量控制在回调中做帧级平滑渐变（避免爆音/咔哒声）
- 自动检测默认输出设备变化（每秒轮询）
- 设备断开自动重连
- 支持 Symphonia 的 `AudioBufferRef` 类型

### 2.4 播放位置追踪

**不依赖解码器时间戳**，而是用 `Instant` 计时器实现高精度追踪：

```rust
// 在独立的 tokio task 中运行
let mut base_time = 0.0;
let mut inst = Instant::now();

// 收到播放/暂停/seek 时重置基准
if let Ok((new_is_playing, new_base_time)) = play_pos_rx.try_recv() {
    base_time = new_base_time;
    inst = Instant::now();
}

// 每 16ms (60fps) 计算当前位置并通知前端
let current_pos = (base_time + inst.elapsed().as_secs_f64()).min(duration);
emitter.emit(AudioThreadEvent::PlayPosition { position: current_pos });

// 每 1s 同步到 OS 媒体控制
manager.set_position(current_pos);
```

### 2.5 Seek 实现

```
前端: SeekAudio { position: f64 }
  │
  ▼ process_message()
AudioPlayer:
  │ FFmpegDecoderHandle.seek(Duration)
  │   └── control_tx.send(ControlMessage::Seek)
  │         │
  │         ▼ 解码器线程
  │       input_ctx.seek(timestamp)  // FFmpeg seek
  │       decoder.flush()            // 清空解码器内部缓冲
  │       shared.buffer.clear()      // 清空共享帧缓冲
  │
  ├── fft_player.clear()             // 清空 FFT 数据
  └── play_pos_sx.send((is_playing, position))  // 重置位置基准
```

### 2.6 FFT 频谱分析

**文件**: `player-core/src/fft_player.rs`

```
解码线程产生 fft_samples (44100Hz Mono)
      │
      ▼ FFmpegDecoder::next() 中
fft_player.push_samples(&chunk.fft_samples)
      │
      ▼ 存入 pcm_queue: VecDeque<f32>（最大 8192 个采样）
      │
      ▼ 每 50ms 由广播 task 调用 fft_player.read()
      │
      ├── 取 2048 个采样
      ├── Hamming 窗函数
      ├── FFT → 频谱 (spectrum-analyzer crate)
      ├── 频率范围: 80Hz - 2000Hz (可配置)
      ├── 缩放: divide_by_N_sqrt
      ├── 插值到输出 buffer 大小 (128 bins)
      └── 通过 AudioThreadEvent::FFTData 发送给前端
```

### 2.7 平台媒体控制

| 平台    | 实现                                          | 功能               |
| ------- | --------------------------------------------- | ------------------ |
| Windows | `windows` crate (SMTC)                        | 任务栏/锁屏控件    |
| macOS   | `objc2-media-player` (MPNowPlayingInfoCenter) | 控制中心/Touch Bar |
| Linux   | `mpris-server` (D-Bus MPRIS)                  | 桌面媒体控件       |

同步的信息：标题、艺术家、时长、当前位置、封面、播放状态。

### 2.8 FFmpeg 裁剪策略与内存占用

**Cargo.toml 配置**：

```toml
[dependencies.ffmpeg-next]
version = "8"
default-features = false
features = ["codec", "format", "software-resampling", "static"]

# 使用 fork 修复构建问题
[patch.crates-io]
ffmpeg-sys-next = { git = "https://github.com/apoint123/rust-ffmpeg-sys" }
```

**已启用 vs 已禁用**：

| FFmpeg 库     | Feature               | 状态     | 作用                    |
| ------------- | --------------------- | -------- | ----------------------- |
| libavcodec    | `codec`               | 启用     | 编解码器（音频 + 视频） |
| libavformat   | `format`              | 启用     | 容器解封装              |
| libswresample | `software-resampling` | 启用     | 音频重采样              |
| libswscale    | `software-scaling`    | **禁用** | 视频图像缩放            |
| libavfilter   | `filtering`           | **禁用** | 音视频滤镜              |
| libavdevice   | `device`              | **禁用** | 设备采集                |
| libpostproc   | `postprocessing`      | **禁用** | 视频后处理              |

> `codec` feature 是粗粒度的，同时包含音频和视频编解码器。ffmpeg-next 的 feature 不支持单独禁用视频 codec，需要在编译 FFmpeg C 源码时用 `--disable-decoder=h264,hevc,...` 处理。

**内存占用详细分析**：

```
┌─────────────────────────────────────────────────────────────┐
│ 组件                         │ 内存占用     │ 说明           │
├─────────────────────────────────────────────────────────────┤
│ FFmpeg 库代码段 (驻留部分)     │ 3-6 MB      │ OS 按需加载页  │
│ FFmpeg 运行时 (解码器+重采样)  │ 0.5-2 MB    │ 取决于 codec   │
│ 共享帧缓冲 (64 chunks)        │ 0.5-1.5 MB  │ 主要内存消耗   │
│ rodio Sink + cpal 输出        │ 0.2-0.7 MB  │               │
│ FFT 处理器                    │ ~0.1 MB     │ 8192 采样队列  │
│ Tokio 运行时 + channels       │ 1-2 MB      │               │
├─────────────────────────────────────────────────────────────┤
│ 总计                          │ ~6-12 MB    │               │
└─────────────────────────────────────────────────────────────┘
```

如果进一步裁剪视频 codec，FFmpeg 库代码段可降至 ~1-2 MB，总计降至 ~3-8 MB。

---

## 三、歌词解析模块

**文件**: `packages/lyric/src/`

Rust 编译为 WASM，通过 `wasm-bindgen` 暴露给前端。

**支持的格式**：

| 格式  | 文件       | 解析库          | 说明                              |
| ----- | ---------- | --------------- | --------------------------------- |
| LRC   | `lrc.rs`   | nom             | 标准时间标签格式 `[mm:ss.ms]text` |
| TTML  | `ttml/`    | quick-xml + nom | Apple Music 格式，逐字时间        |
| YRC   | `yrc.rs`   | nom             | Netease 格式，base64 编码         |
| QRC   | `qrc.rs`   | nom             | QQ 音乐格式，加密                 |
| EQRC  | `eqrc/`    | nom             | QRC 加密变体                      |
| LYS   | `lys.rs`   | nom             | 荔枝 FM 格式                      |
| ESLRC | `eslrc.rs` | nom             | 扩展简单歌词                      |
| ASS   | `ass.rs`   | nom             | Advanced SubStation Alpha 字幕    |

**统一数据结构**：

```rust
struct LyricWord<'a> {
    start_time: u64,         // 毫秒
    end_time: u64,
    word: Cow<'a, str>,      // 文本
    roman_word: Cow<'a, str>, // 罗马音（拼音/假名注音）
}

struct LyricLine<'a> {
    words: Vec<LyricWord<'a>>,
    translated_lyric: Cow<'a, str>,
    roman_lyric: Cow<'a, str>,
    is_bg: bool,              // 背景和声
    is_duet: bool,            // 对唱标记
    start_time: u64,
    end_time: u64,
}
```

**前端处理流程**：

```
readLocalMusicMetadata(filePath)
    → FFmpeg 提取内嵌歌词/伴随歌词文件
    → 检测格式 (.ttml / .lrc / .yrc / ...)
    → parseTTML() / parseLrc() / parseYrc() / ...  (WASM 调用)
    → 标准化为 LyricLine[]
    → 存入 Jotai atom: musicLyricLinesAtom
    → 传递给 @applemusic-like-lyrics/core 渲染
```

---

## 四、插件系统

**文件**: `packages/player/src/states/extension.ts`

纯 JavaScript 插件机制：

```
~/.config/AMLL Player/extensions/
├── plugin-a.js           # 启用
├── plugin-b.js.disabled  # 禁用（重命名后缀）
```

**元数据格式**（JS 文件头部注释）：

```javascript
// @id unique-plugin-id
// @version 1.0.0
// @name:en Plugin Name
// @name:zh 插件名称
// @description:en Description
// @icon <data:image/png;base64,...>
// @dependency other-plugin-id
```

**加载流程**：

```
扫描 extensions 目录
    → 解析 @key value 注释
    → 验证必填字段 (id, version, icon)
    → 检测循环依赖 + ID 冲突
    → 依赖排序
    → Function() 构造器执行 (浏览器沙箱)
    → 插件通过 Jotai atoms 访问播放器状态
    → ExtensionInjectPoint 提供 UI 注入
```

**加载状态枚举**：

```typescript
enum LoadResult {
  Loadable, // 可加载
  Disabled, // .js.disabled 后缀
  MissingMetadata, // 缺少 id/version/icon
  InvaildExtensionFile, // 非 .js 文件
  MissingDependency, // 依赖缺失
  ExtensionIdConflict, // ID 冲突
}
```

---

## 五、WebSocket 同步协议

**文件**: `packages/ws-protocol/src/`

用于外部歌词显示软件、跨设备同步等场景。

**协议版本**：

| 版本 | 格式              | 说明       |
| ---- | ----------------- | ---------- |
| v1   | 二进制            | 旧版兼容   |
| v2   | JSON + 可选二进制 | 当前主版本 |

**v2 消息结构**：

```rust
enum Payload {
    Initialize,                     // 握手
    Ping / Pong,                    // 心跳
    Command(Command),               // 客户端 → 服务端
    State(StateUpdate),             // 服务端 → 客户端
}

enum Command {
    Pause, Resume,
    ForwardSong, BackwardSong,
    SetVolume { volume: f64 },
    SeekPlayProgress { progress: u64 },
    SetRepeatMode { mode }, SetShuffleMode { enabled },
}

enum StateUpdate {
    SetMusic(MusicInfo),
    SetCover(AlbumCover),           // URI 或 base64
    SetLyric(LyricContent),
    Progress { progress: u64 },
    Volume { volume: f64 },
    Paused / Resumed,
    AudioData { data: Vec<u8> },    // 原始音频（用于远端可视化）
    ModeChanged { repeat, shuffle },
}
```

**Tauri 侧服务器**（`packages/player/src-tauri/src/server.rs`）：

- 多客户端支持 (`HashMap<SocketAddr, ConnectionInfo>`)
- 首条消息自动检测 v1/v2 协议
- 双格式广播（v1 客户端收二进制，v2 客户端收 JSON）

---

## 六、Electron 移植方案

### 6.1 方案对比

|                  | 方案 A: napi-rs + FFmpeg    | 方案 B: Web Audio API     | 方案 C: napi-rs + Symphonia |
| ---------------- | --------------------------- | ------------------------- | --------------------------- |
| **格式支持**     | 全部（APE/WMA/DSD/TTA/...） | MP3/AAC/FLAC/OGG/WAV      | MP3/AAC/FLAC/OGG/WAV/ALAC   |
| **网络流**       | FFmpeg 原生支持             | 浏览器原生支持            | 需自定义 MediaSource        |
| **内存占用**     | ~15-25 MB                   | **~3-8 MB**               | **~3-7 MB**                 |
| **CPU 占用**     | 低（原生解码）              | **最低**（复用 Chromium） | 低（原生解码）              |
| **动态库依赖**   | FFmpeg .dll/.so 或静态链接  | **无**                    | **无**                      |
| **编译复杂度**   | 高（C 交叉编译）            | **无需编译**              | **低**（纯 cargo build）    |
| **二进制体积**   | +8-15 MB（精简后）          | **0**                     | **+2-4 MB**                 |
| **FFT 频谱**     | 自行实现                    | AnalyserNode 内置         | 自行实现                    |
| **Seek**         | FFmpeg seek                 | currentTime 赋值          | 自定义 MediaSource seek     |
| **Gapless 播放** | 可实现                      | 需要 AudioWorklet         | 可实现                      |

### 6.2 方案 A：napi-rs + FFmpeg（全格式）

适用场景：需要播放 APE、WMA、DSD、TTA 等冷门格式。

#### 项目结构

```
your-electron-app/
├── packages/
│   └── player-native/          # Rust 原生模块
│       ├── Cargo.toml
│       ├── package.json
│       ├── build.rs
│       ├── src/
│       │   ├── lib.rs          # napi-rs 接口层
│       │   ├── decoder.rs      # FFmpeg 解码器
│       │   ├── player.rs       # 播放状态机
│       │   └── fft.rs          # 频谱分析
│       └── npm/                # 各平台预编译产物
├── src/
│   ├── main/
│   │   └── player.ts           # 主进程播放器桥接
│   └── renderer/
│       └── composables/
│           └── usePlayer.ts    # 渲染进程 API
```

#### Cargo.toml

```toml
[package]
name = "player-native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["async", "threadsafe_function", "serde-json"] }
napi-derive = "2"
serde = { version = "1", features = ["derive"] }

# FFmpeg 精简引入 — 仅音频相关
ffmpeg-next = { version = "8", default-features = false, features = [
    "codec",
    "format",
    "software-resampling",
    "static",    # 静态链接，不需要外部 .dll
] }

rodio = "0.21"
parking_lot = "0.12"
spectrum-analyzer = "1.5"
anyhow = "1"
tracing = "0.1"

[build-dependencies]
napi-build = "2"
```

> 进一步裁剪 FFmpeg：在编译 FFmpeg C 源码时指定
> `--disable-everything --enable-decoder=mp3,flac,aac,alac,ape,wmav2,opus,vorbis,pcm_*,dsd_* --enable-demuxer=mp3,flac,ogg,wav,ape,asf,mov,matroska --enable-protocol=file,http,https,tcp,tls`
> 可将 libavcodec 从 ~10MB 降至 ~2MB。

#### Rust 接口层 (src/lib.rs)

```rust
#[macro_use]
extern crate napi_derive;

mod decoder;
mod player;
mod fft;

use napi::*;
use player::InnerPlayer;
use std::sync::Arc;
use parking_lot::Mutex;

#[napi(object)]
#[derive(Clone)]
pub struct PlayerEvent {
    pub event_type: String,     // "position" | "loaded" | "ended" | "error" | "fft"
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub error: Option<String>,
    pub fft_data: Option<Vec<f64>>,
}

#[napi(object)]
#[derive(Default, Clone)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub format_name: String,
}

#[napi]
pub struct AudioPlayer {
    inner: Arc<Mutex<InnerPlayer>>,
}

#[napi]
impl AudioPlayer {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        ffmpeg_next::init()
            .map_err(|e| Error::from_reason(format!("FFmpeg init failed: {e}")))?;
        let inner = InnerPlayer::new()
            .map_err(|e| Error::from_reason(format!("{e}")))?;
        Ok(Self { inner: Arc::new(Mutex::new(inner)) })
    }

    /// 加载本地路径或网络 URL（FFmpeg 自动识别协议）
    #[napi]
    pub fn load(&self, url: String) -> Result<()> {
        self.inner.lock().load(&url)
            .map_err(|e| Error::from_reason(format!("{e}")))
    }

    #[napi]
    pub fn play(&self) { self.inner.lock().play(); }

    #[napi]
    pub fn pause(&self) { self.inner.lock().pause(); }

    #[napi]
    pub fn stop(&self) { self.inner.lock().stop(); }

    #[napi]
    pub fn seek(&self, position: f64) -> Result<()> {
        self.inner.lock().seek(position)
            .map_err(|e| Error::from_reason(format!("{e}")))
    }

    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.inner.lock().set_volume(volume as f32);
    }

    #[napi]
    pub fn get_position(&self) -> f64 { self.inner.lock().get_position() }

    #[napi]
    pub fn get_duration(&self) -> f64 { self.inner.lock().get_duration() }

    #[napi]
    pub fn is_playing(&self) -> bool { self.inner.lock().is_playing() }

    #[napi]
    pub fn get_metadata(&self) -> AudioMetadata { self.inner.lock().get_metadata() }

    #[napi]
    pub fn get_fft_data(&self, size: u32) -> Vec<f64> {
        self.inner.lock().get_fft_data(size as usize)
    }

    #[napi(ts_args_type = "callback: (event: PlayerEvent) => void")]
    pub fn on_event(&self, callback: ThreadsafeFunction<PlayerEvent, ErrorStrategy::Fatal>) {
        self.inner.lock().set_event_callback(callback);
    }
}
```

#### 解码器 (src/decoder.rs)

```rust
use std::collections::VecDeque;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc};
use std::thread;
use std::time::Duration;
use ffmpeg_next as ffmpeg;
use ffmpeg_next::ChannelLayout;
use parking_lot::{Condvar, Mutex};
use crate::AudioMetadata;

const BUFFER_CAPACITY: usize = 64;

pub struct AudioChunk {
    pub samples: Vec<f32>,
    pub fft_samples: Vec<f32>,
}

pub struct SharedBuffer {
    pub buffer: Mutex<VecDeque<AudioChunk>>,
    pub is_eof: AtomicBool,
    pub is_stopping: AtomicBool,
    pub condvar: Condvar,
}

pub enum DecoderCommand { Seek(Duration), Stop }

pub struct Decoder {
    pub shared: Arc<SharedBuffer>,
    pub command_tx: mpsc::Sender<DecoderCommand>,
    pub metadata: AudioMetadata,
    pub sample_rate: u32,
    pub channels: u16,
    _thread: Option<thread::JoinHandle<()>>,
}

impl Decoder {
    /// url: 本地路径或 http/https URL，FFmpeg 自动识别
    pub fn new(url: &str, target_rate: u32, target_ch: u16) -> anyhow::Result<Self> {
        let shared = Arc::new(SharedBuffer {
            buffer: Mutex::new(VecDeque::with_capacity(BUFFER_CAPACITY)),
            is_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
            condvar: Condvar::new(),
        });
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let (init_tx, init_rx) = mpsc::sync_channel(1);
        let shared_c = shared.clone();
        let url_owned = url.to_string();

        let handle = thread::spawn(move || {
            decode_thread(&url_owned, target_rate, target_ch, shared_c, cmd_rx, init_tx);
        });

        let metadata = init_rx.recv()??;
        Ok(Self {
            shared, command_tx: cmd_tx, metadata,
            sample_rate: target_rate, channels: target_ch,
            _thread: Some(handle),
        })
    }

    pub fn seek(&self, pos: Duration) -> anyhow::Result<()> {
        self.command_tx.send(DecoderCommand::Seek(pos))?;
        Ok(())
    }

    pub fn pull_chunk(&self) -> Option<AudioChunk> {
        let mut buf = self.shared.buffer.lock();
        while buf.is_empty() {
            if self.shared.is_eof.load(Ordering::Acquire) { return None; }
            self.shared.condvar.wait(&mut buf);
        }
        let chunk = buf.pop_front();
        self.shared.condvar.notify_one();
        chunk
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        self.shared.is_stopping.store(true, Ordering::Release);
        let _ = self.command_tx.send(DecoderCommand::Stop);
        self.shared.condvar.notify_all();
        if let Some(h) = self._thread.take() { let _ = h.join(); }
    }
}

fn decode_thread(
    url: &str, target_rate: u32, target_ch: u16,
    shared: Arc<SharedBuffer>,
    cmd_rx: mpsc::Receiver<DecoderCommand>,
    init_tx: mpsc::SyncSender<anyhow::Result<AudioMetadata>>,
) {
    // FFmpeg 自动处理 file:// / http:// / https://
    let mut input_ctx = match ffmpeg::format::input(&url) {
        Ok(ctx) => ctx,
        Err(e) => { let _ = init_tx.send(Err(e.into())); return; }
    };

    let meta = extract_metadata(&input_ctx);
    let stream = match input_ctx.streams().best(ffmpeg::media::Type::Audio) {
        Some(s) => s,
        None => { let _ = init_tx.send(Err(anyhow::anyhow!("no audio stream"))); return; }
    };
    let stream_idx = stream.index();
    let time_base = stream.time_base();

    let codec_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters()).unwrap();
    let mut decoder = codec_ctx.decoder().audio().unwrap();

    let mut meta = meta;
    meta.sample_rate = decoder.rate();
    meta.channels = decoder.channels() as u32;
    if stream.duration() > 0 {
        meta.duration = stream.duration() as f64 * time_base.0 as f64 / time_base.1 as f64;
    }
    let _ = init_tx.send(Ok(meta));

    // 重采样器：源 → 目标播放格式
    let target_fmt = ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar);
    let target_layout = ChannelLayout::default(target_ch as i32);
    let mut resampler = ffmpeg::software::resampling::context::Context::get(
        decoder.format(), decoder.channel_layout(), decoder.rate(),
        target_fmt, target_layout, target_rate,
    ).ok();

    // FFT 用重采样器：源 → 44100Hz Mono
    let mut fft_resampler = ffmpeg::software::resampling::context::Context::get(
        decoder.format(), decoder.channel_layout(), decoder.rate(),
        target_fmt, ChannelLayout::MONO, 44100,
    ).ok();

    loop {
        // 检查命令
        if let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                DecoderCommand::Seek(pos) => {
                    let ts = (pos.as_secs_f64() * ffmpeg::ffi::AV_TIME_BASE as f64) as i64;
                    if input_ctx.seek(ts, ..).is_ok() {
                        decoder.flush();
                        shared.buffer.lock().clear();
                        shared.is_eof.store(false, Ordering::SeqCst);
                    }
                    continue;
                }
                DecoderCommand::Stop => break,
            }
        }
        if shared.is_stopping.load(Ordering::Acquire) { break; }

        // 背压等待
        { let mut buf = shared.buffer.lock();
          while buf.len() >= BUFFER_CAPACITY {
              if shared.is_stopping.load(Ordering::Acquire) { return; }
              shared.condvar.wait(&mut buf);
          }
        }

        // 解码
        let mut frame = ffmpeg::frame::Audio::empty();
        match decoder.receive_frame(&mut frame) {
            Ok(_) => {
                let samples = resample_interleaved(&mut resampler, &frame, target_ch);
                let fft = resample_mono(&mut fft_resampler, &frame);
                let mut buf = shared.buffer.lock();
                buf.push_back(AudioChunk { samples, fft_samples: fft });
                shared.condvar.notify_one();
            }
            Err(ffmpeg::Error::Other { errno: ffmpeg::ffi::EAGAIN }) => {
                match input_ctx.packets().next() {
                    Some((s, pkt)) if s.index() == stream_idx => { let _ = decoder.send_packet(&pkt); }
                    None => { let _ = decoder.send_eof(); }
                    _ => {}
                }
            }
            Err(ffmpeg::Error::Eof) => break,
            Err(_) => break,
        }
    }
    shared.is_eof.store(true, Ordering::Release);
    shared.condvar.notify_all();
}

fn extract_metadata(ctx: &ffmpeg::format::context::Input) -> AudioMetadata {
    let m = ctx.metadata();
    AudioMetadata {
        title: m.get("title").map(|s| s.to_string()),
        artist: m.get("artist").map(|s| s.to_string()),
        album: m.get("album").map(|s| s.to_string()),
        ..Default::default()
    }
}

fn resample_interleaved(
    resampler: &mut Option<ffmpeg::software::resampling::context::Context>,
    frame: &ffmpeg::frame::Audio, target_ch: u16,
) -> Vec<f32> {
    let mut out = Vec::new();
    if let Some(ctx) = resampler {
        let n = (frame.samples() as f64 * ctx.output().rate as f64 / frame.rate() as f64).ceil() as usize;
        let mut output = ffmpeg::frame::Audio::new(ctx.output().format, n, ctx.output().channel_layout);
        if ctx.run(frame, &mut output).is_ok() {
            let s = output.samples();
            let left = &output.plane::<f32>(0)[..s];
            if target_ch >= 2 {
                let right = &output.plane::<f32>(1)[..s];
                out.reserve(s * 2);
                for i in 0..s { out.push(left[i]); out.push(right[i]); }
            } else { out.extend_from_slice(left); }
        }
    }
    out
}

fn resample_mono(
    resampler: &mut Option<ffmpeg::software::resampling::context::Context>,
    frame: &ffmpeg::frame::Audio,
) -> Vec<f32> {
    if let Some(ctx) = resampler {
        let n = (frame.samples() as f64 * 44100.0 / frame.rate() as f64).ceil() as usize;
        let mut output = ffmpeg::frame::Audio::new(ctx.output().format, n, ctx.output().channel_layout);
        if ctx.run(frame, &mut output).is_ok() {
            let s = output.samples();
            return output.plane::<f32>(0)[..s].to_vec();
        }
    }
    Vec::new()
}
```

#### 播放器状态机 (src/player.rs)

```rust
use std::sync::Arc;
use std::time::Instant;
use napi::threadsafe_function::*;
use parking_lot::RwLock;
use rodio::{OutputStream, Sink, Source};
use crate::{AudioMetadata, PlayerEvent};
use crate::decoder::Decoder;
use crate::fft::FftProcessor;

struct DecoderSource {
    decoder: Arc<Decoder>,
    local_buf: Vec<f32>,
    cursor: usize,
    sample_rate: u32,
    channels: u16,
    fft: Arc<RwLock<FftProcessor>>,
}

impl Iterator for DecoderSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        if self.cursor < self.local_buf.len() {
            let s = self.local_buf[self.cursor];
            self.cursor += 1;
            return Some(s);
        }
        let chunk = self.decoder.pull_chunk()?;
        if !chunk.fft_samples.is_empty() {
            if let Some(mut fft) = self.fft.try_write() {
                fft.push_samples(&chunk.fft_samples);
            }
        }
        self.local_buf = chunk.samples;
        self.cursor = 1;
        self.local_buf.first().copied()
    }
}

impl Source for DecoderSource {
    fn current_span_len(&self) -> Option<usize> { None }
    fn channels(&self) -> u16 { self.channels }
    fn sample_rate(&self) -> u32 { self.sample_rate }
    fn total_duration(&self) -> Option<std::time::Duration> { None }
}

pub struct InnerPlayer {
    sink: Sink,
    _stream: OutputStream,
    decoder: Option<Arc<Decoder>>,
    fft: Arc<RwLock<FftProcessor>>,
    event_cb: Option<ThreadsafeFunction<PlayerEvent, ErrorStrategy::Fatal>>,
    base_time: f64,
    play_instant: Option<Instant>,
    duration: f64,
}

impl InnerPlayer {
    pub fn new() -> anyhow::Result<Self> {
        let (stream, handle) = OutputStream::try_default()?;
        let sink = Sink::try_new(&handle)?;
        sink.pause();
        Ok(Self {
            sink, _stream: stream, decoder: None,
            fft: Arc::new(RwLock::new(FftProcessor::new())),
            event_cb: None, base_time: 0.0, play_instant: None, duration: 0.0,
        })
    }

    pub fn load(&mut self, url: &str) -> anyhow::Result<()> {
        self.sink.stop();
        self.fft.write().clear();

        let decoder = Decoder::new(url, 48000, 2)?;
        self.duration = decoder.metadata.duration;
        let decoder = Arc::new(decoder);
        self.decoder = Some(decoder.clone());

        let (_stream, handle) = OutputStream::try_default()?;
        self.sink = Sink::try_new(&handle)?;
        self._stream = _stream;

        self.sink.append(DecoderSource {
            decoder, local_buf: Vec::new(), cursor: 0,
            sample_rate: 48000, channels: 2, fft: self.fft.clone(),
        });
        self.base_time = 0.0;
        self.play_instant = Some(Instant::now());
        self.emit("loaded", Some(self.duration), None);
        Ok(())
    }

    pub fn play(&mut self) {
        self.sink.play();
        self.play_instant = Some(Instant::now());
    }

    pub fn pause(&mut self) {
        self.base_time = self.get_position();
        self.play_instant = None;
        self.sink.pause();
    }

    pub fn stop(&mut self) {
        self.sink.stop();
        self.play_instant = None;
        self.base_time = 0.0;
        self.decoder = None;
    }

    pub fn seek(&mut self, pos: f64) -> anyhow::Result<()> {
        if let Some(d) = &self.decoder {
            d.seek(std::time::Duration::from_secs_f64(pos))?;
            self.base_time = pos;
            if self.play_instant.is_some() { self.play_instant = Some(Instant::now()); }
        }
        Ok(())
    }

    pub fn set_volume(&mut self, v: f32) { self.sink.set_volume(v.clamp(0.0, 1.0)); }
    pub fn get_position(&self) -> f64 {
        match self.play_instant {
            Some(i) => (self.base_time + i.elapsed().as_secs_f64()).min(self.duration),
            None => self.base_time,
        }
    }
    pub fn get_duration(&self) -> f64 { self.duration }
    pub fn is_playing(&self) -> bool { !self.sink.is_paused() && self.play_instant.is_some() }
    pub fn get_metadata(&self) -> AudioMetadata {
        self.decoder.as_ref().map(|d| d.metadata.clone()).unwrap_or_default()
    }
    pub fn get_fft_data(&self, size: usize) -> Vec<f64> {
        let mut buf = vec![0.0f32; size];
        self.fft.write().read(&mut buf);
        buf.iter().map(|x| *x as f64).collect()
    }
    pub fn set_event_callback(&mut self, cb: ThreadsafeFunction<PlayerEvent, ErrorStrategy::Fatal>) {
        self.event_cb = Some(cb);
    }
    fn emit(&self, t: &str, dur: Option<f64>, err: Option<String>) {
        if let Some(cb) = &self.event_cb {
            cb.call(PlayerEvent {
                event_type: t.into(), position: None,
                duration: dur, error: err, fft_data: None,
            }, ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}
```

#### Electron 主进程桥接 (main/player.ts)

```typescript
import { ipcMain, BrowserWindow } from "electron";
import { AudioPlayer } from "player-native";

let player: AudioPlayer | null = null;

export function setupPlayer(win: BrowserWindow) {
  player = new AudioPlayer();

  player.onEvent((event) => {
    win.webContents.send("player:event", event);
  });

  // 60fps 位置更新
  setInterval(() => {
    if (player?.isPlaying()) {
      win.webContents.send("player:event", {
        eventType: "position",
        position: player.getPosition(),
        duration: player.getDuration(),
      });
    }
  }, 16);

  ipcMain.handle("player:load", (_, url: string) => player!.load(url));
  ipcMain.handle("player:play", () => player!.play());
  ipcMain.handle("player:pause", () => player!.pause());
  ipcMain.handle("player:stop", () => player!.stop());
  ipcMain.handle("player:seek", (_, pos: number) => player!.seek(pos));
  ipcMain.handle("player:setVolume", (_, vol: number) => player!.setVolume(vol));
  ipcMain.handle("player:getMetadata", () => player!.getMetadata());
  ipcMain.handle("player:getFft", (_, size: number) => player!.getFftData(size));
}
```

#### 渲染进程 Vue Composable (renderer/composables/usePlayer.ts)

```typescript
import { ref, onUnmounted } from "vue";
const { ipcRenderer } = window.require("electron");

export function usePlayer() {
  const position = ref(0);
  const duration = ref(0);
  const playing = ref(false);

  const handler = (_: any, event: any) => {
    switch (event.eventType) {
      case "position":
        position.value = event.position;
        duration.value = event.duration;
        break;
      case "loaded":
        duration.value = event.duration;
        break;
      case "ended":
        playing.value = false;
        break;
    }
  };

  ipcRenderer.on("player:event", handler);
  onUnmounted(() => ipcRenderer.removeListener("player:event", handler));

  return {
    position,
    duration,
    playing,
    load: (url: string) => ipcRenderer.invoke("player:load", url),
    play: async () => {
      await ipcRenderer.invoke("player:play");
      playing.value = true;
    },
    pause: async () => {
      await ipcRenderer.invoke("player:pause");
      playing.value = false;
    },
    seek: (pos: number) => ipcRenderer.invoke("player:seek", pos),
    setVolume: (vol: number) => ipcRenderer.invoke("player:setVolume", vol),
  };
}
```

### 6.3 方案 B：Web Audio API（零依赖）

适用场景：只需 MP3/AAC/FLAC/OGG/WAV，追求最简实现和最低内存。

#### 完整实现

```typescript
// renderer/player/StreamPlayer.ts

export class StreamPlayer {
  private audio: HTMLAudioElement;
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private gainNode: GainNode;
  private source: MediaElementAudioSourceNode;
  private animationId: number | null = null;

  // 回调
  onPosition?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (error: string) => void;
  onLoaded?: (duration: number) => void;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";

    this.ctx = new AudioContext();

    // Web Audio 图
    this.source = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.gainNode = this.ctx.createGain();

    this.source.connect(this.analyser);
    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    // 事件绑定
    this.audio.addEventListener("loadedmetadata", () => {
      this.onLoaded?.(this.audio.duration);
    });
    this.audio.addEventListener("ended", () => {
      this.stopPositionLoop();
      this.onEnded?.();
    });
    this.audio.addEventListener("error", (e) => {
      this.onError?.(this.audio.error?.message || "Unknown error");
    });
  }

  load(url: string) {
    this.audio.src = url;
    this.audio.load();
  }

  async play() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await this.audio.play();
    this.startPositionLoop();
  }

  pause() {
    this.audio.pause();
    this.stopPositionLoop();
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.removeAttribute("src");
    this.stopPositionLoop();
  }

  seek(time: number) {
    this.audio.currentTime = time;
  }

  setVolume(volume: number) {
    // 使用 GainNode 而非 audio.volume，音质更好
    this.gainNode.gain.setTargetAtTime(
      Math.max(0, Math.min(1, volume)),
      this.ctx.currentTime,
      0.015, // 15ms 平滑过渡，避免爆音
    );
  }

  get position(): number {
    return this.audio.currentTime;
  }
  get duration(): number {
    return this.audio.duration || 0;
  }
  get isPlaying(): boolean {
    return !this.audio.paused;
  }

  // 获取 FFT 频谱数据
  getFrequencyData(size?: number): Float32Array {
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data); // dB 值, 范围 -100 ~ 0
    if (size && size < data.length) {
      // 降采样到指定大小
      const result = new Float32Array(size);
      const step = data.length / size;
      for (let i = 0; i < size; i++) {
        result[i] = data[Math.floor(i * step)];
      }
      return result;
    }
    return data;
  }

  // 获取时域波形数据
  getTimeDomainData(): Float32Array {
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatTimeDomainData(data);
    return data;
  }

  // 获取缓冲进度 (0-1)
  getBufferedProgress(): number {
    if (this.audio.buffered.length > 0) {
      return this.audio.buffered.end(this.audio.buffered.length - 1) / this.duration;
    }
    return 0;
  }

  private startPositionLoop() {
    const tick = () => {
      this.onPosition?.(this.audio.currentTime, this.audio.duration || 0);
      this.animationId = requestAnimationFrame(tick);
    };
    this.animationId = requestAnimationFrame(tick);
  }

  private stopPositionLoop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy() {
    this.stopPositionLoop();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.ctx.close();
  }
}
```

#### Vue Composable

```typescript
// renderer/composables/useWebPlayer.ts
import { ref, onUnmounted } from "vue";
import { StreamPlayer } from "../player/StreamPlayer";

export function usePlayer() {
  const position = ref(0);
  const duration = ref(0);
  const playing = ref(false);
  const buffered = ref(0);
  const fftData = ref<Float32Array>(new Float32Array(0));

  const player = new StreamPlayer();

  player.onPosition = (pos, dur) => {
    position.value = pos;
    duration.value = dur;
    buffered.value = player.getBufferedProgress();
  };
  player.onLoaded = (dur) => {
    duration.value = dur;
  };
  player.onEnded = () => {
    playing.value = false;
  };

  onUnmounted(() => player.destroy());

  return {
    position,
    duration,
    playing,
    buffered,
    fftData,

    load: (url: string) => player.load(url),
    play: async () => {
      await player.play();
      playing.value = true;
    },
    pause: () => {
      player.pause();
      playing.value = false;
    },
    stop: () => {
      player.stop();
      playing.value = false;
    },
    seek: (pos: number) => player.seek(pos),
    setVolume: (vol: number) => player.setVolume(vol),
    getFft: (size = 128) => {
      fftData.value = player.getFrequencyData(size);
      return fftData.value;
    },
  };
}
```

### 6.4 方案 C：napi-rs + Symphonia（纯 Rust）

适用场景：需要比 Web Audio API 更多的格式支持，但不想编译 FFmpeg。

#### Cargo.toml

```toml
[dependencies]
napi = { version = "2", features = ["async", "threadsafe_function", "serde-json"] }
napi-derive = "2"

# 纯 Rust 解码 — 按需启用格式
symphonia = { version = "0.5", features = [
    "mp3", "aac", "flac", "pcm", "vorbis", "alac",
    "isomp4", "ogg", "wav", "mkv", "adts",
] }

rodio = "0.21"
parking_lot = "0.12"
spectrum-analyzer = "1.5"
rubato = "0.15"         # 纯 Rust 重采样
ureq = "3"              # HTTP 请求（网络流）
anyhow = "1"

[build-dependencies]
napi-build = "2"
```

#### 网络流支持 — 自定义 MediaSource

```rust
use symphonia::core::io::MediaSource;
use std::io::{Read, Seek, SeekFrom};

pub struct HttpMediaSource {
    url: String,
    reader: Box<dyn Read + Send + Sync>,
    position: u64,
    content_length: Option<u64>,
}

impl HttpMediaSource {
    pub fn new(url: &str) -> anyhow::Result<Self> {
        let resp = ureq::get(url).call()?;
        let len = resp.headers().get("Content-Length")
            .and_then(|s| s.to_str().ok())
            .and_then(|s| s.parse().ok());
        Ok(Self {
            url: url.to_string(),
            reader: resp.into_body().into_reader(),
            position: 0,
            content_length: len,
        })
    }
}

impl Read for HttpMediaSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.reader.read(buf)?;
        self.position += n as u64;
        Ok(n)
    }
}

impl Seek for HttpMediaSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let new_pos = match pos {
            SeekFrom::Start(p) => p,
            SeekFrom::Current(p) => (self.position as i64 + p) as u64,
            SeekFrom::End(p) => self.content_length
                .map(|l| (l as i64 + p) as u64)
                .ok_or_else(|| std::io::Error::new(
                    std::io::ErrorKind::Unsupported, "unknown length"
                ))?,
        };
        // HTTP Range 请求重建连接
        let resp = ureq::get(&self.url)
            .header("Range", &format!("bytes={}-", new_pos))
            .call()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        self.reader = resp.into_body().into_reader();
        self.position = new_pos;
        Ok(new_pos)
    }
}

impl MediaSource for HttpMediaSource {
    fn is_seekable(&self) -> bool { self.content_length.is_some() }
    fn byte_len(&self) -> Option<u64> { self.content_length }
}
```

#### 解码器用法

```rust
use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;
use symphonia::core::formats::FormatReader;
use symphonia::core::codecs::Decoder;

fn open_audio(url: &str) -> anyhow::Result<(Box<dyn FormatReader>, Box<dyn Decoder>)> {
    let source: Box<dyn MediaSource> = if url.starts_with("http://") || url.starts_with("https://") {
        Box::new(HttpMediaSource::new(url)?)
    } else {
        Box::new(std::fs::File::open(url)?)
    };

    let mss = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = url.rsplit('.').next() {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())?;
    let format = probed.format;
    let track = format.default_track().unwrap();
    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &Default::default())?;

    Ok((format, decoder))
}
```

---

## 七、方案选型建议

```
你的需求
  │
  ├── 只播放 MP3/AAC/FLAC/OGG/WAV？
  │   └── ✅ 方案 B: Web Audio API
  │       • 内存 ~3-8 MB
  │       • 零编译、零依赖
  │       • 浏览器自动缓冲管理
  │       • FFT/音量内置
  │
  ├── 还要 ALAC (M4A Apple Lossless)？
  │   └── ✅ 方案 C: Symphonia
  │       • 内存 ~3-7 MB
  │       • cargo build 一把梭
  │       • 纯 Rust，跨平台无痛
  │
  └── 还要 APE/WMA/DSD/TTA/WavPack？
      └── ✅ 方案 A: FFmpeg
          • 内存 ~15-25 MB（精简后 ~8-15 MB）
          • 格式支持最全
          • 编译较复杂
```

**务实建议**：大多数网络音乐平台只提供 MP3/AAC/FLAC/OGG，**方案 B 覆盖 95% 场景**。后续如有需要，再按 B → C → A 逐步升级，三套方案的前端接口设计是兼容的。
