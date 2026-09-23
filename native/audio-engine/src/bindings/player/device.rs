use super::*;

/// 输出恢复阶段 2 的输出
enum ReinitOutcome {
    /// 恢复成功：新输出 + 新解码线程，等待提交
    Resumed {
        shared: Arc<crate::decoder::buffer::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
        output: Box<output::AudioOutput>,
        playback: Arc<PlaybackHandle>,
    },
    /// 无法从原位置恢复解码（或输出采样率已变），需要重新加载音源
    Reload {
        source: Option<String>,
        was_playing: bool,
    },
    /// 输出重建失败：设备错误，播放器保留曲目进入暂停
    OutputFailed { error: anyhow::Error },
}

#[napi]
impl AudioPlayer {
    /// 重新初始化音频输出设备（系统休眠唤醒、设备热插拔或输出流错误后调用）
    ///
    /// 恢复为全成全败：新输出创建失败时不启动解码、不提交状态，保留当前曲目与位置，
    /// 播放器进入暂停态并返回设备错误；在线音源不会因设备错误触发 URL 重取或 sourceError。
    #[napi]
    pub async fn reinit_output(&self) -> Result<()> {
        info!("重新初始化音频输出设备");

        let (
            seek_take_opt,
            fallback_source,
            position,
            was_playing_fallback,
            output_generation,
            on_failure,
            device_id,
            exclusive_mode,
            on_fallback,
        ) = {
            let mut player = self.inner.lock();
            let position = player.position();
            let is_playing = player.state() == PlayerState::Playing;
            let device_id = player.selected_device().map(String::from);
            let output_generation = player.reserve_output_generation();
            let on_failure = player.make_failure_callback(output_generation);
            let on_fallback = player.make_fallback_callback(output_generation);
            let exclusive_mode = player.is_exclusive_mode();
            let seek_take = player.take_for_async_seek();
            let fallback_source = player.current_source().map(String::from);
            (
                seek_take,
                fallback_source,
                position,
                is_playing,
                output_generation,
                on_failure,
                device_id,
                exclusive_mode,
                on_fallback,
            )
        };

        if let Some(take) = seek_take_opt {
            let SeekTake {
                old_threads,
                normalization_enabled,
                normalization_gain,
                current_source,
                was_playing,
                original_sample_rate,
                original_bits,
                output: old_output,
                fft,
                token,
                equalizer,
                tempo,
            } = take;

            let outcome: ReinitOutcome = tokio::task::spawn_blocking(move || {
                let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
                drop(old_output);

                // 优先按音源原始采样率协商新设备；设备不支持时回退到新设备默认格式
                let output = match output::AudioOutput::new(
                    device_id.as_deref(),
                    Some(original_sample_rate),
                    Some(original_bits),
                    output_generation,
                    on_failure,
                    exclusive_mode.then_some(&on_fallback),
                ) {
                    Ok(output) => output,
                    Err(error) => return ReinitOutcome::OutputFailed { error },
                };
                let Some(mut decoder_data) = decoder_data else {
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                };
                if !decoder_data.seek(position) {
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                }
                let (output, shared, playback) = match PlaybackHandle::prepare(output, fft) {
                    Ok(prepared) => prepared,
                    Err(error) => return ReinitOutcome::OutputFailed { error },
                };
                if let Err(error) =
                    decoder_data.reconfigure_player_output(output.sample_rate(), output.channels())
                {
                    warn!(error = %error, "输出格式变化后重建重采样器失败");
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                }

                shared.set_normalization_enabled(normalization_enabled);
                shared.set_normalization_gain(normalization_gain);
                equalizer
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                equalizer.lock().reset_state();
                tempo
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                tempo.lock().reset();
                let handle = match crate::decoder::resume_decode(
                    decoder_data,
                    std::sync::Arc::clone(&shared),
                    equalizer,
                    tempo,
                ) {
                    Ok(handle) => handle,
                    Err(error) => {
                        warn!(error = %error, "输出重建后启动解码线程失败");
                        return ReinitOutcome::Reload {
                            source: current_source,
                            was_playing,
                        };
                    }
                };

                ReinitOutcome::Resumed {
                    shared,
                    handle,
                    output: Box::new(output),
                    playback,
                }
            })
            .await
            .map_err(|e| Error::from_reason(format!("reinit task join error: {e}")))?;

            match outcome {
                ReinitOutcome::Resumed {
                    shared,
                    handle,
                    output,
                    playback,
                } => {
                    let mut player = self.inner.lock();
                    let committed = player
                        .commit_seeked(token, position, shared, handle, *output, playback)
                        .into_napi()?;
                    if !committed {
                        info!("reinit 已被更新的 load/seek/stop 取代，丢弃结果");
                    }
                    return Ok(());
                }
                ReinitOutcome::Reload {
                    source,
                    was_playing,
                } => {
                    if !self.inner.lock().is_load_token_current(token) {
                        return Ok(());
                    }
                    if let Some(src) = source {
                        let is_remote = src.starts_with("http://") || src.starts_with("https://");
                        if let Err(e) = self.load(src, Some(was_playing)).await {
                            if is_cancelled_napi_error(&e) {
                                return Ok(());
                            }
                            // 远端源恢复重开失败（多半 URL 过期）：发 sourceError 交 JS 重解析
                            if is_remote && !is_device_napi_error(&e) {
                                self.inner.lock().emit_source_error();
                                return Ok(());
                            }
                            return Err(e);
                        }
                        if position > 0.0 {
                            let _ = self.seek(position).await;
                        }
                    }
                    return Ok(());
                }
                ReinitOutcome::OutputFailed { error } => {
                    let mut player = self.inner.lock();
                    if !player.is_load_token_current(token) {
                        return Ok(());
                    }
                    // 保留曲目与位置，进入暂停态，交给 JS 侧有限重试或用户手动操作
                    player.enter_paused_for_recovery();
                    warn!(error = %error, "输出重建失败，播放器进入暂停态");
                    return Err(error).into_napi();
                }
            }
        }

        // 没有 decoder_thread（例如上次 reinit 失败），但存在待恢复的曲目，走重新加载
        if let Some(src) = fallback_source {
            let is_remote = src.starts_with("http://") || src.starts_with("https://");
            if let Err(e) = self.load(src, Some(was_playing_fallback)).await {
                if is_cancelled_napi_error(&e) {
                    return Ok(());
                }
                if is_remote && !is_device_napi_error(&e) {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
            if position > 0.0 {
                let _ = self.seek(position).await;
            }
            return Ok(());
        }

        Ok(())
    }

    /// 获取所有音频输出设备列表
    #[napi]
    pub fn get_output_devices(&self) -> Vec<JsAudioDevice> {
        output::list_output_devices()
            .into_iter()
            .map(|(id, name, is_default)| JsAudioDevice {
                id,
                name,
                is_default,
            })
            .collect()
    }

    /// 获取系统默认输出设备名称
    #[napi]
    pub fn get_default_device_name(&self) -> Option<String> {
        output::default_device_name()
    }

    /// 获取系统默认输出设备稳定 ID
    #[napi]
    pub fn get_default_device_id(&self) -> Option<String> {
        output::default_device_id()
    }

    /// 切换输出设备（传设备 ID，None/undefined 使用系统默认）
    #[napi]
    pub async fn set_output_device(&self, device_id: Option<String>) -> Result<()> {
        self.inner.lock().set_output_device(device_id);
        self.reinit_output().await
    }

    /// 获取当前选择的输出设备 ID（None = 跟随系统默认）
    ///
    /// 旧配置存的是显示名，此处原样返回，由 `open_device` 回退解析
    #[napi]
    pub fn get_selected_device_name(&self) -> Option<String> {
        self.inner.lock().selected_device().map(String::from)
    }

    /// 设置音频输出模式为 WASAPI 独占（仅 Windows 生效，立即重建设备）
    ///
    /// 设备被占用或格式不支持时自动回退共享模式，并通过 outputFallback 事件通知
    #[napi]
    pub async fn set_exclusive_mode(&self, enabled: bool) -> Result<()> {
        self.inner.lock().set_exclusive_mode(enabled);
        self.reinit_output().await
    }
}
