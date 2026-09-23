use super::*;

#[test]
fn pcm16_roundtrip_preserves_every_sample_at_unity_gain() {
    for sample in i16::MIN..=i16::MAX {
        assert_eq!(
            convert_sample(f32::from(sample) / 32_768.0, 1.0, 16),
            i32::from(sample)
        );
    }
}

#[test]
fn pcm24_roundtrip_preserves_every_sample_at_unity_gain() {
    for sample in -8_388_608..=8_388_607 {
        assert_eq!(
            convert_sample(sample as f32 / 8_388_608.0, 1.0, 24),
            sample << 8
        );
    }
}

#[test]
fn pcm_conversion_clips_without_wrapping_and_applies_gain() {
    for (bits, min, max) in [
        (16, -32_768, 32_767),
        (24, i32::MIN, 0x7FFFFF00),
        (32, i32::MIN, i32::MAX),
    ] {
        assert_eq!(convert_sample(-2.0, 1.0, bits), min);
        assert_eq!(convert_sample(2.0, 1.0, bits), max);
        assert_eq!(convert_sample(1.0, 0.0, bits), 0);
    }
    assert_eq!(convert_sample(0.5, 0.5, 16), 8192);
    assert_eq!(convert_sample(-0.5, 0.5, 24), -2_097_152 << 8);
}
