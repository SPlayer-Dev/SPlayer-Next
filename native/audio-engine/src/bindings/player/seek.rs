use super::*;

/// async seek 阶段 2 的输出
enum SeekOutcome {
    /// seek 成功 + 已启动新解码线程
    Resumed {
        shared: Arc<crate::decoder::buffer::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
        output: Box<output::AudioOutput>,
        playback: Arc<PlaybackHandle>,
    },
    /// seek 失败，需要 fallback 到完整 load
    Fallback,
    OutputFailed {
        error: anyhow::Error,
    },
}

#[napi]
impl AudioPlayer {
    /// 跳转到指定播放位置（秒）
    ///
    /// 异步三段式：与 load 同样的设计原则
    /// 1. 主线程瞬时持锁：take 旧解码线程 + 拿归一化参数
    /// 2. 工作线程：join 旧线程 → ffmpeg seek → resume_decode 启动新解码线程
    /// 3. 主线程瞬时持锁：attach 新 sink + emit 状态
    /// seek 失败时 fallback 到完整 load
    #[napi]
    pub async fn seek(&self, position: f64) -> Result<()> {
        let take = {
            let mut player = self.inner.lock();
            player.take_for_async_seek()
        };
        // 无解码线程：空闲 / 已停止 / 正在异步加载（句柄被 load 取走）。
        // 此时 seek 无意义，且绝不能走回退重载——current_source 仍指向旧曲，
        // 重载会顶掉在途的新歌加载、复活旧曲
        let Some(take) = take else {
            return Ok(());
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source,
            was_playing,
            original_sample_rate: _,
            original_bits: _,
            output,
            fft,
            token,
            equalizer,
            tempo,
        } = take;

        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            let previous_format = (output.sample_rate(), output.channels());
            let (output, shared, playback) = match PlaybackHandle::prepare(output, fft) {
                Ok(prepared) => prepared,
                Err(error) => return SeekOutcome::OutputFailed { error },
            };
            let output_sample_rate = output.sample_rate();
            let output_channels = output.channels();
            if previous_format != (output_sample_rate, output_channels)
                && decoder_data
                    .reconfigure_player_output(output_sample_rate, output_channels)
                    .is_err()
            {
                return SeekOutcome::Fallback;
            }
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            equalizer
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            tempo.lock().reset();
            let handle =
                match decoder::resume_decode(decoder_data, Arc::clone(&shared), equalizer, tempo) {
                    Ok(handle) => handle,
                    Err(err) => {
                        warn!(error = %err, "seek 后启动解码线程失败，回退到重新加载");
                        return SeekOutcome::Fallback;
                    }
                };
            SeekOutcome::Resumed {
                shared,
                handle,
                output: Box::new(output),
                playback,
            }
        })
        .await
        .map_err(|e| Error::from_reason(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed {
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
                    info!(position, "seek 已被更新的 load/seek/stop 取代，丢弃结果");
                }
                Ok(())
            }
            SeekOutcome::OutputFailed { error } => {
                let mut player = self.inner.lock();
                if !player.is_load_token_current(token) {
                    return Ok(());
                }
                player.enter_paused_for_recovery();
                Err(error).into_napi()
            }
            SeekOutcome::Fallback => {
                // seek 期间已被新的 load/stop 取代时不再回退重载，避免复活旧源
                if !self.inner.lock().is_load_token_current(token) {
                    info!(position, "seek 失败且已被取代，跳过回退重载");
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if is_cancelled_napi_error(&e) {
                            return Ok(());
                        }
                        // 远端源回退重开失败（多半 URL 过期）：发 sourceError 交 JS 重解析
                        if is_remote {
                            self.inner.lock().emit_source_error();
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Err(Error::from_reason("seek 失败且无 current_source"))
                }
            }
        }
    }
}
