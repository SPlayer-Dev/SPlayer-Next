//! 把 HTTP/HTTPS 资源伪装成 Read + Seek 流喂给 ffmpeg_audio
//!
//! 通过 Range 请求按需拉数据，TLS 走 rustls（webpki-roots），跨平台无系统依赖
//! 内置 cancellation flag：drop 即停的同时，外部可拿 `cancel_handle()` 注入到 shared，
//! 让 player.stop() 能让阻塞中的 read 立即返回 Interrupted，触发 ffmpeg 退出解码循环
//!
//! 一次 GET 预拉 `PREFETCH_SIZE`（512KB）放入内部 buffer，ffmpeg 的 32KB AVIO 回调

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tracing::warn;

/// HTTP 读写超时
const HTTP_TIMEOUT_SECS: u64 = 15;
/// User-Agent，部分 CDN 会拒绝默认的 ureq UA
const USER_AGENT: &str = "SPlayer-Next/1.0";
/// 单次预拉块大小：太大首次 load 等首字节时间长，太小回到 GET 数过多
/// 128KB 是甜点：5Mbps 下 ~200ms 下完，5MB 歌总 GET 数 ~40 次，rodio 缓冲完全吸收
const PREFETCH_SIZE: usize = 128 * 1024;
/// 每次 fetch 失败重试次数（首次失败 + 2 次重试 = 3 次尝试）
const FETCH_RETRIES: u32 = 2;
/// 重试间隔（毫秒）
const RETRY_DELAY_MS: u64 = 500;
/// fetch_chunk_once 内部的读取缓冲块
const READ_CHUNK_SIZE: usize = 16 * 1024;

pub struct HttpRangeSource {
    url: String,
    agent: ureq::Agent,
    total_size: u64,
    pos: u64,
    /// 预读 buffer：对应文件 [buf_start, buf_start + buf_data.len())
    buf_start: u64,
    buf_data: Vec<u8>,
    cancel: Arc<AtomicBool>,
}

impl HttpRangeSource {
    pub fn new(url: impl Into<String>) -> Result<Self> {
        let url = url.into();
        let agent: ureq::Agent = ureq::AgentBuilder::new()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build();

        let resp = agent
            .head(&url)
            .call()
            .with_context(|| format!("HEAD 请求失败: {url}"))?;

        let total_size: u64 = resp
            .header("Content-Length")
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| anyhow!("响应缺少 Content-Length，无法做 seekable 流: {url}"))?;

        Ok(Self {
            url,
            agent,
            total_size,
            pos: 0,
            buf_start: 0,
            buf_data: Vec::new(),
            cancel: Arc::new(AtomicBool::new(false)),
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

    /// 当前 pos 是否落在已缓存的 buffer 内
    fn buf_contains_pos(&self) -> bool {
        !self.buf_data.is_empty()
            && self.pos >= self.buf_start
            && self.pos < self.buf_start + self.buf_data.len() as u64
    }

    /// 从 pos 开始拉一个 chunk 到 buf_data，失败时按 RETRY_DELAY_MS 间隔重试
    fn fetch_chunk(&mut self) -> io::Result<()> {
        let remaining = self.total_size.saturating_sub(self.pos);
        if remaining == 0 {
            self.buf_start = self.pos;
            self.buf_data.clear();
            return Ok(());
        }
        let chunk_size = (PREFETCH_SIZE as u64).min(remaining) as usize;
        let last = self.pos + chunk_size as u64 - 1;
        let range = format!("bytes={}-{}", self.pos, last);

        let mut last_err: Option<io::Error> = None;
        for attempt in 0..=FETCH_RETRIES {
            self.check_cancel()?;
            if attempt > 0 {
                // sleep 期间分多段 check cancel，避免 stop 后还要等 500ms
                for _ in 0..(RETRY_DELAY_MS / 50) {
                    std::thread::sleep(Duration::from_millis(50));
                    self.check_cancel()?;
                }
            }
            match self.fetch_chunk_once(&range, chunk_size) {
                Ok(data) => {
                    self.buf_start = self.pos;
                    self.buf_data = data;
                    return Ok(());
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => return Err(e),
                Err(e) if attempt < FETCH_RETRIES => {
                    warn!(
                        error = %e,
                        attempt = attempt + 1,
                        range = %range,
                        "HTTP fetch 失败，将重试"
                    );
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap_or_else(|| io::Error::other("fetch failed")))
    }

    fn fetch_chunk_once(&self, range: &str, expected: usize) -> io::Result<Vec<u8>> {
        let resp = self
            .agent
            .get(&self.url)
            .set("Range", range)
            .call()
            .map_err(|e| io::Error::other(format!("GET Range 失败: {e}")))?;

        let mut reader = resp.into_reader();
        let mut data = Vec::with_capacity(expected);
        let mut chunk = [0u8; READ_CHUNK_SIZE];

        while data.len() < expected {
            self.check_cancel()?;
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let want = (expected - data.len()).min(n);
                    data.extend_from_slice(&chunk[..want]);
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }

        if data.is_empty() {
            return Err(io::Error::other("response body empty"));
        }
        Ok(data)
    }
}

impl Read for HttpRangeSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.check_cancel()?;
        if self.pos >= self.total_size || buf.is_empty() {
            return Ok(0);
        }

        if !self.buf_contains_pos() {
            self.fetch_chunk()?;
        }

        // fetch_chunk 后理论上必定 contains_pos；保险加 defensive 检查
        if !self.buf_contains_pos() {
            return Ok(0);
        }

        let offset = (self.pos - self.buf_start) as usize;
        let available = self.buf_data.len() - offset;
        let n = buf.len().min(available);
        buf[..n].copy_from_slice(&self.buf_data[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
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
                    self.total_size.saturating_sub((-o) as u64)
                }
            }
            SeekFrom::Current(o) => {
                if o >= 0 {
                    self.pos.saturating_add(o as u64)
                } else {
                    self.pos.saturating_sub((-o) as u64)
                }
            }
        };
        // 不主动清 buffer：seek 命中 buffer 是 bonus（小距离前后跳），
        // 跳出 buffer 时下次 read 自然触发 fetch_chunk 覆盖
        self.pos = new_pos;
        Ok(new_pos)
    }
}

/// 判断 source 字符串是否是 http/https URL
pub fn is_network_source(source: &str) -> bool {
    source.starts_with("http://") || source.starts_with("https://")
}
