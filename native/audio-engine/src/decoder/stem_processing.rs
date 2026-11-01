use crate::dsp::{equalizer::Equalizer, tempo::StretchProcessor};

/// 四路声部独立处理后重组，避免变速后的完整混音与人声相减留下相位残差
pub(super) struct StemProcessors {
    equalizers: [Equalizer; 4],
    tempos: [StretchProcessor; 4],
    scratch: [Vec<f32>; 4],
    pub mix: Vec<f32>,
    initialized: bool,
    rate: f32,
}

impl StemProcessors {
    /// 为有限窗口建立与原曲相同格式的处理器
    /// @param sample_rate - 输出采样率
    /// @param channels - 输出声道数
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        Self {
            equalizers: std::array::from_fn(|_| Equalizer::new(sample_rate, channels)),
            tempos: std::array::from_fn(|_| StretchProcessor::new(channels, sample_rate)),
            scratch: std::array::from_fn(|_| Vec::new()),
            rate: 1.0,
            mix: Vec::new(),
            initialized: false,
        }
    }

    /// 在原曲同一组参数锁内处理声部，避免变速和均衡器更新导致错位
    /// @param stems - 鼓、贝斯和人声的当前块
    /// @param original - 同一块已做响度处理的完整混音
    /// @param equalizer - 原曲均衡器参数
    /// @param tempo - 原曲变速参数
    pub fn process(
        &mut self,
        stems: &mut [Vec<f32>; 3],
        original: &[f32],
        equalizer: &Equalizer,
        tempo: &StretchProcessor,
    ) {
        let rate = tempo.automix_rate();
        if !self.initialized {
            self.equalizers[3] = equalizer.clone();
            self.initialized = true;
        }
        self.mix.clear();
        self.mix.extend(
            original
                .iter()
                .enumerate()
                .map(|(index, sample)| sample - stems.iter().map(|stem| stem[index]).sum::<f32>()),
        );
        for (index, samples) in stems
            .iter_mut()
            .chain(std::iter::once(&mut self.mix))
            .enumerate()
        {
            let eq = &mut self.equalizers[index];
            eq.set_enabled(equalizer.enabled());
            if eq.band_gains_db() != equalizer.band_gains_db() {
                eq.set_band_gains(&equalizer.band_gains_db());
            }
            if eq.preamp_db() != equalizer.preamp_db() {
                eq.set_preamp_db(equalizer.preamp_db());
            }
            if eq.enabled() {
                eq.process_interleaved(samples);
            }
            let processor = &mut self.tempos[index];
            if processor.speed() != tempo.speed() {
                processor.set_speed(tempo.speed());
            }
            if processor.pitch() != tempo.pitch() {
                processor.set_pitch(tempo.pitch());
            }
            if processor.pitch_sync() != tempo.pitch_sync() {
                processor.set_pitch_sync(tempo.pitch_sync());
            }
            if rate != self.rate {
                processor.set_automix_rate(rate);
            }
            if !processor.is_bypass() {
                self.scratch[index].clear();
                processor.process(samples, &mut self.scratch[index]);
                std::mem::swap(samples, &mut self.scratch[index]);
            }
        }
        for (index, sample) in self.mix.iter_mut().enumerate() {
            *sample += stems.iter().map(|stem| stem[index]).sum::<f32>();
        }
        self.rate = rate;
    }

    /// 排空与主路同样的变速尾音，保持最后一块采样对齐
    /// @returns 三路剩余的有效音频
    pub fn flush(&mut self) -> Box<[Vec<f32>; 3]> {
        let [drums, bass, vocals, mut other] = std::array::from_fn(|index| {
            let mut samples = Vec::new();
            self.tempos[index].flush_automix(&mut samples);
            samples
        });
        for (index, sample) in other.iter_mut().enumerate() {
            *sample += drums[index] + bass[index] + vocals[index];
        }
        self.mix = other;
        Box::new([drums, bass, vocals])
    }
}
