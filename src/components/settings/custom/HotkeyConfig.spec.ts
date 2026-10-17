import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defaultHotkeyConfig } from "@shared/defaults/hotkeys";
import type { HotkeyActionId, HotkeyBinding, HotkeyConfig } from "@shared/types/hotkey";
import { useHotkeyStore } from "@/stores/hotkey";
import { installHotkeyManager, uninstallHotkeyManager } from "@/core/hotkey/manager";
import HotkeyConfigComponent from "./HotkeyConfig.vue";

const mocks = vi.hoisted(() => ({
  setRecording: vi.fn(),
  probe: vi.fn(),
  set: vi.fn(),
  error: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/composables/useToast", () => ({ toast: { error: mocks.error } }));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: vi.fn() } }));
vi.mock("@/utils/config", () => ({ isMac: false }));
vi.mock("@/core/hotkey/registry", () => ({
  buildRegistry: vi.fn(),
  dispatch: mocks.dispatch,
}));

const Input = defineComponent({
  name: "SInput",
  props: { modelValue: String, disabled: Boolean },
  emits: ["click", "blur"],
  setup:
    (props, { emit }) =>
    () =>
      h("input", {
        value: props.modelValue,
        disabled: props.disabled,
        onClick: () => emit("click"),
        onBlur: () => emit("blur"),
      }),
});

let wrapper: ReturnType<typeof mount>;
let config: HotkeyConfig;
let triggerGlobal: (id: HotkeyActionId) => void;

/** 按当前显示值定位待录入的快捷键输入框。 */
const field = (value: string) =>
  wrapper.findAll<HTMLInputElement>("input").find((input) => input.element.value === value)!;

/** 将小键盘组合发给真实录入器，验证保存与冲突处理。 */
const pressNumpad = (digit: string): void => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: `Numpad${digit}`,
      key: digit,
      ctrlKey: true,
      altKey: true,
    }),
  );
};

beforeEach(async () => {
  vi.clearAllMocks();
  config = {
    ...defaultHotkeyConfig,
    bindings: {
      ...defaultHotkeyConfig.bindings,
      "player.prev": { inApp: "CommandOrControl+Left", global: "CommandOrControl+Alt+num3" },
      "player.next": { inApp: "CommandOrControl+Right", global: "CommandOrControl+Alt+num1" },
    },
  };
  mocks.setRecording.mockResolvedValue(undefined);
  mocks.probe.mockResolvedValue(true);
  mocks.dispatch.mockReturnValue(true);
  mocks.set.mockImplementation(async (id: HotkeyActionId, binding: HotkeyBinding) => {
    config = { ...config, bindings: { ...config.bindings, [id]: binding } };
    return config;
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      hotkey: {
        getAll: async () => config,
        getConflicts: async () => [],
        onConflicts: () => () => {},
        onTrigger: (callback: typeof triggerGlobal) => {
          triggerGlobal = callback;
          return () => {};
        },
        setRecording: mocks.setRecording,
        probe: mocks.probe,
        set: mocks.set,
      },
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  await useHotkeyStore().init();
  installHotkeyManager();
  wrapper = mount(HotkeyConfigComponent, {
    global: {
      plugins: [
        pinia,
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: { SInput: Input, SSwitch: true, SButton: true, SDivider: true },
    },
  });
});

afterEach(async () => {
  wrapper.unmount();
  uninstallHotkeyManager();
  await flushPromises();
  useHotkeyStore().$dispose();
});

describe("快捷键录入与冲突处理", () => {
  it("重复全局键只提示冲突，不保存、不执行已有动作，并恢复注册", async () => {
    await field("Ctrl + Alt + Numpad3").trigger("click");
    await flushPromises();
    triggerGlobal("player.next");
    pressNumpad("1");
    await flushPromises();

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(config.bindings["player.prev"].global).toBe("CommandOrControl+Alt+num3");
    expect(field("Ctrl + Alt + Numpad3").exists()).toBe(true);
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);

    triggerGlobal("player.next");
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith("player.next");
  });

  it("保存新绑定后恢复，保存期间到达的全局事件被忽略", async () => {
    let finishProbe!: (available: boolean) => void;
    mocks.probe.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishProbe = resolve;
      }),
    );
    await field("Ctrl + Alt + Numpad3").trigger("click");
    await flushPromises();
    pressNumpad("5");
    triggerGlobal("player.next");

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(useHotkeyStore().isRecording).toBe(true);
    expect(mocks.set).not.toHaveBeenCalled();

    finishProbe(true);
    await flushPromises();

    expect(mocks.set).toHaveBeenCalledExactlyOnceWith("player.prev", {
      inApp: "CommandOrControl+Left",
      global: "CommandOrControl+Alt+num5",
    });
    expect(field("Ctrl + Alt + Numpad5").exists()).toBe(true);
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);
  });

  it("先清空一个绑定后可交换上一首和下一首", async () => {
    await field("Ctrl + Alt + Numpad3").trigger("click");
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backspace" }));
    await flushPromises();
    expect(config.bindings["player.prev"].global).toBeNull();

    await field("Ctrl + Alt + Numpad1").trigger("click");
    await flushPromises();
    pressNumpad("3");
    await flushPromises();
    expect(config.bindings["player.next"].global).toBe("CommandOrControl+Alt+num3");

    const emptyGlobal = wrapper.findAll<HTMLInputElement>("input").find((input) => {
      const row = input.element.parentElement?.parentElement;
      return input.element.value === "" && row?.textContent?.includes("actions.prev");
    })!;
    await emptyGlobal.trigger("click");
    await flushPromises();
    pressNumpad("1");
    await flushPromises();

    expect(config.bindings["player.prev"].global).toBe("CommandOrControl+Alt+num1");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("失焦取消录入后恢复旧绑定", async () => {
    const input = field("Ctrl + Alt + Numpad3");
    await input.trigger("click");
    await flushPromises();
    await input.trigger("blur");
    pressNumpad("5");
    await flushPromises();

    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);
    expect(useHotkeyStore().isRecording).toBe(false);
  });

  it("等待主进程解除注册时失焦，不会迟到启动录入", async () => {
    let finishPause!: () => void;
    mocks.setRecording.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPause = resolve;
        }),
    );
    const input = field("Ctrl + Alt + Numpad3");
    await input.trigger("click");
    expect(useHotkeyStore().isRecording).toBe(true);
    await input.trigger("blur");
    finishPause();
    await flushPromises();
    pressNumpad("5");
    await flushPromises();

    expect(mocks.set).not.toHaveBeenCalled();
    expect(useHotkeyStore().isRecording).toBe(false);
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);
  });

  it("卸载设置页面时取消录入并恢复全局快捷键", async () => {
    await field("Ctrl + Alt + Numpad3").trigger("click");
    await flushPromises();
    wrapper.unmount();
    await flushPromises();
    pressNumpad("5");

    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);
  });

  it("应用内录入期间也不执行已注册的应用内或全局动作", async () => {
    await field("Ctrl + ←").trigger("click");
    await flushPromises();
    triggerGlobal("player.next");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", ctrlKey: true }));
    await flushPromises();

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.setRecording.mock.calls).toEqual([[true], [false]]);
  });

  it("旧版应用内 Numpad 标识与新全局 num 标识仍按同一键检测冲突", () => {
    const store = useHotkeyStore();
    store.bindings["player.next"].inApp = "CommandOrControl+Alt+Numpad5";

    expect(store.findGlobalConflict("CommandOrControl+Alt+num5", "player.prev")).toEqual({
      id: "player.next",
      scope: "inApp",
    });
    expect(store.findInAppDuplicate("CommandOrControl+Alt+num5", "player.prev")).toBe(
      "player.next",
    );
  });
});
