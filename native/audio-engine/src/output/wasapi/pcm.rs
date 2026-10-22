use super::*;

/// f32 → 整型样本转换（应用音量增益后写入）
pub(super) fn convert_sample(sample: f32, gain: f32, valid_bits: u16) -> i32 {
    let clamped = (sample * gain).clamp(-1.0, 1.0);
    match valid_bits {
        16 => (clamped * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i32,
        24 => {
            ((clamped * 8_388_608.0)
                .round()
                .clamp(-8_388_608.0, 8_388_607.0) as i32)
                << 8
        }
        _ => (clamped * 2_147_483_648.0).round() as i32,
    }
}

/// 将渲染缓冲按有效位深填充（交错样本，静音时填零）
pub(super) fn fill_buffer(
    buffer: &mut [u8],
    source: &mut DecoderSource,
    gain: f32,
    silent: bool,
    format: &ExclusiveFormat,
) {
    let bytes_per_sample = usize::from(format.container_bits / 8);
    source.begin_callback();
    let mut raw = [0u8; 4];
    for chunk in buffer.chunks_exact_mut(bytes_per_sample) {
        let value = if silent {
            0
        } else {
            convert_sample(source.next().unwrap_or(0.0), gain, format.valid_bits)
        };
        raw[..bytes_per_sample].copy_from_slice(&value.to_le_bytes()[..bytes_per_sample]);
        chunk.copy_from_slice(&raw[..bytes_per_sample]);
    }
}

#[cfg(test)]
#[path = "tests/pcm.rs"]
mod tests;
