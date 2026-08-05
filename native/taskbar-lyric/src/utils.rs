use windows::{
    Win32::{
        Foundation::{CloseHandle, HWND, RPC_E_CHANGED_MODE},
        System::{
            Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize},
            Threading::{
                OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                QueryFullProcessImageNameW,
            },
        },
        UI::WindowsAndMessaging::{
            FindWindowExW, GetWindowThreadProcessId, MSG, PM_NOREMOVE, PeekMessageW, WM_USER,
        },
    },
    core::w,
};
use windows_core::{PCWSTR, PWSTR};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
};

pub const BRIDGE_CLASS: PCWSTR = w!("Windows.UI.Composition.DesktopWindowContentBridge");

pub const REG_KEY_ADVANCED: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";

pub const REG_KEY_PERSONALIZE: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

/// 强制创建当前线程的消息队列（Win32 的队列要到首次调用消息 API 才存在）。
/// watcher 线程必须在透出 tid 前调用：否则 stop() 的 PostThreadMessageW 在队列
/// 存在前会失败，WM_QUIT 丢失导致线程连同钩子/窗口永久泄漏
pub fn ensure_thread_message_queue() {
    let mut msg = MSG::default();
    // SAFETY: msg 是有效出参，PM_NOREMOVE 只促使系统为当前线程创建消息队列。
    unsafe {
        let _ = PeekMessageW(&raw mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
    }
}

pub fn check_registry_value<F>(value_name: &str, predicate: F, default: bool) -> bool
where
    F: Fn(u32) -> bool,
{
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(REG_KEY_ADVANCED)
        .and_then(|key| key.get_value::<u32, _>(value_name))
        .map_or(default, predicate)
}

/// 第三方任务栏（StartAllBack/ExplorerPatcher/Start11/YASB/Zebar）也会创建 Shell_TrayWnd
/// 类窗口；只接受 explorer.exe 创建的那个，避免错误嵌入到第三方任务栏
pub fn find_taskbar_hwnd() -> Option<HWND> {
    // SAFETY: 只枚举顶层窗口并对候选句柄执行只读校验。
    unsafe {
        let mut prev: Option<HWND> = None;
        loop {
            let hwnd = FindWindowExW(None, prev, w!("Shell_TrayWnd"), None).ok()?;
            if hwnd.0.is_null() {
                return None;
            }
            if is_explorer_window(hwnd) {
                return Some(hwnd);
            }
            prev = Some(hwnd);
        }
    }
}

unsafe fn is_explorer_window(hwnd: HWND) -> bool {
    let mut pid: u32 = 0;
    // SAFETY: hwnd 是枚举得到的窗口，pid 是有效出参。
    unsafe { GetWindowThreadProcessId(hwnd, Some(&raw mut pid)) };
    if pid == 0 {
        return false;
    }
    // SAFETY: pid 由系统窗口查询返回，仅申请只读的有限查询权限。
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
    else {
        return false;
    };
    let mut buf = [0u16; 260];
    let mut size: u32 = buf.len() as u32;
    // SAFETY: process 具备查询权限，buf 和 size 是匹配的可写出参。
    let query_result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &raw mut size,
        )
    };
    // SAFETY: process 由本函数 OpenProcess 成功创建，只在此处关闭一次。
    let _ = unsafe { CloseHandle(process) };
    if query_result.is_err() || size == 0 {
        return false;
    }
    let path = String::from_utf16_lossy(&buf[..size as usize]);
    path.to_ascii_lowercase().ends_with("\\explorer.exe")
}

pub fn get_windows_build_number() -> u32 {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .and_then(|key| key.get_value::<String, _>("CurrentBuild"))
        .map_or(0, |s| s.parse::<u32>().unwrap_or(0))
}

/// 读取 `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\SystemUsesLightTheme`
/// 返回 true 表示任务栏处于浅色；读取失败时按 Windows 默认值（深色）返回 false
pub fn read_system_uses_light_theme() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(REG_KEY_PERSONALIZE)
        .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
        .is_ok_and(|v| v != 0)
}

/// COM MTA 初始化的 RAII 守卫。
///
/// 处理 `RPC_E_CHANGED_MODE`：当前线程已被其他代码初始化为别的 apartment 模式时，
/// 允许继续运行但不接管 `CoUninitialize` 责任（由最初的 init 持有）。
/// `try_init` 返回 `None` 表示真正失败，调用方应中止
pub struct ComApartmentGuard {
    should_uninitialize: bool,
}

impl ComApartmentGuard {
    pub fn try_init() -> Option<Self> {
        // SAFETY: CoInitializeEx 跨线程独立调用是安全的，HRESULT 分类后决定 Drop 行为
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_ok() {
            Some(Self {
                should_uninitialize: true,
            })
        } else if hr == RPC_E_CHANGED_MODE {
            Some(Self {
                should_uninitialize: false,
            })
        } else {
            None
        }
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            // SAFETY: 与构造时的 CoInitializeEx 成对调用
            unsafe {
                CoUninitialize();
            }
        }
    }
}
