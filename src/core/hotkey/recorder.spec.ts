import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventToAccelerator,
  formatAccelerator,
  matchParsed,
  normalizeAccelerator,
  parseAccelerator,
} from "@shared/utils/accelerator";
import { useHotkeyRecorder } from "./recorder";

const digits = Array.from({ length: 10 }, (_, digit) => String(digit));
let recorder: ReturnType<typeof useHotkeyRecorder> | null = null;

/**
 * 构造保留物理键码的小键盘事件，便于验证录入与匹配。
 * @param digit - 小键盘数字
 * @param options - 键值和修饰键覆盖项
 * @returns 小键盘键盘事件
 */
const numpadEvent = (digit: string, options: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", {
    code: `Numpad${digit}`,
    key: digit,
    location: 3,
    ctrlKey: true,
    altKey: true,
    ...options,
  });

afterEach(() => {
  recorder?.cancel();
  recorder = null;
});

describe("小键盘数字快捷键", () => {
  it.each(digits)("将 Ctrl+Alt+小键盘%s 录入为 Electron 支持的加速键", (digit) => {
    const onConfirm = vi.fn();
    recorder = useHotkeyRecorder({ isMac: false, requireModifier: true, onConfirm });
    recorder.start();

    window.dispatchEvent(numpadEvent(digit));

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(`CommandOrControl+Alt+num${digit}`);
    expect(recorder.isRecording.value).toBe(false);
  });

  it.each(digits)("解析 num%s 并只匹配对应的小键盘数字", (digit) => {
    const parsed = parseAccelerator(`CommandOrControl+Alt+num${digit}`, false);

    expect(parsed).toEqual({
      ctrl: true,
      meta: false,
      alt: true,
      shift: false,
      code: `Numpad${digit}`,
    });
    expect(matchParsed(numpadEvent(digit), parsed!)).toBe(true);
    expect(
      matchParsed(
        new KeyboardEvent("keydown", {
          code: `Digit${digit}`,
          key: digit,
          ctrlKey: true,
          altKey: true,
        }),
        parsed!,
      ),
    ).toBe(false);
  });

  it("Num Lock 改变键值时仍按物理小键盘键录入", () => {
    const onConfirm = vi.fn();
    recorder = useHotkeyRecorder({ isMac: false, requireModifier: true, onConfirm });
    recorder.start();

    window.dispatchEvent(numpadEvent("3", { key: "PageDown" }));

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("CommandOrControl+Alt+num3");
  });

  it("保留 macOS 的修饰键映射", () => {
    const event = numpadEvent("3", { ctrlKey: false, metaKey: true });
    const accelerator = eventToAccelerator(event, true);

    expect(accelerator).toBe("CommandOrControl+Alt+num3");
    expect(matchParsed(event, parseAccelerator(accelerator!, true)!)).toBe(true);
  });

  it("主键盘数字继续使用原有加速键和物理键码", () => {
    const event = new KeyboardEvent("keydown", {
      code: "Digit3",
      key: "3",
      ctrlKey: true,
      altKey: true,
    });
    const accelerator = eventToAccelerator(event, false);

    expect(accelerator).toBe("CommandOrControl+Alt+3");
    expect(matchParsed(event, parseAccelerator(accelerator!, false)!)).toBe(true);
  });

  it("全局录入仍要求 Ctrl、Alt 或 Meta 修饰键", () => {
    const onConfirm = vi.fn();
    recorder = useHotkeyRecorder({ isMac: false, requireModifier: true, onConfirm });
    recorder.start();

    window.dispatchEvent(numpadEvent("3", { ctrlKey: false, altKey: false }));
    window.dispatchEvent(numpadEvent("3", { ctrlKey: false, altKey: false, shiftKey: true }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(recorder.isRecording.value).toBe(true);

    window.dispatchEvent(numpadEvent("3"));

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("CommandOrControl+Alt+num3");
  });

  it("不区分 Electron 小键盘标识大小写并在显示时区分主键盘数字", () => {
    expect(parseAccelerator("Ctrl+Alt+NUM3", false)?.code).toBe("Numpad3");
    expect(normalizeAccelerator("CommandOrControl+Alt+Numpad3")).toBe("CommandOrControl+Alt+num3");
    expect(formatAccelerator("CommandOrControl+Alt+num3", false)).toBe("Ctrl + Alt + Numpad3");
    expect(formatAccelerator("CommandOrControl+Alt+3", false)).toBe("Ctrl + Alt + 3");
  });
});
