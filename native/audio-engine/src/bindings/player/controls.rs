use super::*;

#[napi]
impl AudioPlayer {
    /// 恢复播放；如果已停止或播放结束，自动从头重新加载
    #[napi]
    pub async fn play(&self) -> Result<()> {
        let (revival_source, position) = {
            let mut player = self.inner.lock();
            let pos = player.position();
            let src = player.play().into_napi()?;
            (src, pos)
        };
        if let Some(source) = revival_source {
            let is_remote = source.starts_with("http://") || source.starts_with("https://");
            if let Err(e) = self.load(source, Some(true), None).await {
                // 复活加载被更新的 load/stop 取代不是错误：已有更新的操作接管播放
                if is_cancelled_napi_error(&e) {
                    return Ok(());
                }
                // 远端源复活失败（多半 URL 过期）：发 sourceError 交 JS 重解析（命中本地缓存 / 拿新 URL）
                if is_remote {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
            if position > 0.0 {
                let _ = self.seek(position).await;
            }
        }
        Ok(())
    }

    /// 暂停播放
    #[napi]
    pub fn pause(&self) {
        self.inner.lock().pause();
    }

    /// 立即暂停播放，用于输出设备切换前阻止短暂串音
    #[napi]
    pub fn pause_immediately(&self) {
        self.inner.lock().pause_immediately();
    }

    /// 停止播放并释放资源
    #[napi]
    pub fn stop(&self) {
        self.inner.lock().stop();
    }

    /// 设置音量（0.0 ~ 1.0）
    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.inner.lock().set_volume(volume as f32);
    }

    /// 获取当前音量（0.0 ~ 1.0）
    #[napi]
    pub fn get_volume(&self) -> f64 {
        self.inner.lock().volume() as f64
    }

    /// 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用渐变
    #[napi]
    pub fn set_fade_duration(&self, duration_ms: f64) {
        self.inner.lock().set_fade_duration(duration_ms as u64);
    }

    /// 获取当前渐变时长（毫秒）
    #[napi]
    pub fn get_fade_duration(&self) -> f64 {
        self.inner.lock().fade_duration() as f64
    }

    /// 获取当前播放位置（秒）
    #[napi]
    pub fn get_position(&self) -> f64 {
        self.inner.lock().position()
    }

    /// 获取总时长（秒）
    #[napi]
    pub fn get_duration(&self) -> f64 {
        self.inner.lock().duration()
    }

    /// 获取当前播放状态快照
    #[napi]
    pub fn get_status(&self) -> JsPlayerStatus {
        let player = self.inner.lock();
        JsPlayerStatus {
            state: state_to_str(player.state()).to_string(),
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
        }
    }

    /// 获取当前真实的音频流与输出参数
    #[napi]
    pub fn get_stream_info(&self) -> JsAudioStreamInfo {
        self.inner.lock().stream_info()
    }

    /// 启用/禁用 FFT 频谱推送（前端需要显示频谱时启用，不显示时禁用以节省性能）
    #[napi]
    pub fn set_fft_enabled(&self, enabled: bool) {
        self.inner.lock().set_fft_enabled(enabled);
    }

    /// 获取 FFT 推送开关状态
    #[napi]
    pub fn get_fft_enabled(&self) -> bool {
        self.inner.lock().fft_enabled()
    }

    /// 启用/禁用音量归一化（实时响度均衡）
    #[napi]
    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.inner.lock().set_normalization_enabled(enabled);
    }

    /// 获取音量归一化开关状态
    #[napi]
    pub fn get_normalization_enabled(&self) -> bool {
        self.inner.lock().normalization_enabled()
    }

    /// 启用/禁用 10 频段均衡器
    #[napi]
    pub fn set_equalizer_enabled(&self, enabled: bool) {
        self.inner.lock().set_equalizer_enabled(enabled);
    }

    /// 获取均衡器开关状态
    #[napi]
    pub fn get_equalizer_enabled(&self) -> bool {
        self.inner.lock().equalizer_enabled()
    }

    /// 更新均衡器各频段增益（dB），长度必须为 10，范围 [-15, 15]
    #[napi]
    pub fn set_equalizer_bands(&self, gains_db: Vec<f64>) {
        let bands: Vec<f32> = gains_db.into_iter().map(|v| v as f32).collect();
        self.inner.lock().set_equalizer_bands(&bands);
    }

    /// 获取均衡器各频段当前增益（dB）
    #[napi]
    pub fn get_equalizer_bands(&self) -> Vec<f64> {
        self.inner
            .lock()
            .equalizer_bands()
            .iter()
            .map(|v| *v as f64)
            .collect()
    }

    /// 设置前级增益（dB），范围 [-12, 12]
    #[napi]
    pub fn set_preamp_gain(&self, preamp_db: f64) {
        self.inner.lock().set_preamp_gain(preamp_db as f32);
    }

    /// 获取前级增益（dB）
    #[napi]
    pub fn get_preamp_gain(&self) -> f64 {
        self.inner.lock().preamp_gain() as f64
    }

    /// 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
    #[napi]
    pub fn get_fft_data(&self) -> JsFftData {
        let (ldata, rdata) = self.inner.lock().fft_data();
        let ldata = ldata.into_iter().map(|v| v as f64).collect();
        let rdata = rdata.into_iter().map(|v| v as f64).collect();
        JsFftData { ldata, rdata }
    }

    /// 返回 load 时缓存的原始封面数据（用于 SMTC / 全屏播放器）
    /// 封面在 load 阶段从已打开的 FFmpeg 上下文一次性提取，不再重复打开文件
    #[napi]
    pub fn get_cover_raw(&self) -> Option<napi::bindgen_prelude::Buffer> {
        let player = self.inner.lock();
        let data = player.cover_raw()?;
        Some(data.to_vec().into())
    }

    /// 设置播放速度（自动 clamp 到 [0.5, 2.0]）
    #[napi]
    pub fn set_speed(&self, speed: f64) {
        self.inner.lock().set_speed(speed as f32);
    }

    /// 设置音调偏移（半音，自动 clamp 到 [-12, 12]）
    #[napi]
    pub fn set_pitch(&self, semitones: i32) {
        self.inner.lock().set_pitch(semitones.clamp(-12, 12) as i8);
    }

    /// 设置"音调同步"开关（true = 变速保音调）
    #[napi]
    pub fn set_pitch_sync(&self, sync: bool) {
        self.inner.lock().set_pitch_sync(sync);
    }

    /// 获取当前播放速度
    #[napi]
    pub fn get_speed(&self) -> f64 {
        self.inner.lock().speed() as f64
    }

    /// 获取当前音调（半音）
    #[napi]
    pub fn get_pitch(&self) -> i32 {
        self.inner.lock().pitch() as i32
    }

    /// 获取"音调同步"开关状态
    #[napi]
    pub fn get_pitch_sync(&self) -> bool {
        self.inner.lock().pitch_sync()
    }
}
