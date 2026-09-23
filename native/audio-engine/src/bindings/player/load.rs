use super::*;

#[napi]
impl AudioPlayer {
    /// 加载音频源，返回完整元信息（含封面路径和歌词）
    /// @param auto_play - 是否自动播放，false 时加载后立即暂停
    ///
    /// 异步三段式：
    /// 主线程只提取旧资源和配置，不在持锁时等待设备或解码 IO。
    /// 工作线程读取音源、打开暂停的输出流，按最终输出格式启动解码。
    /// 主线程校验代次后提交资源并恢复播放，过期任务的输出保持静音。
    /// 持锁阶段都是纯内存操作，主线程其它同步 NAPI 调用最多等几微秒，不会被 IO 卡住
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
    ) -> Result<JsMusicMetadata> {
        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "加载音频源");

        let handle = HttpCancelHandle::new();
        let (
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
            let (old_threads, token) = player.take_for_async_load(handle.clone());
            let output_generation = player.reserve_output_generation();
            let failure_callback = player.make_failure_callback(output_generation);
            let fallback_callback = player.make_fallback_callback(output_generation);
            let exclusive_mode = player.is_exclusive_mode();
            (
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

        let result = tokio::task::spawn_blocking(move || {
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            let prepared =
                decoder::prepare_decode(&source_for_decoder, cover_dir.as_deref(), handle)?;
            if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                anyhow::bail!(LOAD_SUPERSEDED_REASON);
            }
            // 输出采样率协商：音源原始采样率被设备支持时按精确采样率打开
            let output = output::AudioOutput::new(
                device_id.as_deref(),
                Some(prepared.original_sample_rate()),
                Some(prepared.bits_per_sample()),
                output_generation,
                failure_callback,
                exclusive_mode.then_some(&fallback_callback),
            )?;
            let (output, shared, playback) = PlaybackHandle::prepare(output, fft)?;
            shared.set_normalization_enabled(normalization_enabled);
            equalizer
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            tempo.lock().reset();
            let (metadata, decode_handle, cancel) =
                decoder::start_prepared_decode(prepared, Arc::clone(&shared), equalizer, tempo)?;
            Ok::<_, anyhow::Error>((metadata, decode_handle, shared, output, playback, cancel))
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?;

        let (metadata, decode_handle, shared, output, playback, cancel) = match result {
            Ok(result) => result,
            Err(error) => {
                let mut player = self.inner.lock();
                if !player.is_load_token_current(token) {
                    return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                }
                player.clear_pending_load(token);
                return Err(error).into_napi();
            }
        };

        let returned_meta = {
            let mut player = self.inner.lock();
            player
                .commit_loaded(
                    token,
                    &source,
                    auto_play,
                    crate::player::LoadedPlayback {
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
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
        }
    }

    /// 内部：将 AudioMetadata 转为 JS 结构
    fn meta_to_js(meta: crate::metadata::AudioMetadata) -> JsMusicMetadata {
        JsMusicMetadata {
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
