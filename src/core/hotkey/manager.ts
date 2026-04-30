/**
 * 渲染端快捷键管理器
 *
 * - install 时 buildRegistry 填充 handler，挂全局 keydown 监听
 * - 监听 store.bindings 变化，预解析 accelerator 缓存到 compiled 表，避免每次 keydown 重复字符串解析
 * - in-app 命中：从 compiled 表反查 → dispatch
 * - global 命中：主进程 broadcast `hotkey:trigger`，订阅后 dispatch
 */

import { watch } from "vue";
import { useHotkeyStore } from "@/stores/hotkey";
import { isMac } from "@/utils/config";
import { parseAccelerator, matchParsed, type ParsedAccelerator } from "@shared/utils/accelerator";
import type { HotkeyActionId } from "@shared/types/hotkey";
import { buildRegistry, dispatch } from "./registry";

/**
 * 焦点元素是否吃掉快捷键：
 * - input/textarea/select/contenteditable
 * - button / role=button（避免 Space 同时切歌 + 点按钮）
 */
const isInputFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.tagName === "BUTTON") return true;
  if (el.getAttribute("role") === "button") return true;
  return false;
};

/** 预解析后的 inApp 绑定表，每次 bindings 变化时重建 */
let compiled: Array<{ id: HotkeyActionId; parsed: ParsedAccelerator }> = [];

const recompile = (): void => {
  const store = useHotkeyStore();
  const next: typeof compiled = [];
  const ids = Object.keys(store.bindings) as HotkeyActionId[];
  for (const id of ids) {
    const accel = store.bindings[id]?.inApp;
    if (!accel) continue;
    const parsed = parseAccelerator(accel, isMac);
    if (parsed) next.push({ id, parsed });
  }
  compiled = next;
};

let installed = false;
let offGlobalTrigger: (() => void) | null = null;
let stopWatchBindings: (() => void) | null = null;

/** 全局 keydown 处理：仅扫描预编译表 */
const onKeyDown = (event: KeyboardEvent): void => {
  if (event.isComposing) return;
  if (isInputFocused()) return;
  for (const entry of compiled) {
    if (matchParsed(event, entry.parsed)) {
      event.preventDefault();
      dispatch(entry.id);
      return;
    }
  }
};

/**
 * 安装快捷键管理器
 * 在 useHotkeyStore.init() 完成后调用一次
 */
export const installHotkeyManager = (): void => {
  if (installed) return;
  installed = true;
  buildRegistry();
  recompile();
  stopWatchBindings = watch(() => useHotkeyStore().bindings, recompile, { deep: true });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  offGlobalTrigger = window.api.hotkey.onTrigger((id) => dispatch(id));
};

/** 卸载（仅测试 / HMR 用） */
export const uninstallHotkeyManager = (): void => {
  if (!installed) return;
  installed = false;
  window.removeEventListener("keydown", onKeyDown, { capture: true });
  offGlobalTrigger?.();
  offGlobalTrigger = null;
  stopWatchBindings?.();
  stopWatchBindings = null;
  compiled = [];
};
