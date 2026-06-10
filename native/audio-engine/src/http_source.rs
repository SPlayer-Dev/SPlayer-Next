//! 把 HTTP/HTTPS 资源伪装成 Read + Seek 流喂给 ffmpeg_audio
//!
//! 行为对齐 Chrome <audio> / mpv stream_lavf：单个开放 Range GET 服务全部顺序读
//! TCP 背压自然节流。read 错误（CDN 闲置超时、TCP 静默死亡、网络瞬断）触发
//! 自动重连 `Range: bytes={pos}-`，FFmpeg 无感
//!
//! 取消传播：`cancel_handle()` 注入 `shared.bind_interrupt`，player.stop() 触发后
//! 最长 SOCKET_READ_TIMEOUT_SECS 内 read 返回 Interrupted

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use anyhow::{anyhow, Context, Result};
use tracing::{debug, warn};

const USER_AGENT: &str = "SPlayer-Next/1.0";
const PROBE_TIMEOUT_SECS: u64 = 10;
/// 重连阶段的 connect 超时：cancel flag 能打断 read 但打断不了 ureq 的 connect，
/// 复用 10s 的 probe 超时会让网络抖动时的同步 stop() 被卡住最长 10s
const RECONNECT_CONNECT_TIMEOUT_SECS: u64 = 2;
const SOCKET_READ_TIMEOUT_SECS: u64 = 2;
const MAX_RECONNECT_ATTEMPTS: u32 = 3;
const RETRY_BACKOFF_BASE_MS: u64 = 200;
const RETRY_AFTER_MAX_SECS: u64 = 5;

#[derive(Clone, Copy)]
pub(crate) struct Config {
    pub socket_read_timeout: Duration,
    pub probe_timeout: Duration,
    pub max_reconnect_attempts: u32,
    pub retry_backoff_base: Duration,
    pub retry_after_max: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            socket_read_timeout: Duration::from_secs(SOCKET_READ_TIMEOUT_SECS),
            probe_timeout: Duration::from_secs(PROBE_TIMEOUT_SECS),
            max_reconnect_attempts: MAX_RECONNECT_ATTEMPTS,
            retry_backoff_base: Duration::from_millis(RETRY_BACKOFF_BASE_MS),
            retry_after_max: Duration::from_secs(RETRY_AFTER_MAX_SECS),
        }
    }
}

enum OpenOutcome {
    Ok,
    Fatal(io::Error),
    Retryable {
        error: io::Error,
        retry_after: Option<Duration>,
    },
}

enum RetryAction {
    FailFast,
    Backoff,
    RetryAfter,
}

fn classify_status(code: u16) -> RetryAction {
    match code {
        429 | 503 => RetryAction::RetryAfter,
        400..=499 => RetryAction::FailFast,
        _ => RetryAction::Backoff,
    }
}

/// 解析 `Content-Range: bytes 0-999/12345` 中末尾的 total
/// 形如 `bytes 0-999/*` 表示未知，返回 None
fn parse_content_range_total(header: &str) -> Option<u64> {
    let after_slash = header.rsplit_once('/')?.1.trim();
    if after_slash == "*" {
        return None;
    }
    after_slash.parse().ok()
}

/// 解析 Retry-After，仅支持纯秒数（HTTP-date 形式暂不支持，回退到退避）
fn parse_retry_after(header: &str) -> Option<Duration> {
    let trimmed = header.trim();
    match trimmed.parse::<u64>() {
        Ok(secs) => Some(Duration::from_secs(secs)),
        Err(_) => {
            warn!(value = trimmed, "Retry-After 非纯秒数，回退到指数退避");
            None
        }
    }
}

/// 基于 SystemTime 子秒 nano 的低成本伪随机 jitter，±25%
fn jitter(base: Duration) -> Duration {
    let nanos = base.as_nanos() as u64;
    if nanos == 0 {
        return base;
    }
    let max_offset = nanos / 4;
    if max_offset == 0 {
        return base;
    }
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let offset = (seed % (2 * max_offset + 1)) as i64 - max_offset as i64;
    let result = (nanos as i64 + offset).max(0) as u64;
    Duration::from_nanos(result)
}

pub struct HttpRangeSource {
    url: String,
    agent: ureq::Agent,
    total_size: u64,
    /// 服务端是否支持 Range：首次探测为 206 即 true，200 fallback 即 false
    range_supported: bool,
    pos: u64,
    /// 当前活动的 HTTP body reader，跟 pos 关联；None 表示需要重新发起 GET
    stream: Option<Box<dyn Read + Send + Sync>>,
    cancel: Arc<AtomicBool>,
    config: Config,
}

/// 按指定 connect 超时构建 agent；read/write 超时统一取自 config
fn build_agent(connect_timeout: Duration, config: &Config) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent(USER_AGENT)
        .timeout_connect(connect_timeout)
        .timeout_read(config.socket_read_timeout)
        .timeout_write(config.socket_read_timeout)
        .build()
}

impl HttpRangeSource {
    pub fn new(url: impl Into<String>) -> Result<Self> {
        Self::new_with_config(url, Config::default())
    }

    pub(crate) fn new_with_config(url: impl Into<String>, config: Config) -> Result<Self> {
        let url = url.into();
        // 初始探测允许更长的 connect 超时
        let probe_agent = build_agent(config.probe_timeout, &config);

        let resp = probe_agent
            .get(&url)
            .set("Range", "bytes=0-")
            .call()
            .with_context(|| format!("初始 GET 失败: {url}"))?;

        let status = resp.status();
        let (total_size, range_supported) = match status {
            206 => {
                let cr = resp
                    .header("Content-Range")
                    .ok_or_else(|| anyhow!("206 响应缺少 Content-Range 头: {url}"))?;
                let total = parse_content_range_total(cr)
                    .ok_or_else(|| anyhow!("Content-Range 解析失败: {cr}"))?;
                (total, true)
            }
            200 => {
                let cl = resp
                    .header("Content-Length")
                    .ok_or_else(|| anyhow!("200 响应缺少 Content-Length，无法估算长度: {url}"))?;
                let total: u64 = cl
                    .parse()
                    .with_context(|| format!("Content-Length 解析失败: {cl}"))?;
                warn!(url, "服务端不支持 Range（返回 200），seek 将失败");
                (total, false)
            }
            s => return Err(anyhow!("初始 GET 意外状态: {s}")),
        };

        // 后续重连专用 agent：connect 超时缩短，保证 stop() 不被 connect 阶段长时间卡住
        let agent = build_agent(Duration::from_secs(RECONNECT_CONNECT_TIMEOUT_SECS), &config);

        Ok(Self {
            url,
            agent,
            total_size,
            range_supported,
            pos: 0,
            stream: Some(resp.into_reader()),
            cancel: Arc::new(AtomicBool::new(false)),
            config,
        })
    }

    /// 拿 cancel flag 的 Arc clone，注入到 shared 后即可被 player.stop() 触发
    pub fn cancel_handle(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }

    fn check_cancel(&self) -> io::Result<()> {
        if self.cancel.load(Ordering::Acquire) {
            Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"))
        } else {
            Ok(())
        }
    }

    /// 单次尝试开 stream 到当前 pos。不内部重试，由调用方按 OpenOutcome 决定后续
    fn open_stream(&mut self) -> OpenOutcome {
        if self.pos > 0 && !self.range_supported {
            return OpenOutcome::Fatal(io::Error::other(
                "服务端最初不支持 Range，无法从非 0 位置恢复",
            ));
        }
        let range_header = format!("bytes={}-", self.pos);

        match self.agent.get(&self.url).set("Range", &range_header).call() {
            Ok(resp) => {
                let status = resp.status();
                if self.pos > 0 && status == 200 {
                    return OpenOutcome::Fatal(io::Error::other(
                        "服务端忽略 Range，返回 200 而非 206，数据会错位",
                    ));
                }
                if status != 200 && status != 206 {
                    return OpenOutcome::Fatal(io::Error::other(format!(
                        "重连意外状态码: {status}"
                    )));
                }
                self.stream = Some(resp.into_reader());
                OpenOutcome::Ok
            }
            Err(ureq::Error::Status(code, resp)) => match classify_status(code) {
                RetryAction::FailFast => {
                    OpenOutcome::Fatal(io::Error::other(format!("GET 返回 {code}（不可重试）")))
                }
                RetryAction::RetryAfter => OpenOutcome::Retryable {
                    error: io::Error::other(format!("status {code}")),
                    retry_after: resp.header("Retry-After").and_then(parse_retry_after),
                },
                RetryAction::Backoff => OpenOutcome::Retryable {
                    error: io::Error::other(format!("status {code}")),
                    retry_after: None,
                },
            },
            Err(ureq::Error::Transport(t)) => OpenOutcome::Retryable {
                error: io::Error::other(format!("transport: {t}")),
                retry_after: None,
            },
        }
    }

    fn sleep_with_cancel(&self, dur: Duration) -> io::Result<()> {
        let deadline = Instant::now() + dur;
        loop {
            self.check_cancel()?;
            let now = Instant::now();
            if now >= deadline {
                return Ok(());
            }
            let chunk = (deadline - now).min(Duration::from_millis(50));
            thread::sleep(chunk);
        }
    }

    /// 指数退避 + ±25% jitter
    fn backoff_delay(&self, attempt: u32) -> Duration {
        let shift = attempt.saturating_sub(1).min(8);
        let base = self.config.retry_backoff_base * (1u32 << shift);
        jitter(base)
    }
}

impl Read for HttpRangeSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.check_cancel()?;
        if self.pos >= self.total_size || buf.is_empty() {
            return Ok(0);
        }

        let mut attempts: u32 = 0;
        let max = self.config.max_reconnect_attempts;
        loop {
            self.check_cancel()?;

            if self.stream.is_none() {
                match self.open_stream() {
                    OpenOutcome::Ok => {}
                    OpenOutcome::Fatal(e) => return Err(e),
                    OpenOutcome::Retryable { error, retry_after } => {
                        if attempts >= max {
                            return Err(error);
                        }
                        attempts += 1;
                        let wait = retry_after
                            .map(|d| d.min(self.config.retry_after_max))
                            .unwrap_or_else(|| self.backoff_delay(attempts));
                        warn!(error = %error, attempts, wait_ms = wait.as_millis(),
                              "open_stream 失败，退避重试");
                        self.sleep_with_cancel(wait)?;
                        continue;
                    }
                }
            }

            let stream = self
                .stream
                .as_mut()
                .expect("stream is Some after open_stream Ok");
            match stream.read(buf) {
                Ok(0) => {
                    self.stream = None;
                    if self.pos >= self.total_size {
                        return Ok(0);
                    }
                    // 同样计入重连次数并退避：服务端持续返回合法但空 body 的响应
                    //（如文件被替换变短）时，不计数会变成全速重连死循环
                    if attempts >= max {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "提前 EOF 且重连次数耗尽",
                        ));
                    }
                    attempts += 1;
                    let wait = self.backoff_delay(attempts);
                    debug!(
                        pos = self.pos,
                        total = self.total_size,
                        attempts,
                        "stream 早 EOF，退避重连"
                    );
                    self.sleep_with_cancel(wait)?;
                    continue;
                }
                Ok(n) => {
                    self.pos += n as u64;
                    return Ok(n);
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {
                    self.check_cancel()?;
                    continue;
                }
                Err(e) => {
                    self.stream = None;
                    if attempts >= max {
                        return Err(e);
                    }
                    attempts += 1;
                    let wait = self.backoff_delay(attempts);
                    warn!(error = %e, attempts, wait_ms = wait.as_millis(),
                          "stream read 失败，退避重连");
                    self.sleep_with_cancel(wait)?;
                }
            }
        }
    }
}

impl Seek for HttpRangeSource {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new_pos = match pos {
            SeekFrom::Start(p) => p,
            SeekFrom::End(o) => {
                if o >= 0 {
                    self.total_size.saturating_add(o as u64)
                } else {
                    self.total_size.saturating_sub(o.unsigned_abs())
                }
            }
            SeekFrom::Current(o) => {
                if o >= 0 {
                    self.pos.saturating_add(o as u64)
                } else {
                    self.pos.saturating_sub(o.unsigned_abs())
                }
            }
        };
        if new_pos != self.pos {
            self.stream = None;
            self.pos = new_pos;
        }
        Ok(new_pos)
    }
}

/// 判断 source 字符串是否是 http/https URL
pub fn is_network_source(source: &str) -> bool {
    source.starts_with("http://") || source.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use std::io::Read;
    use std::sync::atomic::Ordering;
    use std::thread;
    use std::time::Duration;

    fn test_config() -> Config {
        Config {
            socket_read_timeout: Duration::from_millis(300),
            probe_timeout: Duration::from_secs(2),
            max_reconnect_attempts: 2,
            retry_backoff_base: Duration::from_millis(20),
            retry_after_max: Duration::from_millis(200),
        }
    }

    fn body_n(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn probe_206_open_range() {
        let server = MockServer::start();
        let payload = body_n(1024);
        let mock = server.mock(|when, then| {
            when.method(GET).path("/file");
            then.status(206)
                .header(
                    "Content-Range",
                    format!("bytes 0-{}/{}", payload.len() - 1, payload.len()),
                )
                .header("Content-Length", payload.len().to_string())
                .body(&payload);
        });

        let src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();
        assert_eq!(src.total_size, 1024);
        assert!(src.range_supported);
        assert!(src.stream.is_some());
        mock.assert_hits(1);
    }

    #[test]
    fn probe_200_fallback_non_seekable() {
        let server = MockServer::start();
        let payload = body_n(512);
        server.mock(|when, then| {
            when.method(GET).path("/file");
            then.status(200)
                .header("Content-Length", payload.len().to_string())
                .body(&payload);
        });

        let src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();
        assert_eq!(src.total_size, 512);
        assert!(!src.range_supported);
    }

    #[test]
    fn sequential_read_single_get() {
        let server = MockServer::start();
        let payload = body_n(8192);
        let mock = server.mock(|when, then| {
            when.method(GET).path("/file");
            then.status(206)
                .header(
                    "Content-Range",
                    format!("bytes 0-{}/{}", payload.len() - 1, payload.len()),
                )
                .body(&payload);
        });

        let mut src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();
        let mut out = Vec::new();
        src.read_to_end(&mut out).unwrap();
        assert_eq!(out, payload);
        mock.assert_hits(1);
    }

    #[test]
    fn seek_invalidates_stream_and_reconnects() {
        let server = MockServer::start();
        let payload = body_n(4096);
        let total = payload.len();

        let m_initial = server.mock(|when, then| {
            when.method(GET).path("/file").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", format!("bytes 0-{}/{}", total - 1, total))
                .body(&payload);
        });
        let m_seek = server.mock(|when, then| {
            when.method(GET)
                .path("/file")
                .header("range", "bytes=2000-");
            then.status(206)
                .header(
                    "Content-Range",
                    format!("bytes 2000-{}/{}", total - 1, total),
                )
                .body(&payload[2000..]);
        });

        let mut src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();

        let mut head = vec![0u8; 100];
        src.read_exact(&mut head).unwrap();
        assert_eq!(head, payload[..100]);

        src.seek(SeekFrom::Start(2000)).unwrap();
        assert!(src.stream.is_none());

        let mut mid = vec![0u8; 100];
        src.read_exact(&mut mid).unwrap();
        assert_eq!(mid, payload[2000..2100]);

        m_initial.assert_hits(1);
        m_seek.assert_hits(1);
    }

    #[test]
    fn fail_fast_on_404() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/missing");
            then.status(404);
        });

        let result = HttpRangeSource::new_with_config(server.url("/missing"), test_config());
        assert!(result.is_err());
        // 初始 GET 不走重试路径（new 直接返错），所以应该只命中 1 次
        mock.assert_hits(1);
    }

    #[test]
    fn backoff_on_5xx() {
        let server = MockServer::start();
        let payload = body_n(256);
        let total = payload.len();

        // 第一次是初始 GET 成功（206）
        let m_init = server.mock(|when, then| {
            when.method(GET).path("/file").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", format!("bytes 0-{}/{}", total - 1, total))
                .body(&payload[..50]);
        });
        // 提前 EOF 后会触发 ensure_stream 重连。前两次返 503，第三次成功
        let _m_503 = server.mock(|when, then| {
            when.method(GET).path("/file").header("range", "bytes=50-");
            then.status(503);
        });

        let mut src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();
        let mut buf = vec![0u8; total];
        let result = src.read_to_end(&mut buf);
        // 第二段反复 503 用尽重试预算 → 失败
        assert!(result.is_err());
        m_init.assert_hits(1);
    }

    #[test]
    fn cancel_flag_interrupts_pending_read() {
        // 场景 A：read 调用前 cancel 已被置位 → 立即返回 Interrupted
        let server = MockServer::start();
        let total = 1024u64;
        let initial = body_n(100);
        server.mock(|when, then| {
            when.method(GET).path("/file");
            then.status(206)
                .header("Content-Range", format!("bytes 0-{}/{}", total - 1, total))
                .body(&initial);
        });

        let mut src = HttpRangeSource::new_with_config(server.url("/file"), test_config()).unwrap();
        let cancel = src.cancel_handle();

        let mut buf = vec![0u8; 50];
        src.read_exact(&mut buf).unwrap();

        cancel.store(true, Ordering::Release);

        let mut more = vec![0u8; 50];
        let err = src.read(&mut more).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::Interrupted);
    }

    #[test]
    fn cancel_flag_interrupts_during_backoff() {
        // 场景 B：cancel 在 sleep_with_cancel 退避期间触发
        // 用 503 触发 Retryable 路径，让 read 落入 sleep_with_cancel
        let mut config = test_config();
        config.retry_backoff_base = Duration::from_millis(500); // 足够长以被 cancel 截断
        config.max_reconnect_attempts = 5;

        let server = MockServer::start();
        let total = 1024u64;
        let initial = body_n(100);
        server.mock(|when, then| {
            when.method(GET).path("/file").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", format!("bytes 0-{}/{}", total - 1, total))
                .body(&initial);
        });
        server.mock(|when, then| {
            when.method(GET).path("/file").header("range", "bytes=100-");
            then.status(503);
        });

        let mut src = HttpRangeSource::new_with_config(server.url("/file"), config).unwrap();
        let cancel = src.cancel_handle();

        let mut buf = vec![0u8; 100];
        src.read_exact(&mut buf).unwrap();

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            cancel.store(true, Ordering::Release);
        });

        let mut more = vec![0u8; 100];
        let start = Instant::now();
        let err = src.read(&mut more).unwrap_err();
        let elapsed = start.elapsed();

        assert_eq!(err.kind(), io::ErrorKind::Interrupted);
        // 503 快速返回 → 进 sleep_with_cancel(500ms)，cancel 在 ~100ms 触发，应在 ~150ms 内返回
        assert!(
            elapsed < Duration::from_secs(1),
            "cancel 响应超时: {elapsed:?}"
        );
    }

    #[test]
    fn parse_content_range_total_basic() {
        assert_eq!(parse_content_range_total("bytes 0-999/12345"), Some(12345));
        assert_eq!(parse_content_range_total("bytes 100-200/500"), Some(500));
        assert_eq!(parse_content_range_total("bytes 0-9/*"), None);
        assert_eq!(parse_content_range_total("garbage"), None);
    }

    #[test]
    fn parse_retry_after_seconds() {
        assert_eq!(parse_retry_after("5"), Some(Duration::from_secs(5)));
        assert_eq!(parse_retry_after("  10 "), Some(Duration::from_secs(10)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
    }

    #[test]
    fn classify_status_table() {
        assert!(matches!(classify_status(200), RetryAction::Backoff));
        assert!(matches!(classify_status(404), RetryAction::FailFast));
        assert!(matches!(classify_status(403), RetryAction::FailFast));
        assert!(matches!(classify_status(429), RetryAction::RetryAfter));
        assert!(matches!(classify_status(500), RetryAction::Backoff));
        assert!(matches!(classify_status(503), RetryAction::RetryAfter));
    }
}
