//! 将 HTTP Range 音频包装为延迟请求的 `Read + Seek`。
//!
//! FFmpeg 初始化和时间跳转会连续发出多个字节 seek。这里只记录最终位置，
//! 直到下一次 read 才建立 Range 流，避免每次探测都产生一次网络请求。

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

const USER_AGENT: &str = "SPlayer-Next/1.0";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

enum OpenError {
    Fatal(io::Error),
    Retryable(io::Error),
}

/** 可重置的网络中断句柄，seek 可复用同一个 HTTP 源。 */
#[derive(Clone)]
pub struct HttpInterrupt {
    token: Arc<Mutex<CancellationToken>>,
}

impl HttpInterrupt {
    fn new() -> Self {
        Self {
            token: Arc::new(Mutex::new(CancellationToken::new())),
        }
    }

    /** 取消当前网络会话。 */
    pub fn cancel(&self) {
        self.token.lock().cancel();
    }

    /** seek 前替换已取消的令牌，同时保留 HTTP 源与 FFmpeg 上下文。 */
    pub fn reset(&self) {
        let mut token = self.token.lock();
        if token.is_cancelled() {
            *token = CancellationToken::new();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.token.lock().is_cancelled()
    }
}

/** 延迟建立 Range 流的 HTTP 音频源。 */
pub struct HttpRangeSource {
    url: String,
    agent: ureq::Agent,
    total_size: u64,
    pos: u64,
    stream: Option<Box<dyn Read + Send + Sync>>,
    interrupt: HttpInterrupt,
}

impl HttpRangeSource {
    /** 探测远端文件并复用首次响应作为起始数据流。 */
    pub fn new(url: impl Into<String>) -> Result<Self> {
        let url = url.into();
        let probe_agent = build_agent(PROBE_TIMEOUT);
        let response = probe_agent
            .get(&url)
            .set("Range", "bytes=0-")
            .call()
            .with_context(|| format!("初始 Range 请求失败: {url}"))?;
        let total_size = validate_response(&response, 0, None)?;

        Ok(Self {
            url,
            agent: build_agent(CONNECT_TIMEOUT),
            total_size,
            pos: 0,
            stream: Some(response.into_reader()),
            interrupt: HttpInterrupt::new(),
        })
    }

    /** 获取供播放器 stop/seek 使用的共享中断句柄。 */
    pub fn interrupt_handle(&self) -> HttpInterrupt {
        self.interrupt.clone()
    }

    fn ensure_active(&self) -> io::Result<()> {
        if self.interrupt.is_cancelled() {
            Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"))
        } else {
            Ok(())
        }
    }

    fn open_stream(&mut self) -> Result<(), OpenError> {
        self.ensure_active().map_err(OpenError::Fatal)?;
        if self.pos >= self.total_size {
            return Ok(());
        }

        let range = format!("bytes={}-", self.pos);
        match self.agent.get(&self.url).set("Range", &range).call() {
            Ok(response) => {
                validate_response(&response, self.pos, Some(self.total_size))
                    .map_err(|error| OpenError::Fatal(io::Error::other(error.to_string())))?;
                self.stream = Some(response.into_reader());
                debug!(position = self.pos, "HTTP Range 流已建立");
                Ok(())
            }
            Err(ureq::Error::Status(status, _))
                if (400..500).contains(&status) && status != 429 =>
            {
                Err(OpenError::Fatal(io::Error::other(format!(
                    "HTTP Range 请求失败: {status}"
                ))))
            }
            Err(error) => Err(OpenError::Retryable(io::Error::other(error.to_string()))),
        }
    }

    fn wait_backoff(&self, duration: Duration) -> io::Result<()> {
        let step = Duration::from_millis(50);
        let mut waited = Duration::ZERO;
        while waited < duration {
            self.ensure_active()?;
            let remaining = duration - waited;
            let current = remaining.min(step);
            thread::sleep(current);
            waited += current;
        }
        Ok(())
    }
}

impl Read for HttpRangeSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.ensure_active()?;
        if self.pos >= self.total_size || buf.is_empty() {
            return Ok(0);
        }

        let mut failures = 0_u32;
        loop {
            self.ensure_active()?;
            if self.stream.is_none() {
                match self.open_stream() {
                    Ok(()) => {}
                    Err(OpenError::Fatal(error)) => return Err(error),
                    Err(OpenError::Retryable(error)) => {
                        failures += 1;
                        if failures > MAX_CONSECUTIVE_FAILURES {
                            return Err(error);
                        }
                        let wait = retry_delay(failures);
                        warn!(error = %error, failures, wait_ms = wait.as_millis(), "HTTP Range 建立失败，退避重试");
                        self.wait_backoff(wait)?;
                        continue;
                    }
                }
            }
            let result = self.stream.as_mut().expect("stream 应已建立").read(buf);
            match result {
                Ok(0) if self.pos < self.total_size => {
                    self.stream = None;
                    failures += 1;
                    if failures > MAX_CONSECUTIVE_FAILURES {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "HTTP 流连续提前结束",
                        ));
                    }
                    let wait = retry_delay(failures);
                    warn!(
                        position = self.pos,
                        failures,
                        wait_ms = wait.as_millis(),
                        "HTTP 流提前结束，退避续传"
                    );
                    self.wait_backoff(wait)?;
                }
                Ok(n) => {
                    self.pos += n as u64;
                    return Ok(n);
                }
                Err(error) => {
                    self.ensure_active()?;
                    self.stream = None;
                    failures += 1;
                    if failures > MAX_CONSECUTIVE_FAILURES {
                        return Err(error);
                    }
                    let wait = retry_delay(failures);
                    warn!(position = self.pos, error = %error, failures, wait_ms = wait.as_millis(), "HTTP 读取失败，退避续传");
                    self.wait_backoff(wait)?;
                }
            }
        }
    }
}

impl Seek for HttpRangeSource {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let target = match position {
            SeekFrom::Start(offset) => offset,
            SeekFrom::Current(offset) => checked_offset(self.pos, offset)?,
            SeekFrom::End(offset) => checked_offset(self.total_size, offset)?,
        };
        if target != self.pos {
            self.pos = target;
            self.stream = None;
        }
        Ok(target)
    }
}

fn build_agent(connect_timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent(USER_AGENT)
        .timeout_connect(connect_timeout)
        .timeout_read(READ_TIMEOUT)
        .timeout_write(READ_TIMEOUT)
        .build()
}

fn checked_offset(base: u64, offset: i64) -> io::Result<u64> {
    if offset >= 0 {
        base.checked_add(offset as u64)
    } else {
        base.checked_sub(offset.unsigned_abs())
    }
    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek 位置超出范围"))
}

fn retry_delay(failures: u32) -> Duration {
    Duration::from_millis(200 * (1 << failures.saturating_sub(1)))
}

fn validate_response(
    response: &ureq::Response,
    expected_start: u64,
    expected_total: Option<u64>,
) -> Result<u64> {
    if response.status() != 206 {
        return Err(anyhow!("服务端未返回 206: {}", response.status()));
    }
    let content_range = response
        .header("Content-Range")
        .ok_or_else(|| anyhow!("206 响应缺少 Content-Range"))?;
    let (start, end, total) = parse_content_range(content_range)
        .ok_or_else(|| anyhow!("Content-Range 无效: {content_range}"))?;
    if start != expected_start {
        return Err(anyhow!(
            "Range 起点不匹配: expected={expected_start}, actual={start}"
        ));
    }
    if expected_total.is_some_and(|expected| expected != total) {
        return Err(anyhow!("远端文件长度发生变化"));
    }
    if end < start || end >= total {
        return Err(anyhow!("Content-Range 范围超出文件长度: {content_range}"));
    }
    Ok(total)
}

fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use std::io::Write;
    use std::net::TcpListener;

    fn payload(length: usize) -> Vec<u8> {
        (0..length).map(|index| (index % 251) as u8).collect()
    }

    fn write_range_response(stream: &mut impl Write, range: &str, body: &[u8]) {
        let headers = format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Range: {range}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(headers.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
    }

    #[test]
    fn consecutive_seeks_are_coalesced_until_read() {
        let server = MockServer::start();
        let data = payload(4096);
        let initial_data = data.clone();
        let seek_data = data.clone();
        let initial = server.mock(move |when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-4095/4096")
                .body(initial_data);
        });
        let seek = server.mock(move |when, then| {
            when.method(GET)
                .path("/audio")
                .header("range", "bytes=2048-");
            then.status(206)
                .header("Content-Range", "bytes 2048-4095/4096")
                .body(&seek_data[2048..]);
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        source.seek(SeekFrom::Start(1024)).unwrap();
        source.seek(SeekFrom::Start(2048)).unwrap();
        initial.assert_hits(1);
        seek.assert_hits(0);

        let mut output = [0_u8; 16];
        source.read_exact(&mut output).unwrap();
        seek.assert_hits(1);
        assert_eq!(output, data[2048..2064]);
    }

    #[test]
    fn interrupt_can_be_reset_for_seek() {
        let server = MockServer::start();
        let data = payload(1024);
        let initial_data = data.clone();
        let seek_data = data.clone();
        server.mock(move |when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-1023/1024")
                .body(initial_data);
        });
        server.mock(move |when, then| {
            when.method(GET)
                .path("/audio")
                .header("range", "bytes=512-");
            then.status(206)
                .header("Content-Range", "bytes 512-1023/1024")
                .body(&seek_data[512..]);
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        let interrupt = source.interrupt_handle();
        interrupt.cancel();
        assert_eq!(
            source.read(&mut [0_u8; 1]).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );

        interrupt.reset();
        source.seek(SeekFrom::Start(512)).unwrap();
        let mut output = [0_u8; 16];
        source.read_exact(&mut output).unwrap();
        assert_eq!(output, data[512..528]);
    }

    #[test]
    fn probe_rejects_response_without_range_support() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(200).body(payload(128));
        });

        assert!(HttpRangeSource::new(server.url("/audio")).is_err());
    }

    #[test]
    fn premature_eof_resumes_from_current_position() {
        let server = MockServer::start();
        let data = payload(1024);
        let first_data = data[..128].to_vec();
        let resumed_data = data[128..].to_vec();
        let initial = server.mock(move |when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-127/1024")
                .body(first_data);
        });
        let resumed = server.mock(move |when, then| {
            when.method(GET)
                .path("/audio")
                .header("range", "bytes=128-");
            then.status(206)
                .header("Content-Range", "bytes 128-1023/1024")
                .body(resumed_data);
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        let mut output = vec![0_u8; 256];
        source.read_exact(&mut output).unwrap();

        initial.assert_hits(1);
        resumed.assert_hits(1);
        assert_eq!(output, data[..256]);
    }

    #[test]
    fn repeated_premature_eof_recovers_before_failure_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let data = payload(1024);
        let server_data = data.clone();
        let server = std::thread::spawn(move || {
            for request_index in 0..4 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 1024];
                let _ = stream.read(&mut request).unwrap();
                match request_index {
                    0 => write_range_response(&mut stream, "bytes 0-63/1024", &server_data[..64]),
                    1 | 2 => write_range_response(&mut stream, "bytes 64-1023/1024", &[]),
                    _ => {
                        write_range_response(&mut stream, "bytes 64-1023/1024", &server_data[64..])
                    }
                }
            }
        });

        let mut source = HttpRangeSource::new(format!("http://{address}/audio")).unwrap();
        let mut output = vec![0_u8; 128];
        source.read_exact(&mut output).unwrap();

        server.join().unwrap();
        assert_eq!(output, data[..128]);
    }

    #[test]
    fn read_rejects_wrong_range_start() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-1023/1024")
                .body(payload(1024));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/audio")
                .header("range", "bytes=512-");
            then.status(206)
                .header("Content-Range", "bytes 500-1023/1024")
                .body(payload(524));
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        source.seek(SeekFrom::Start(512)).unwrap();
        assert!(source.read(&mut [0_u8; 1]).is_err());
    }

    #[test]
    fn read_rejects_changed_remote_size() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-1023/1024")
                .body(payload(1024));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/audio")
                .header("range", "bytes=512-");
            then.status(206)
                .header("Content-Range", "bytes 512-2047/2048")
                .body(payload(1536));
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        source.seek(SeekFrom::Start(512)).unwrap();
        assert!(source.read(&mut [0_u8; 1]).is_err());
    }

    #[test]
    fn seek_supports_all_origins_and_checks_underflow() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/audio").header("range", "bytes=0-");
            then.status(206)
                .header("Content-Range", "bytes 0-1023/1024")
                .body(payload(1024));
        });

        let mut source = HttpRangeSource::new(server.url("/audio")).unwrap();
        assert_eq!(source.seek(SeekFrom::Start(100)).unwrap(), 100);
        assert_eq!(source.seek(SeekFrom::Current(-40)).unwrap(), 60);
        assert_eq!(source.seek(SeekFrom::End(-24)).unwrap(), 1000);
        assert_eq!(
            source.seek(SeekFrom::Current(-1001)).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        assert_eq!(source.seek(SeekFrom::Start(2048)).unwrap(), 2048);
        assert_eq!(source.read(&mut [0_u8; 1]).unwrap(), 0);
    }

    #[test]
    fn content_range_parser_rejects_malformed_values() {
        assert_eq!(parse_content_range("bytes 12-34/100"), Some((12, 34, 100)));
        assert_eq!(parse_content_range("12-34/100"), None);
        assert_eq!(parse_content_range("bytes */100"), None);
        assert_eq!(parse_content_range("bytes 12-x/100"), None);
    }
}
