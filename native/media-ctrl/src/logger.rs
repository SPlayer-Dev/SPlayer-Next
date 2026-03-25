use std::{fs, path::PathBuf, sync::OnceLock};

use tracing::trace;
use tracing_appender::{non_blocking::WorkerGuard, rolling::RollingFileAppender};
use tracing_subscriber::{
    Layer,
    filter::{LevelFilter, Targets},
    fmt::{self, time::LocalTime},
    layer::SubscriberExt,
    util::SubscriberInitExt,
};

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// 初始化 tracing 日志系统
///
/// - `log_dir`: 日志输出目录（由 JS 侧传入，如 `{userData}/logs/native`）
/// - `is_dev`: 开发模式时 stdout 级别为 debug，生产模式为 warn
///
/// audio-engine 和 media-ctrl 在同一进程中共享全局 tracing subscriber。
/// 先被调用的模块完成初始化，后被调用的模块 `try_init` 会无害失败。
/// 两个模块的日志通过 target 字段自动区分。
pub fn init_logger(log_dir: &str, is_dev: bool) {
    let log_path = PathBuf::from(log_dir);

    if !log_path.exists() {
        let _ = fs::create_dir_all(&log_path);
    }

    let file_appender = match RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("media-ctrl")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&log_path)
    {
        Ok(appender) => appender,
        Err(_) => return,
    };

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    if LOG_GUARD.set(guard).is_err() {
        return;
    }

    let time_format = time::macros::format_description!("[hour]:[minute]:[second]");
    let local_timer = LocalTime::new(time_format);

    let crate_name = env!("CARGO_PKG_NAME").replace('-', "_");

    let file_filter = Targets::new().with_target(&crate_name, LevelFilter::TRACE);
    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_timer(local_timer.clone())
        .with_filter(file_filter);

    let stdout_level = if is_dev { LevelFilter::DEBUG } else { LevelFilter::WARN };
    let stdout_filter = Targets::new().with_target(&crate_name, stdout_level);
    let stdout_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(true)
        .pretty()
        .with_timer(local_timer)
        .with_filter(stdout_filter);

    let _ = tracing_subscriber::registry()
        .with(file_layer)
        .with(stdout_layer)
        .try_init();

    trace!(path = ?log_path, is_dev, "media-ctrl 日志系统初始化完成");
}
