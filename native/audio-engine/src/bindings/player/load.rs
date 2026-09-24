use super::*;

#[napi]
impl AudioPlayer {
    /// 加载音频源并返回完整元信息
    /// 文件读取和开流在工作线程完成，提交时校验代次以防过期任务恢复播放
    /// @param source - 音频文件路径或网络地址
    /// @param autoPlay - 是否自动播放，false 时加载后立即暂停
    /// @param preparedId - 待消费的预载任务标识，未命中或不兼容时执行普通加载
    /// @returns 音频元信息，复用预载时额外返回预载起点
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
        prepared_id: Option<String>,
    ) -> Result<JsMusicMetadata> {
        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "加载音频源");

        let handle = HttpCancelHandle::new();
        let (
            prepared_playback,
            old_threads,
            token,
            load_token,
            cover_dir,
            normalization_enabled,
            device_id,
            output_generation,
            failure_callback,
            fallback_callback,
            exclusive_mode,
            fft,
            equalizer,
            tempo,
        ) = {
            let mut player = self.inner.lock();
            let prepared_playback = player.take_prepared(prepared_id.as_deref(), &source);
            let (old_threads, token) = player.take_for_async_load(handle.clone());
            let output_generation = player.reserve_output_generation();
            let failure_callback = player.make_failure_callback(output_generation);
            let fallback_callback = player.make_fallback_callback(output_generation);
            let exclusive_mode = player.is_exclusive_mode();
            (
                prepared_playback,
                old_threads,
                token,
                player.load_token_handle(),
                player.cover_cache_dir().map(String::from),
                player.is_normalization_enabled(),
                player.selected_device().map(String::from),
                output_generation,
                failure_callback,
                fallback_callback,
                exclusive_mode,
                player.fft_handle(),
                player.equalizer_handle(),
                player.tempo_handle(),
            )
        };

        let source_for_decoder = source.clone();

        let inner = Arc::clone(&self.inner);
        // 解码器及未提交结果均在阻塞线程释放，避免销毁 HTTP 运行时引发崩溃。
        tokio::task::spawn_blocking(move || {
            let result = (|| {
                if let Some(h) = old_threads.join_aux() {
                    let _ = h.join();
                }
                let mut prepared_playback = prepared_playback;
                let mut prepared = if prepared_playback.is_none() {
                    Some(decoder::prepare_decode(
                        &source_for_decoder,
                        cover_dir.as_deref(),
                        handle.clone(),
                    )?)
                } else {
                    None
                };
                if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                    anyhow::bail!(LOAD_SUPERSEDED_REASON);
                }
                let (rate, bits) = if let Some(ready) = &prepared_playback {
                    (
                        ready.metadata.original_sample_rate,
                        ready.metadata.bits_per_sample,
                    )
                } else {
                    let prepared = prepared.as_ref().unwrap();
                    (prepared.original_sample_rate(), prepared.bits_per_sample())
                };
                let output = output::AudioOutput::new(
                    device_id.as_deref(),
                    Some(rate),
                    Some(bits),
                    output_generation,
                    failure_callback,
                    exclusive_mode.then_some(&fallback_callback),
                )?;
                let buffer = prepared_playback
                    .as_ref()
                    .map(|ready| Arc::clone(&ready.shared));
                let (output, shared, playback) =
                    PlaybackHandle::prepare_with_buffer(output, fft, buffer)?;
                shared.set_normalization_enabled(normalization_enabled);
                if let Some(mut ready) = prepared_playback.take() {
                    if Arc::ptr_eq(&shared, &ready.shared) {
                        shared.set_preloading(false);
                        let decode_handle = ready.decoder.take().unwrap();
                        return Ok((
                            ready.metadata.clone(),
                            decode_handle,
                            shared,
                            output,
                            playback,
                            ready.cancel.clone(),
                            Arc::clone(&ready.equalizer),
                            Arc::clone(&ready.tempo),
                            Some(ready.start_position),
                        ));
                    }
                    // 独占回退或采样率改变后必须按最终设备格式重新解码
                    drop(ready);
                    prepared = Some(decoder::prepare_decode(
                        &source_for_decoder,
                        cover_dir.as_deref(),
                        handle,
                    )?);
                }
                equalizer
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                equalizer.lock().reset_state();
                tempo
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                tempo.lock().reset();
                let (metadata, decode_handle, cancel) = decoder::start_prepared_decode(
                    prepared.unwrap(),
                    Arc::clone(&shared),
                    Arc::clone(&equalizer),
                    Arc::clone(&tempo),
                )?;
                Ok::<_, anyhow::Error>((
                    metadata,
                    decode_handle,
                    shared,
                    output,
                    playback,
                    cancel,
                    equalizer,
                    tempo,
                    None,
                ))
            })();

            let (
                metadata,
                decode_handle,
                shared,
                output,
                playback,
                cancel,
                equalizer,
                tempo,
                prepared_position,
            ) = match result {
                Ok(result) => result,
                Err(error) => {
                    let mut player = inner.lock();
                    if !player.is_load_token_current(token) {
                        return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                    }
                    player.clear_pending_load(token);
                    return Err(error).into_napi();
                }
            };

            let returned_meta = {
                let mut player = inner.lock();
                if player.is_load_token_current(token) {
                    player.replace_dsp(equalizer, tempo);
                }
                player
                    .commit_loaded(
                        token,
                        &source,
                        auto_play,
                        crate::player::LoadedPlayback {
                            start_position: prepared_position.unwrap_or(0.0),
                            metadata,
                            decode_handle,
                            shared,
                            output,
                            playback,
                            cancel,
                        },
                    )
                    .into_napi()?
            };

            match returned_meta {
                Some(meta) => {
                    let mut meta = Self::meta_to_js(meta);
                    meta.prepared_position = prepared_position;
                    Ok(meta)
                }
                None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
            }
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?
    }

    /// 内部：将 AudioMetadata 转为 JS 结构
    pub(super) fn meta_to_js(meta: crate::metadata::AudioMetadata) -> JsMusicMetadata {
        JsMusicMetadata {
            prepared_position: None,
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            comment: meta.comment,
            duration: meta.duration_secs,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u32,
            original_sample_rate: meta.original_sample_rate,
            bits_per_sample: meta.bits_per_sample,
            bit_rate: meta.bit_rate,
            codec: meta.codec,
            embedded_lyric: meta.embedded_lyric,
            external_lyrics: meta
                .external_lyrics
                .into_iter()
                .map(|l| JsExternalLyric {
                    format: l.format,
                    path: l.path,
                })
                .collect(),
            cover: meta.cover,
        }
    }

    /// 设置封面缓存目录（在 load 前调用一次即可）
    #[napi]
    pub fn set_cover_cache_dir(&self, dir: String) {
        self.inner.lock().set_cover_cache_dir(dir);
    }
}
