//! 空操作日志宏——taskbar-lyric 模块不依赖 tracing，日志通过 electron-log 在 JS 侧处理

macro_rules! trace {
    ($($arg:tt)*) => {};
}

macro_rules! debug {
    ($($arg:tt)*) => {};
}

macro_rules! warn {
    ($($arg:tt)*) => {};
}

macro_rules! error {
    ($($arg:tt)*) => {};
}
