use super::*;
use crate::decoder::buffer::Shared;
use crate::dsp::{equalizer::Equalizer, tempo::StretchProcessor};
use crate::player::preload::{PreloadConfig, PreparedPlayback};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// 在后台准备下一曲，并在主线程按代次提交备用槽位
pub struct PrepareNextTask {
    inner: Arc<Mutex<InnerPlayer>>,
    id: String,
    source: String,
    start_position: f64,
    config: PreloadConfig,
    cover_dir: Option<String>,
    cancelled: Arc<AtomicBool>,
}

impl Task for PrepareNextTask {
    type Output = Option<PreparedPlayback>;
    type JsValue = bool;

    /// 执行文件读取与解码，取消时释放尚未提交的备用资源
    fn compute(&mut self) -> Result<Self::Output> {
        (|| -> anyhow::Result<Self::Output> {
            if self.cancelled.load(Ordering::Acquire) {
                return Ok(None);
            }
            let mut prepared = decoder::prepare_decode(
                &self.source,
                self.cover_dir.as_deref(),
                HttpCancelHandle::new(),
            )?;
            if self.cancelled.load(Ordering::Acquire) {
                return Ok(None);
            }
            prepared.seek_start(self.start_position)?;
            let config = &self.config;
            let shared = Shared::new(config.sample_rate, config.channels);
            shared.set_preloading(true);
            shared.set_normalization_enabled(config.normalization);
            let mut equalizer = Equalizer::new(config.sample_rate, config.channels);
            equalizer.set_enabled(config.eq_enabled);
            equalizer.set_band_gains(&config.bands);
            equalizer.set_preamp_db(config.preamp);
            let mut tempo = StretchProcessor::new(config.channels, config.sample_rate);
            tempo.set_speed(config.speed);
            tempo.set_pitch(config.pitch);
            tempo.set_pitch_sync(config.pitch_sync);
            let equalizer = Arc::new(Mutex::new(equalizer));
            let tempo = Arc::new(Mutex::new(tempo));
            let (metadata, decoder, cancel) = decoder::start_prepared_decode(
                prepared,
                Arc::clone(&shared),
                Arc::clone(&equalizer),
                Arc::clone(&tempo),
            )?;
            let ready = PreparedPlayback {
                id: self.id.clone(),
                source: self.source.clone(),
                config: config.clone(),
                start_position: self.start_position,
                metadata,
                shared,
                decoder: Some(decoder),
                cancel,
                equalizer,
                tempo,
            };
            loop {
                if self.cancelled.load(Ordering::Acquire) {
                    return Ok(None);
                }
                anyhow::ensure!(!ready.shared.is_decode_failed(), "预载音频解码失败");
                if ready.shared.output_ready() {
                    return Ok(Some(ready));
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        })()
        .into_napi()
    }

    /// 仅提交仍有效的预载代次，过期资源随返回值丢弃而释放
    fn resolve(&mut self, _env: Env, ready: Self::Output) -> Result<Self::JsValue> {
        let Some(ready) = ready else {
            return Ok(false);
        };
        let mut player = self.inner.lock();
        if self.cancelled.load(Ordering::Acquire) || player.preload.id.as_deref() != Some(&ready.id)
        {
            return Ok(false);
        }
        player.preload.ready = Some(ready);
        Ok(true)
    }
}

#[napi]
impl AudioPlayer {
    /// 在独立槽位中打开本地文件并提前解码，不改变当前歌曲或占用第二条输出流
    /// @param id - 用于取消和消费预载资源的任务标识
    /// @param source - 本地音频文件或已完成下载的缓存文件路径
    /// @param startPosition - 预载起点，单位为秒，默认为 0
    /// @returns 当前任务仍有效且音频已准备就绪时返回 true，否则返回 false
    #[napi(ts_return_type = "Promise<boolean>")]
    pub fn prepare_next(
        &self,
        id: String,
        source: String,
        start_position: Option<f64>,
    ) -> Result<AsyncTask<PrepareNextTask>> {
        if source.starts_with("http://") || source.starts_with("https://") {
            return Err(Error::from_reason("预载音频必须先完成本地缓存"));
        }
        let start_position = start_position.unwrap_or(0.0);
        if !start_position.is_finite() || start_position < 0.0 {
            return Err(Error::from_reason("预载起点必须是有限的非负秒数"));
        }
        // 在 JS 调用栈内登记代次，保证紧接着的 stop/cancel 不会早于任务注册
        let mut player = self.inner.lock();
        player.preload.clear();
        let cancelled = Arc::new(AtomicBool::new(false));
        player.preload.id = Some(id.clone());
        player.preload.cancelled = Some(Arc::clone(&cancelled));
        Ok(AsyncTask::new(PrepareNextTask {
            inner: Arc::clone(&self.inner),
            id,
            source,
            start_position,
            config: player.preload_config(),
            cover_dir: player.cover_cache_dir().map(String::from),
            cancelled,
        }))
    }

    /// 仅取消指定预载代次，避免迟到的取消操作清除新的下一曲
    /// @param id - 要取消的预载任务标识
    #[napi]
    pub fn cancel_prepared(&self, id: String) {
        let mut player = self.inner.lock();
        if player.preload.id.as_deref() == Some(&id) {
            player.preload.clear();
        }
    }
}
