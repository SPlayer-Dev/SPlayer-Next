use super::*;
use crate::decoder::buffer::{AudioChunk, Shared};
use crate::dsp::fft::FftAnalyzer;
use std::sync::Arc;

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
        assert_eq!(convert_sample(sample as f32 / 8_388_608.0, 1.0, 24), sample);
    }
}

#[test]
fn pcm_conversion_clips_without_wrapping_and_applies_gain() {
    for (bits, min, max) in [
        (16, -32_768, 32_767),
        (24, -8_388_608, 8_388_607),
        (32, i32::MIN, i32::MAX),
    ] {
        assert_eq!(convert_sample(-2.0, 1.0, bits), min);
        assert_eq!(convert_sample(2.0, 1.0, bits), max);
        assert_eq!(convert_sample(1.0, 0.0, bits), 0);
    }
    assert_eq!(convert_sample(0.5, 0.5, 16), 8192);
    assert_eq!(convert_sample(-0.5, 0.5, 24), -2_097_152);
}

/// 有效位深写入容器时保持在高位，打包 24bit 三个字节即完整样本
#[test]
fn fill_buffer_places_valid_bits_in_the_container_high_bits() {
    for (container_bits, expected) in [
        (24, [0x00, 0x00, 0x40, 0x00, 0x00, 0xC0].as_slice()),
        (
            32,
            [0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0xC0].as_slice(),
        ),
    ] {
        let shared = Shared::new(1_000, 1);
        shared.push_output(AudioChunk {
            normalization_gain: 1.0,
            stem_samples: None,
            player_samples: vec![0.5, -0.5],
            fft_samples: Vec::new(),
            source_sample_count: 2,
        });
        shared.mark_output_eof();
        let mut source = DecoderSource::new(shared, Arc::new(FftAnalyzer::new()));
        let mut buffer = [0u8; 8];
        let format = ExclusiveFormat {
            sample_rate: 1_000,
            channels: 1,
            container_bits,
            valid_bits: 24,
        };
        let bytes = container_bits as usize / 8 * 2;
        fill_buffer(
            &mut buffer[..bytes],
            &mut source,
            &mut None,
            1.0,
            false,
            &format,
        );
        assert_eq!(&buffer[..bytes], expected);
    }
}
