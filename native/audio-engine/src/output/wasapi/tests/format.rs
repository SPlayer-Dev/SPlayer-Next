use super::*;

#[test]
fn exclusive_format_describes_all_eight_channels() {
    let wave = build_wave_format(&ExclusiveFormat {
        sample_rate: 48_000,
        channels: 8,
        container_bits: 32,
        valid_bits: 24,
    });
    let mask = wave.dwChannelMask;
    let size = wave.Format.cbSize;
    let align = wave.Format.nBlockAlign;
    assert_eq!(mask.count_ones(), 8);
    assert_eq!(size, 22);
    assert_eq!(align, 32);
}

#[test]
fn packed_24bit_format_uses_three_byte_block_align() {
    let wave = build_wave_format(&ExclusiveFormat {
        sample_rate: 44_100,
        channels: 2,
        container_bits: 24,
        valid_bits: 24,
    });
    // packed 字段先拷贝到局部变量再断言；Samples 是 union，读取字段需要 unsafe
    let bits = wave.Format.wBitsPerSample;
    let align = wave.Format.nBlockAlign;
    let avg = wave.Format.nAvgBytesPerSec;
    let valid = unsafe { wave.Samples.wValidBitsPerSample };
    assert_eq!(bits, 24);
    assert_eq!(align, 6);
    assert_eq!(avg, 44_100 * 6);
    assert_eq!(valid, 24);
}

#[test]
fn bit_depth_candidates_cover_packed_and_extended_device_formats() {
    assert_eq!(valid_bits_candidates(16), vec![16, 24, 32]);
    assert_eq!(valid_bits_candidates(24), vec![24, 32, 16]);
    assert_eq!(valid_bits_candidates(32), vec![32, 24, 16]);
    assert_eq!(container_candidates(16), vec![16]);
    assert_eq!(container_candidates(24), vec![32, 24]);
    assert_eq!(container_candidates(32), vec![32]);
}
