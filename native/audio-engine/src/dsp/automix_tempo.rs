use signalsmith_stretch::Stretch;

/// AutoMix 专用的有限变速流，预热与排空均不计入用户播放速度
pub(super) struct AutoMixStretch {
    stretch: Stretch,
    channels: usize,
    pub(super) rate: f64,
    priming: Vec<f32>,
    primed: bool,
    preroll: usize,
    scratch: Vec<f32>,
    frame_fraction: f64,
    source_fraction: f64,
    pending_source: u64,
    pub finishing: bool,
}

impl AutoMixStretch {
    /// 创建只用于正常速度和音调的保音调变速器
    /// @param channels - 输出声道数
    /// @param sample_rate - 输出采样率
    /// @param rate - 过渡使用的自动倍率
    pub fn new(channels: u16, sample_rate: u32, rate: f32) -> Self {
        let stretch = Stretch::preset_default(u32::from(channels), sample_rate);
        let preroll = stretch.output_latency();
        Self {
            stretch,
            channels: usize::from(channels),
            rate: f64::from(rate),
            priming: Vec::new(),
            primed: false,
            preroll,
            scratch: Vec::new(),
            frame_fraction: 0.0,
            source_fraction: 0.0,
            pending_source: 0,
            finishing: false,
        }
    }

    /// 先使用真实前视样本预热，再丢弃算法预卷，输出对应的真实源采样计数
    /// @param input - 均衡器处理后的交错采样
    /// @param output - 接收有效变速音频的复用缓冲
    /// @returns 本次输出覆盖的源交错采样数
    pub fn process(&mut self, input: &[f32], output: &mut Vec<f32>) -> u64 {
        self.pending_source += input.len() as u64;
        let input = if self.primed {
            input
        } else {
            self.priming.extend_from_slice(input);
            let latency = self.stretch.input_latency() * self.channels;
            if self.priming.len() < latency {
                return 0;
            }
            self.stretch.seek(&self.priming[..latency], self.rate);
            self.primed = true;
            &self.priming[latency..]
        };
        let exact_frames =
            input.len() as f64 / self.channels as f64 / self.rate + self.frame_fraction;
        let frames = exact_frames.floor() as usize;
        self.frame_fraction = exact_frames - frames as f64;
        self.scratch.resize(frames * self.channels, 0.0);
        if frames > 0 {
            self.stretch.process(input, &mut self.scratch);
        }
        self.priming.clear();
        let discard = self.preroll.min(frames);
        self.preroll -= discard;
        output.extend_from_slice(&self.scratch[discard * self.channels..]);
        let source_frames = (frames - discard) as f64 * self.rate + self.source_fraction;
        let consumed =
            ((source_frames.floor() as u64) * self.channels as u64).min(self.pending_source);
        self.source_fraction = source_frames - source_frames.floor();
        self.pending_source -= consumed;
        consumed
    }

    /// 排出算法仍持有的真实尾音，合成补零不推进源位置
    /// @param output - 接收剩余有效音频的缓冲
    /// @returns 尚未计入播放位置的源交错采样数
    pub fn flush(&mut self, output: &mut Vec<f32>) -> u64 {
        let pending = self.pending_source;
        if !self.primed {
            output.extend_from_slice(&self.priming);
            self.priming.clear();
            self.pending_source = 0;
            return pending;
        }
        if pending == 0 {
            return 0;
        }
        let zero = vec![0.0; self.stretch.input_latency() * self.channels];
        let frames = (self.stretch.input_latency() as f64 / self.rate).ceil() as usize;
        self.scratch.resize(frames * self.channels, 0.0);
        self.stretch.process(&zero, &mut self.scratch);
        let mut tail = std::mem::take(&mut self.scratch);
        let offset = tail.len();
        tail.resize(offset + self.stretch.output_latency() * self.channels, 0.0);
        self.stretch.flush(&mut tail[offset..]);
        let discard = self.preroll.min(tail.len() / self.channels) * self.channels;
        let wanted =
            ((pending as f64 / self.channels as f64 / self.rate).round() as usize) * self.channels;
        output.extend_from_slice(&tail[discard..(discard + wanted).min(tail.len())]);
        self.pending_source = 0;
        pending
    }
}
