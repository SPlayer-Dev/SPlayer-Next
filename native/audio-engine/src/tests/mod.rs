//! 跨模块音频链路回归；私有实现的单元测试保留在各模块下。
mod decoder;
mod fixtures;
#[cfg(target_os = "linux")]
mod pipewire;
#[cfg(target_os = "windows")]
mod wasapi;
