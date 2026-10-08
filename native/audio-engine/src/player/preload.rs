use super::*;
use crate::decoder::buffer::Shared;
use crate::metadata::AudioMetadata;

/// 预载槽只持有解码器和有界 PCM 队列，不创建输出流
pub struct PreparedPlayback {
    pub(crate) id: String,
    pub(crate) source: String,
    pub(crate) config: PreloadConfig,
    pub(crate) start_position: f64,
    pub(crate) metadata: AudioMetadata,
    pub(crate) shared: Arc<Shared>,
    pub(crate) decoder: Option<JoinHandle<decoder::DecoderData>>,
    pub(crate) cancel: Option<HttpCancelHandle>,
    pub(crate) equalizer: Arc<Mutex<Equalizer>>,
    pub(crate) tempo: Arc<Mutex<StretchProcessor>>,
}

impl Drop for PreparedPlayback {
    fn drop(&mut self) {
        if self.decoder.is_some() {
            self.shared.stop();
        }
    }
}

/// 预载时的输出与音效快照，用于校验备用 PCM 是否仍可复用
#[derive(Clone, PartialEq)]
pub(crate) struct PreloadConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub normalization: bool,
    pub eq_enabled: bool,
    pub bands: [f32; EQ_BAND_COUNT],
    pub preamp: f32,
    pub speed: f32,
    pub pitch: i8,
    pub pitch_sync: bool,
}

/// 当前预载代次的取消信号及已经就绪的备用资源
#[derive(Default)]
pub(crate) struct PreloadSlot {
    pub id: Option<String>,
    pub cancelled: Option<Arc<AtomicBool>>,
    pub ready: Option<PreparedPlayback>,
}

impl PreloadSlot {
    /// 取消在途准备任务并释放就绪资源，不停止当前播放
    pub fn clear(&mut self) {
        if let Some(cancelled) = self.cancelled.take() {
            cancelled.store(true, Ordering::Release);
        }
        self.ready = None;
        self.id = None;
    }
}

impl Drop for PreloadSlot {
    fn drop(&mut self) {
        self.clear();
    }
}

impl InnerPlayer {
    /// 获取当前输出和音效参数，未打开设备时使用默认输出格式
    pub(crate) fn preload_config(&self) -> PreloadConfig {
        PreloadConfig {
            sample_rate: self
                .output
                .as_ref()
                .map_or(decoder::DEFAULT_TARGET_SAMPLE_RATE, |output| {
                    output.sample_rate()
                }),
            channels: self
                .output
                .as_ref()
                .map_or(decoder::DEFAULT_OUTPUT_CHANNELS, |output| output.channels()),
            normalization: self.normalization_enabled,
            eq_enabled: self.equalizer_enabled(),
            bands: self.equalizer_bands(),
            preamp: self.preamp_gain(),
            speed: self.speed(),
            pitch: self.pitch(),
            pitch_sync: self.pitch_sync(),
        }
    }

    /// 取出标识、音源与配置均匹配的备用资源，同时使其他预载失效
    pub(crate) fn take_prepared(
        &mut self,
        id: Option<&str>,
        source: &str,
    ) -> Option<PreparedPlayback> {
        let prepared = self.preload.ready.take().filter(|ready| {
            Some(ready.id.as_str()) == id
                && ready.source == source
                && ready.config == self.preload_config()
        });
        self.preload.clear();
        prepared
    }

    /// 接管备用槽位的 DSP 状态，并保留开流期间用户更新的参数
    pub(crate) fn replace_dsp(
        &mut self,
        equalizer: Arc<Mutex<Equalizer>>,
        tempo: Arc<Mutex<StretchProcessor>>,
    ) {
        // 开流期间仍允许用户调整音效；保留最新参数，不覆盖为预载时的快照
        if !Arc::ptr_eq(&self.equalizer, &equalizer) {
            let config = self.preload_config();
            let mut next = equalizer.lock();
            next.set_enabled(config.eq_enabled);
            if next.band_gains_db() != config.bands {
                next.set_band_gains(&config.bands);
            }
            if next.preamp_db() != config.preamp {
                next.set_preamp_db(config.preamp);
            }
            let mut next = tempo.lock();
            if next.speed() != config.speed {
                next.set_speed(config.speed);
            }
            if next.pitch() != config.pitch {
                next.set_pitch(config.pitch);
            }
            if next.pitch_sync() != config.pitch_sync {
                next.set_pitch_sync(config.pitch_sync);
            }
        }
        self.equalizer = equalizer;
        self.tempo = tempo;
    }
}
