use windows::{
    Win32::{
        Foundation::{CloseHandle, HWND},
        System::Threading::{
            OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        },
        UI::WindowsAndMessaging::{
            FindWindowExW, GetWindowLongPtrW, GetWindowThreadProcessId, SetWindowLongPtrW,
            WINDOW_LONG_PTR_INDEX,
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

pub unsafe fn modify_window_long(
    hwnd: HWND,
    index: WINDOW_LONG_PTR_INDEX,
    f: impl FnOnce(u32) -> u32,
) {
    let current = unsafe { GetWindowLongPtrW(hwnd, index) };
    let new_value = f(current as u32);
    unsafe { SetWindowLongPtrW(hwnd, index, new_value as isize) };
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
    unsafe { GetWindowThreadProcessId(hwnd, Some(&raw mut pid)) };
    if pid == 0 {
        return false;
    }
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
    else {
        return false;
    };
    let mut buf = [0u16; 260];
    let mut size: u32 = buf.len() as u32;
    let query_result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &raw mut size,
        )
    };
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
        .map_or(false, |v| v != 0)
}
