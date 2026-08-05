//! TaskbarService：通过命令队列驱动的任务栏歌词嵌入服务。
//!
//! 单后台线程接收 NAPI 命令，按 win10/win11 策略管理任务栏嵌入和 UIA 重扫，
//! 自带去抖（聚合连续 Update）和 UIA 冷启动重试

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::strategy::{LayoutParams, LegacyStrategy, TaskbarStrategy, Win11Strategy};
use crate::utils::{ComApartmentGuard, get_windows_build_number};
use crate::{JsTaskbarLayout, take_valid_hwnd};
use napi::{
    Status,
    bindgen_prelude::Function,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;

type LayoutTsfn =
    ThreadsafeFunction<JsTaskbarLayout, UnknownReturnValue, JsTaskbarLayout, Status, false>;

enum TaskbarCommand {
    Embed {
        hwnd_ptr: usize,
        reply: Option<std::sync::mpsc::Sender<Result<bool, String>>>,
    },
    Update,
    /// explorer 重启后重新初始化策略并用最近的 hwnd/width 恢复
    Reinit,
    Stop(Option<std::sync::mpsc::Sender<()>>),
}

#[napi]
pub struct TaskbarService {
    sender: SyncSender<TaskbarCommand>,
    latest_width: Arc<Mutex<Option<i32>>>,
    thread: Option<thread::JoinHandle<()>>,
}

#[napi]
impl TaskbarService {
    #[napi(
        constructor,
        ts_args_type = "callback: (layout: JsTaskbarLayout) => void"
    )]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(callback: Function<JsTaskbarLayout, UnknownReturnValue>) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<JsTaskbarLayout>()
            .build_callback(|ctx| Ok(ctx.value))?;

        let (tx, rx) = mpsc::sync_channel(8);
        let (ready_tx, ready_rx) = mpsc::channel();
        let latest_width = Arc::new(Mutex::new(None));
        let latest_for_worker = Arc::clone(&latest_width);

        let thread = thread::Builder::new()
            .name("taskbar-lyric-owner".to_string())
            .spawn(move || worker_loop(&rx, &tsfn, latest_for_worker, ready_tx))
            .map_err(|error| {
                napi::Error::from_reason(format!("启动任务栏歌词线程失败: {error}"))
            })?;

        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(napi::Error::from_reason(error));
            }
            Err(error) => {
                let _ = thread.join();
                return Err(napi::Error::from_reason(format!(
                    "任务栏歌词 ready 握手失败: {error}"
                )));
            }
        }

        Ok(Self {
            sender: tx,
            latest_width,
            thread: Some(thread),
        })
    }

    /// 嵌入窗口到任务栏。传入 Electron BrowserWindow 的 native handle (Buffer → usize)
    #[napi]
    pub fn embed_window_by_ptr(
        &self,
        hwnd_buffer: napi::bindgen_prelude::Buffer,
    ) -> napi::Result<bool> {
        let hwnd_ptr = crate::hwnd_from_buffer(hwnd_buffer.as_ref())
            .ok_or_else(|| napi::Error::from_reason("HWND Buffer 长度或数值无效"))?;
        let (reply_tx, reply_rx) = mpsc::channel();
        self.sender
            .send(TaskbarCommand::Embed {
                hwnd_ptr,
                reply: Some(reply_tx),
            })
            .map_err(|error| napi::Error::from_reason(format!("任务栏 owner 已停止: {error}")))?;
        reply_rx
            .recv()
            .map_err(|error| napi::Error::from_reason(format!("任务栏嵌入响应失败: {error}")))?
            .map_err(napi::Error::from_reason)
    }

    /// 更新歌词显示宽度，触发重新计算布局
    #[napi]
    pub fn update(&self, lyric_width: i32) {
        if let Ok(mut latest) = self.latest_width.lock() {
            *latest = Some(lyric_width);
        }
        let _ = self.sender.try_send(TaskbarCommand::Update);
    }

    /// 通知服务重建策略（explorer.exe 重启时由 JS 层调用）
    #[napi]
    pub fn reinit(&self) {
        let _ = self.sender.send(TaskbarCommand::Reinit);
    }

    /// 停止服务并恢复任务栏原始状态
    #[napi]
    pub fn stop(&self) {
        let (ack_tx, ack_rx) = mpsc::channel();
        if self.sender.send(TaskbarCommand::Stop(Some(ack_tx))).is_ok() {
            let _ = ack_rx.recv();
        }
    }
}

impl Drop for TaskbarService {
    fn drop(&mut self) {
        let _ = self.sender.send(TaskbarCommand::Stop(None));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn worker_loop(
    rx: &Receiver<TaskbarCommand>,
    tsfn: &LayoutTsfn,
    latest_width: Arc<Mutex<Option<i32>>>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) {
    // 进入 MTA apartment，作用域结束自动配对 CoUninitialize；失败直接退出线程
    let Some(_com_guard) = ComApartmentGuard::try_init() else {
        let _ = ready.send(Err("任务栏歌词 COM apartment 初始化失败".to_string()));
        return;
    };

    let mut strategy = create_strategy();
    if strategy.is_none() {
        let _ = ready.send(Err("任务栏歌词 Win10/Win11 策略均初始化失败".to_string()));
        return;
    }
    let _ = ready.send(Ok(()));
    // 记忆最近的 hwnd/width，explorer 重启后 Reinit 据此恢复
    let mut last_hwnd: Option<usize> = None;
    let mut last_width: i32 = 0;

    while let Ok(msg) = rx.recv() {
        match msg {
            TaskbarCommand::Embed { hwnd_ptr, reply } => {
                let result = embed_window(&mut strategy, &mut last_hwnd, hwnd_ptr);
                if let Some(reply) = reply {
                    let _ = reply.send(result);
                }
            }

            TaskbarCommand::Update => {
                let width = latest_width.lock().ok().and_then(|mut value| value.take());
                let Some(width) = width else {
                    continue;
                };
                let mut final_width = width;
                let mut stop_signal = false;
                let mut reinit_requested = false;

                while let Ok(next_msg) = rx.try_recv() {
                    match next_msg {
                        TaskbarCommand::Update => {
                            if let Ok(mut latest) = latest_width.lock()
                                && let Some(width) = latest.take()
                            {
                                final_width = width;
                            }
                        }
                        TaskbarCommand::Embed { hwnd_ptr, reply } => {
                            let result = embed_window(&mut strategy, &mut last_hwnd, hwnd_ptr);
                            if let Some(reply) = reply {
                                let _ = reply.send(result);
                            }
                        }
                        TaskbarCommand::Reinit => {
                            reinit_requested = true;
                        }
                        TaskbarCommand::Stop(ack) => {
                            if let Some(ack) = ack {
                                let _ = ack.send(());
                            }
                            stop_signal = true;
                            break;
                        }
                    }
                }

                if stop_signal {
                    break;
                }

                last_width = final_width;

                if reinit_requested {
                    do_reinit(&mut strategy, last_hwnd);
                }

                if !run_update_with_retry(&mut strategy, final_width, tsfn, rx, &latest_width) {
                    break;
                }
            }

            TaskbarCommand::Reinit => {
                do_reinit(&mut strategy, last_hwnd);
                if last_width > 0
                    && !run_update_with_retry(&mut strategy, last_width, tsfn, rx, &latest_width)
                {
                    break;
                }
            }

            TaskbarCommand::Stop(ack) => {
                if let Some(ack) = ack {
                    let _ = ack.send(());
                }
                break;
            }
        }
    }

    if let Some(s) = strategy.as_mut() {
        s.restore();
    }
}

fn embed_window(
    strategy: &mut Option<Box<dyn TaskbarStrategy>>,
    last_hwnd: &mut Option<usize>,
    hwnd_ptr: usize,
) -> Result<bool, String> {
    let hwnd = take_valid_hwnd(hwnd_ptr).ok_or_else(|| "任务栏歌词 HWND 无效".to_string())?;
    let strategy = strategy
        .as_mut()
        .ok_or_else(|| "任务栏歌词策略未初始化".to_string())?;
    if !strategy.embed_window(hwnd) {
        return Err("任务栏歌词窗口嵌入失败，原窗口状态已回滚".to_string());
    }
    *last_hwnd = Some(hwnd_ptr);
    Ok(true)
}

/// Drop 旧策略（自动 restore），新建策略并用最近的 hwnd 重新嵌入
fn do_reinit(strategy: &mut Option<Box<dyn TaskbarStrategy>>, last_hwnd: Option<usize>) {
    debug!("TaskbarCreated → 重建策略");
    *strategy = None;
    *strategy = create_strategy();
    if let (Some(s), Some(hwnd)) = (strategy.as_mut(), last_hwnd.and_then(take_valid_hwnd))
        && !s.embed_window(hwnd)
    {
        warn!("任务栏歌词窗口重新嵌入失败");
    }
}

/// 对 `update_layout` 做有界退避重试，专门兜底 UIA 冷启动首次扫描返回 None 的情形。
///
/// 重试窗口累计约 1.1s：第一次立即尝试，之后分别等 50/150/300/600ms；
/// 每次等待都用 `recv_timeout` 可被新命令打断（新 Update 改宽度、Embed 继续嵌入、Stop 退出）。
///
/// 注意：`update_layout` 返回 `Some(layout)`（含"两侧空间都 0"这种合法的"无空间"情况）会立即 emit 并返回——
/// 这种是真·无位置展示，不该被当成失败；只有真·扫描失败（UIA 树冷启拿不到内容）才会走重试。
///
/// 返回 false 表示接收到 Stop，上层应退出 worker_loop
fn run_update_with_retry(
    strategy: &mut Option<Box<dyn TaskbarStrategy>>,
    initial_width: i32,
    tsfn: &LayoutTsfn,
    rx: &Receiver<TaskbarCommand>,
    latest_width: &Arc<Mutex<Option<i32>>>,
) -> bool {
    const DELAYS_MS: &[u64] = &[0, 50, 150, 300, 600];
    let mut current_width = initial_width;

    for &delay_ms in DELAYS_MS {
        if delay_ms > 0 {
            match rx.recv_timeout(Duration::from_millis(delay_ms)) {
                Ok(TaskbarCommand::Update) => {
                    if let Ok(mut latest) = latest_width.lock()
                        && let Some(width) = latest.take()
                    {
                        current_width = width;
                    }
                }
                Ok(TaskbarCommand::Embed { hwnd_ptr, reply }) => {
                    let mut ignored_last_hwnd = None;
                    let result = embed_window(strategy, &mut ignored_last_hwnd, hwnd_ptr);
                    if let Some(reply) = reply {
                        let _ = reply.send(result);
                    }
                }
                Ok(TaskbarCommand::Reinit) => {
                    // 重试期间 explorer 重启，策略彻底重建，退出本轮重试由外层走新一轮
                    return true;
                }
                Ok(TaskbarCommand::Stop(ack)) => {
                    if let Some(ack) = ack {
                        let _ = ack.send(());
                    }
                    return false;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }

        if let Some(s) = strategy.as_mut() {
            let params = LayoutParams {
                lyric_width: current_width,
            };
            if let Some(layout) = s.update_layout(params) {
                let js_layout: JsTaskbarLayout = layout.into();
                tsfn.call(js_layout, ThreadsafeFunctionCallMode::NonBlocking);
                return true;
            }
        }
    }

    true
}

fn create_strategy() -> Option<Box<dyn TaskbarStrategy>> {
    let build_num = get_windows_build_number();

    let (mut primary, mut secondary): (Box<dyn TaskbarStrategy>, Box<dyn TaskbarStrategy>) =
        if build_num >= 22000 {
            (
                Box::new(Win11Strategy::new()),
                Box::new(LegacyStrategy::new()),
            )
        } else {
            (
                Box::new(LegacyStrategy::new()),
                Box::new(Win11Strategy::new()),
            )
        };

    if primary.init() {
        return Some(primary);
    }

    if secondary.init() {
        return Some(secondary);
    }

    None
}
