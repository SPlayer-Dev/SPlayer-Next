use super::*;

#[napi]
impl AudioPlayer {
    /// 注册事件回调，Rust 侧会在状态变化、位置更新、播放结束时主动调用
    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;

        // 用闭包包裹 tsfn，在内部做 PlayerEvent → JsPlayerEvent 转换
        let emitter: player::EventEmitter = Arc::new(move |event: PlayerEvent| {
            let js_event = match event {
                PlayerEvent::StateChanged { state } => JsPlayerEvent {
                    event_type: "stateChanged".into(),
                    state: Some(state_to_str(state).into()),
                    ..Default::default()
                },
                PlayerEvent::Ended => JsPlayerEvent {
                    event_type: "ended".into(),
                    ..Default::default()
                },
                PlayerEvent::SourceError => JsPlayerEvent {
                    event_type: "sourceError".into(),
                    ..Default::default()
                },
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".into(),
                    position: Some(position),
                    duration: Some(duration),
                    ..Default::default()
                },
                PlayerEvent::TransitionChanged { active } => JsPlayerEvent {
                    event_type: "transitionChanged".into(),
                    transition_active: Some(active),
                    ..Default::default()
                },
                PlayerEvent::FftData { ldata, rdata } => JsPlayerEvent {
                    event_type: "fftData".into(),
                    fft_data: Some(JsFftData {
                        ldata: ldata.into_iter().map(|v| v as f64).collect(),
                        rdata: rdata.into_iter().map(|v| v as f64).collect(),
                    }),
                    ..Default::default()
                },
                PlayerEvent::OutputStalled => JsPlayerEvent {
                    event_type: "outputStalled".into(),
                    ..Default::default()
                },
                PlayerEvent::OutputFailed => JsPlayerEvent {
                    event_type: "outputFailed".into(),
                    ..Default::default()
                },
                PlayerEvent::OutputFallback { reason } => JsPlayerEvent {
                    event_type: "outputFallback".into(),
                    reason: Some(reason),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        self.inner.lock().set_event_callback(emitter);
        Ok(())
    }

    /// 当前平台是否支持原生音频设备监听
    #[napi]
    pub fn supports_device_watcher(&self) -> bool {
        device_watcher::is_supported()
    }

    /// 注册系统音频设备变化回调，不支持的平台由主进程轮询
    /// 回调参数为 true 表示默认输出设备切换，false 表示设备列表变化
    #[napi(ts_args_type = "callback: (defaultChanged: boolean) => void")]
    pub fn on_device_change(&self, callback: Function<bool, ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;
        let watcher = device_watcher::DeviceWatcher::new(Box::new(move |default_changed| {
            tsfn.call(default_changed, ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .into_napi()?;
        *self.device_watcher.lock() = Some(watcher);
        info!("原生音频设备监听已启动");
        Ok(())
    }

    /// 停止系统音频设备变化监听
    #[napi]
    pub fn stop_device_watcher(&self) {
        if let Some(mut watcher) = self.device_watcher.lock().take() {
            watcher.stop();
            info!("原生音频设备监听已停止");
        }
    }
}
