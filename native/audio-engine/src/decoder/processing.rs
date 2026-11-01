use super::stem_processing::StemProcessors;
use super::*;
use crate::dsp::limiter::OutputLimiter;

struct DspState {
    limiter: OutputLimiter,
    scratch: Vec<f32>,
    stems: Option<StemProcessors>,
}

impl DspState {
    /// 复用当前会话的缓冲和声部处理状态
    /// @param scratch - 从有限缓冲池取得的临时音频
    fn new(scratch: Vec<f32>) -> Self {
        Self {
            limiter: OutputLimiter::new(),
            scratch,
            stems: None,
        }
    }
}

/// 在后台应用用户音效与有限变速，保留有效音频的源时间映射
/// @param chunk - 解码后的音频块
/// @param equalizer - 用户均衡器
/// @param tempo - 用户和自动混音使用的变速处理器
/// @param state - 单路保护、复用缓冲及声部处理器
/// @param channels - 输出声道数
/// @param normalization_enabled - 是否启用响度归一化
/// @returns 已处理且源计数准确的音频块
fn process_audio_chunk(
    mut chunk: AudioChunk,
    equalizer: &Mutex<Equalizer>,
    tempo: &Mutex<StretchProcessor>,
    state: &mut DspState,
    channels: u16,
    normalization_enabled: bool,
) -> AudioChunk {
    if chunk.player_samples.is_empty() {
        return chunk;
    }

    let mut eq = equalizer.lock();
    let mut tempo = tempo.lock();
    if let Some(samples) = &mut chunk.stem_samples {
        // 输出格式在会话创建后保持不变
        state.stems.as_mut().expect("声部处理器尚未初始化").process(
            samples,
            &chunk.player_samples,
            &eq,
            &tempo,
        );
    }
    let eq_enabled = eq.enabled();
    if eq_enabled {
        eq.process_interleaved(&mut chunk.player_samples);
    }
    drop(eq);

    let stretched = !tempo.is_bypass();
    if stretched {
        state.scratch.clear();
        chunk.source_sample_count = tempo.process(&chunk.player_samples, &mut state.scratch);
        std::mem::swap(&mut chunk.player_samples, &mut state.scratch);
    }
    if let Some(stems) = &mut state.stems {
        std::mem::swap(&mut chunk.player_samples, &mut stems.mix);
    }
    // 无均衡、变速或响度处理时保留满幅母带，声部重组不额外启用限幅
    if stretched || eq_enabled || normalization_enabled {
        state.limiter.process(
            &mut chunk.player_samples,
            channels,
            chunk.stem_samples.as_deref_mut(),
        );
    }
    chunk
}

/// 持续消费解码音频，正常结束时排空自动变速尾音
/// @param shared - 解码与输出之间的有界队列
/// @param equalizer - 用户均衡器
/// @param tempo - 当前路的变速处理器
fn run_dsp_loop(shared: &Shared, equalizer: &Mutex<Equalizer>, tempo: &Mutex<StretchProcessor>) {
    let mut state = DspState::new(shared.take_player_buffer());
    let mut source_samples = 0_u64;
    while let Some(mut chunk) = shared.pop_decoded() {
        if let Some(window) = shared.stems() {
            chunk.stem_samples = window.read(
                source_samples,
                chunk.player_samples.len(),
                shared.sample_rate(),
                shared.channels(),
            );
            if window.finished(source_samples, shared.sample_rate(), shared.channels()) {
                shared.set_stems(None);
            }
            if let Some(samples) = &mut chunk.stem_samples {
                let gain = chunk.normalization_gain;
                samples
                    .iter_mut()
                    .flatten()
                    .for_each(|sample| *sample *= gain);
            }
        }
        source_samples += chunk.source_sample_count;
        if chunk.stem_samples.is_none() {
            state.stems = None;
        } else if state.stems.is_none() {
            state.stems = Some(StemProcessors::new(shared.sample_rate(), shared.channels()));
        }
        let chunk = process_audio_chunk(
            chunk,
            equalizer,
            tempo,
            &mut state,
            shared.channels(),
            shared.is_normalization_enabled(),
        );
        shared.push_output(chunk);
        if shared.is_stopping() {
            break;
        }
    }
    if !shared.is_stopping() {
        state.scratch.clear();
        let source_sample_count = tempo.lock().flush_automix(&mut state.scratch);
        if !state.scratch.is_empty() {
            let mut stem_samples = state.stems.as_mut().map(|stems| {
                let samples = stems.flush();
                std::mem::swap(&mut state.scratch, &mut stems.mix);
                samples
            });
            state.limiter.process(
                &mut state.scratch,
                shared.channels(),
                stem_samples.as_deref_mut(),
            );
            shared.push_output(AudioChunk {
                normalization_gain: 1.0,
                stem_samples,
                player_samples: std::mem::take(&mut state.scratch),
                fft_samples: Vec::new(),
                source_sample_count,
            });
        }
    }
    shared.recycle_player_buffer(state.scratch);
}

pub(super) fn run_dsp_safely(
    shared: Arc<Shared>,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_dsp_loop(&shared, &equalizer, &tempo);
    }));
    if result.is_err() {
        shared.mark_decode_failed();
    }
    shared.mark_output_eof();
}

#[cfg(test)]
#[path = "tests/processing.rs"]
mod tests;
