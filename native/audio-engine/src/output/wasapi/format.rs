use super::*;

/// KSDATAFORMAT_SUBTYPE_PCM
const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

/// WAVE_FORMAT_EXTENSIBLE
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

/// SPEAKER_MONO
const SPEAKER_MONO: u32 = 0x4;
/// SPEAKER_STEREO
const SPEAKER_STEREO: u32 = 0x3;
/// SPEAKER_5POINT1（含低音炮）
const SPEAKER_5POINT1: u32 = 0x3F;
/// SPEAKER_7POINT1
const SPEAKER_7POINT1: u32 = 0x63F;

/// 按 cpal 设备 ID 字符串解析 WASAPI 端点 ID。
/// cpal 0.18 存储的就是 `IMMDevice::GetId` 字符串（形如 `{0.0.0.00000000}.{guid}`），
/// 序列化时可能带后端前缀，取首个 `{` 起的子串即可剥离。
fn endpoint_id_from_device_id(device_id: &str) -> &str {
    match device_id.find('{') {
        Some(index) => &device_id[index..],
        None => device_id,
    }
}

/// 按端点 ID 或系统默认解析渲染端点
pub(super) fn resolve_endpoint(device_id: Option<&str>) -> Result<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .context("创建设备枚举器失败")?;
        match device_id {
            Some(id) => {
                let wide: Vec<u16> = endpoint_id_from_device_id(id)
                    .encode_utf16()
                    .chain([0])
                    .collect();
                enumerator
                    .GetDevice(PCWSTR(wide.as_ptr()))
                    .with_context(|| format!("解析输出端点 '{id}' 失败"))
            }
            None => enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .context("解析默认输出端点失败"),
        }
    }
}

/// 声道掩码：仅覆盖常见布局，其余布局独占模式协商本就难以通过
fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => SPEAKER_MONO,
        2 => SPEAKER_STEREO,
        6 => SPEAKER_5POINT1,
        8 => SPEAKER_7POINT1,
        _ => 0,
    }
}

/// 构造 PCM 整型 WAVEFORMATEXTENSIBLE
pub(super) fn build_wave_format(format: &ExclusiveFormat) -> WAVEFORMATEXTENSIBLE {
    let block_align = format.channels * format.container_bits / 8;
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE,
            nChannels: format.channels,
            nSamplesPerSec: format.sample_rate,
            wBitsPerSample: format.container_bits,
            nBlockAlign: block_align,
            nAvgBytesPerSec: format.sample_rate * u32::from(block_align),
            // WAVEFORMATEXTENSIBLE 扩展部分固定 22 字节
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: format.valid_bits,
        },
        dwChannelMask: channel_mask(format.channels),
        SubFormat: KSDATAFORMAT_SUBTYPE_PCM,
    }
}

/// 位深候选：优先音源位深，16bit 作通用兜底
fn valid_bits_candidates(source_bits: u32) -> Vec<u16> {
    match source_bits {
        0..=16 => vec![16, 24],
        24 => vec![24, 16],
        _ => vec![32, 24, 16],
    }
}

/// 采样率候选：音源原始值优先，回退设备常见的离散值
fn sample_rate_candidates(source_rate: u32) -> Vec<u32> {
    let mut rates = vec![source_rate, 48_000, 44_100, 96_000, 192_000];
    rates.dedup();
    rates
}

/// 独占模式格式协商：逐个尝试候选组合，返回首个被设备接受的格式。
/// 探测用的 IAudioClient 随函数退出释放，不占用设备独占锁
fn negotiate_format(
    device: &IMMDevice,
    source_rate: u32,
    source_bits: u32,
    fallback_channels: u16,
) -> Result<ExclusiveFormat, ExclusiveOpenError> {
    unsafe {
        let probe: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .context("激活探测音频客户端失败")?;

        let mut channels_candidates = vec![fallback_channels, 2];
        channels_candidates.dedup();

        for &channels in &channels_candidates {
            for &valid_bits in &valid_bits_candidates(source_bits) {
                for &rate in &sample_rate_candidates(source_rate) {
                    let format = ExclusiveFormat {
                        sample_rate: rate,
                        channels,
                        container_bits: if valid_bits == 16 { 16 } else { 32 },
                        valid_bits,
                    };
                    let wave = build_wave_format(&format);
                    // windows 0.62 中 IsFormatSupported 返回原始 HRESULT
                    let hr = probe.IsFormatSupported(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        &wave as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX,
                        None,
                    );
                    if hr.is_ok() {
                        info!(
                            rate = format.sample_rate,
                            channels = format.channels,
                            bits = format.valid_bits,
                            "独占模式格式协商成功"
                        );
                        return Ok(format);
                    }
                    if hr == AUDCLNT_E_DEVICE_IN_USE {
                        return Err(ExclusiveOpenError::DeviceInUse);
                    }
                }
            }
        }
        Err(ExclusiveOpenError::FormatUnsupported)
    }
}

/// 独占模式格式协商入口：解析端点并逐个尝试候选格式
pub fn negotiate_exclusive_format(
    device_id: Option<&str>,
    source_rate: u32,
    source_bits: u32,
    fallback_channels: u16,
) -> Result<ExclusiveFormat, ExclusiveOpenError> {
    let endpoint = resolve_endpoint(device_id).map_err(ExclusiveOpenError::Other)?;
    negotiate_format(&endpoint, source_rate, source_bits, fallback_channels)
}

#[cfg(test)]
#[path = "tests/format.rs"]
mod tests;
