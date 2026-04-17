use windows::{
    Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            FindWindowW,
            GetWindowLongPtrW,
            SetWindowLongPtrW,
            WINDOW_LONG_PTR_INDEX,
        },
    },
    core::w,
};
use windows_core::PCWSTR;
use winreg::{
    RegKey,
    enums::{
        HKEY_CURRENT_USER,
        HKEY_LOCAL_MACHINE,
    },
};

pub const BRIDGE_CLASS: PCWSTR = w!("Windows.UI.Composition.DesktopWindowContentBridge");

pub const REG_KEY_ADVANCED: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";

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

pub fn find_taskbar_hwnd() -> Option<HWND> {
    unsafe {
        let hwnd = FindWindowW(w!("Shell_TrayWnd"), None).unwrap_or_default();
        if hwnd.0.is_null() { None } else { Some(hwnd) }
    }
}

pub fn get_windows_build_number() -> u32 {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .and_then(|key| key.get_value::<String, _>("CurrentBuild"))
        .map_or(0, |s| s.parse::<u32>().unwrap_or(0))
}
