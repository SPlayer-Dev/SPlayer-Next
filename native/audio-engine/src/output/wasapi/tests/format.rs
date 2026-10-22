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
