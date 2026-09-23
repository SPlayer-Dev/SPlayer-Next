use napi_derive::napi;

/// 一条外部歌词，返回给 JS 侧（仅格式和路径，内容按需加载）
#[napi(object)]
pub struct JsExternalLyric {
    /// 格式（如 "lrc", "ttml", "yrc", "qrc"）
    pub format: String,
    /// 文件路径
    pub path: String,
}

/// 歌曲完整元信息，返回给 JS 侧（load 时一次性返回）
#[napi(object)]
pub struct JsMusicMetadata {
    /// 复用了预载 PCM 时的起点（秒），普通加载为空
    pub prepared_position: Option<f64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    /// 时长（秒）
    pub duration: f64,
    /// 播放采样率（重采样后）
    pub sample_rate: u32,
    /// 声道数
    pub channels: u32,
    /// 原始采样率（解码前，用于音质显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式（如 "flac", "mp3", "aac"）
    pub codec: String,
    /// 内嵌歌词（从音频文件 tag 中读取）
    pub embedded_lyric: Option<String>,
    /// 同目录下找到的所有歌词文件
    pub external_lyrics: Vec<JsExternalLyric>,
    /// 封面缩略图路径（300x300，用于前端日常显示）
    pub cover: Option<String>,
}

/// 音频输出设备信息
#[napi(object)]
pub struct JsAudioDevice {
    /// 稳定设备 ID（cpal `DeviceId` 的字符串形式）
    pub id: String,
    /// 显示名
    pub name: String,
    /// 是否为系统默认设备
    pub is_default: bool,
}

/// FFT 双声道频谱数据
#[napi(object)]
pub struct JsFftData {
    pub ldata: Vec<f64>,
    pub rdata: Vec<f64>,
}

/// 播放器事件，推送给 JS 侧
#[napi(object)]
#[derive(Default)]
pub struct JsPlayerEvent {
    /// 事件类型："stateChanged" | "ended" | "sourceError" | "position" | "transitionChanged" | "fftData" | "outputStalled" | "outputFailed" | "outputFallback"
    #[napi(js_name = "type")]
    pub event_type: String,
    /// 状态（仅 stateChanged 时有值）
    pub state: Option<String>,
    /// 位置（秒，仅 position 时有值）
    pub position: Option<f64>,
    /// 时长（秒，仅 position 时有值）
    pub duration: Option<f64>,
    /// 实际交叉淡化状态（仅 transitionChanged 时有值）
    pub transition_active: Option<bool>,
    /// FFT 频谱数据（仅 fftData 时有值，128 个频段，值域 0.0 ~ 1.0）
    pub fft_data: Option<JsFftData>,
    /// 回退原因分类键（仅 outputFallback 时有值：deviceBusy / formatUnsupported / unavailable）
    pub reason: Option<String>,
}

/// 播放器状态快照
#[napi(object)]
pub struct JsPlayerStatus {
    /// 播放状态："idle" | "playing" | "paused" | "stopped"
    pub state: String,
    /// 当前播放位置（秒）
    pub position: f64,
    /// 总时长（秒）
    pub duration: f64,
    /// 音量（0.0 ~ 1.0）
    pub volume: f64,
    /// 是否已播放完毕
    pub is_finished: bool,
}

/// 当前真实音频流与硬件输出信息
#[napi(object)]
pub struct JsAudioStreamInfo {
    /// 当前生效的音频输出设备名称
    pub device_name: String,
    /// 是否为独占模式输出
    pub is_exclusive: bool,
    /// 实际输出流采样率（Hz）
    pub output_sample_rate: u32,
    /// 实际输出流声道数
    pub output_channels: u32,
    /// 实际输出流位深（bits）
    pub output_bits: u32,
    /// 音源原始采样率（Hz）
    pub source_sample_rate: u32,
    /// 音源原始位深（bits）
    pub source_bits: u32,
    /// 是否发生了重采样（音源采样率 != 硬件输出采样率）
    pub is_resampling: bool,
    /// 均衡器是否启用
    pub is_equalizer_active: bool,
    /// 变速变调是否激活
    pub is_tempo_active: bool,
    /// 当前播放倍速
    pub speed: f64,
    /// 响度均衡是否启用
    pub is_normalization_active: bool,
    /// 输出限幅器是否激活（DSP 介入时为 true，纯直通时为 false）
    pub is_limiter_active: bool,
}
