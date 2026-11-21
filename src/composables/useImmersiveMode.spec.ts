import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImmersiveMode } from "./useImmersiveMode";

const mocks = vi.hoisted(() => ({
  isMac: true,
  setVisible: vi.fn(),
}));
let settings: { player: { autoImmersive: boolean } };
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/utils/config", () => ({
  /** 是否启用 macOS 原生按钮同步 */
  get isMac() {
    return mocks.isMac;
  },
}));

let wrapper: VueWrapper | undefined;
const expanded = ref(true);
let controls: ReturnType<typeof useImmersiveMode>;

/** 挂载沉浸逻辑，触发真实的组件生命周期与响应式更新 */
const mountControls = (): void => {
  wrapper = mount({
    /** 初始化播放器控件状态 */
    setup() {
      controls = useImmersiveMode(expanded);
      return () => null;
    },
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.isMac = true;
  mocks.setVisible.mockClear();
  settings = reactive({ player: { autoImmersive: true } });
  expanded.value = true;
  vi.stubGlobal("api", { window: { setTrafficLightsVisible: mocks.setVisible } });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("沉浸模式原生窗口按钮", () => {
  it("移出立即隐藏，移入恢复，闲置后随播放控件隐藏", async () => {
    mountControls();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
    controls.onPlayerMouseLeave();
    await nextTick();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(false);
    controls.onMainMove();
    await nextTick();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.setVisible).toHaveBeenLastCalledWith(false);
    controls.onMainMove();
    await nextTick();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("悬停控制栏时保持显示，离开后重新计时", async () => {
    mountControls();
    controls.onBarEnter();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.setVisible.mock.calls).toEqual([[true]]);
    controls.onBarLeave();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("连续鼠标移动只在显隐状态改变时发送消息", async () => {
    mountControls();
    for (let index = 0; index < 10; index++) controls.onMainMove();
    await nextTick();
    expect(mocks.setVisible.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(3000);
    for (let index = 0; index < 10; index++) controls.onMainMove();
    await nextTick();
    expect(mocks.setVisible.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("收起播放器、关闭自动沉浸或卸载时恢复按钮并停止计时", async () => {
    mountControls();
    controls.onPlayerMouseLeave();
    await nextTick();
    expanded.value = false;
    await nextTick();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
    expanded.value = true;
    controls.onPlayerMouseLeave();
    await nextTick();
    settings.player.autoImmersive = false;
    await nextTick();
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
    settings.player.autoImmersive = true;
    controls.onMainMove();
    wrapper!.unmount();
    wrapper = undefined;
    expect(mocks.setVisible).toHaveBeenLastCalledWith(true);
    const count = mocks.setVisible.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.setVisible).toHaveBeenCalledTimes(count);
  });

  it("其他平台不发送原生按钮同步消息", async () => {
    mocks.isMac = false;
    mountControls();
    controls.onPlayerMouseLeave();
    await nextTick();
    expect(mocks.setVisible).not.toHaveBeenCalled();
  });
});
