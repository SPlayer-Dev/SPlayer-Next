# audio-engine

Rust 音频引擎，通过 NAPI-RS 暴露给 Electron 主进程。FFmpeg 解码，CPAL 负责跨平台输出，Windows 独占输出直接使用 WASAPI。

## 目录与职责

| 目录                         | 职责                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `src/bindings/player/`       | JS 类型和接口；按加载、seek、设备、事件、控制拆分，负责异步任务与错误转换 |
| `src/player/`                | 播放状态、资源所有权、加载代次、后台任务和状态转换                        |
| `src/decoder/`               | FFmpeg 读取、seek、重采样、解码与 DSP 工作线程、有界缓冲、输出供数        |
| `src/dsp/`                   | 均衡器、响度归一化、变速变调、限幅、FFT                                   |
| `src/output/`                | 设备选择、CPAL 输出流、播放句柄、Windows COM 线程与 PipeWire 环境         |
| `src/output/wasapi/`         | 独占流生命周期、设备格式协商、PCM 转换                                    |
| `src/output/device_watcher/` | 各平台设备变化监听                                                        |
| `src/metadata/`              | 标签、封面、歌词读取与写入                                                |
| `src/tests/`                 | 跨模块解码链路、真实 PipeWire 输出测试及音源 fixture                      |
| `tests/`                     | Node.js 加载实际 `.node` 插件的接口集成测试                               |

模块单元测试通过 `#[cfg(test)]` 和 `#[path]` 引入为被测模块的子模块，可访问私有实现。跨模块测试集中在 `src/tests/`；实际加载 `.node` 的 JS 集成测试位于 `tests/`。

## 构建与测试

在仓库根目录运行：

```bash
pnpm --dir native/audio-engine build:debug
cargo test -p audio-engine --lib
cargo fmt -p audio-engine --check
```

构建生成 `audio-engine.node` 和 `index.d.ts`。类型声明由 NAPI-RS 生成，不手动维护；主进程通过 `@splayer/audio-engine` 引用。

Linux PipeWire 集成测试需要 PipeWire、WirePlumber、D-Bus 和对应开发依赖。脚本创建独立服务和虚拟输出，日志目录在退出时打印：

```bash
bash scripts/test-pipewire.sh
```

JS 集成测试需要已构建的本机插件和可用音频输出设备：

```bash
pnpm --dir native/audio-engine test:integration
```

测试默认加载模块目录下的 `audio-engine.node`，也可通过 `SPLAYER_AUDIO_ENGINE_MODULE` 指定 `.node` 的绝对路径。测试音源由临时 WAV 和本机 HTTP 服务提供，无需连接在线音乐服务。
