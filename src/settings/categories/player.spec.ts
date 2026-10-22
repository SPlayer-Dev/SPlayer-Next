import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import SettingsItem from "@/components/settings/SettingsItem.vue";
import playerCategory from "./player";

const mocks = vi.hoisted(() => ({
  enabled: false as boolean | string,
  cache: { enabled: false, cacheStreaming: false },
  player: { preloadNextTrack: false, transitionMode: "none" },
  confirm: vi.fn(),
  setSystem: vi.fn(),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    system: { cache: { songCache: mocks.cache } },
    player: mocks.player,
    setSystem: mocks.setSystem,
  }),
}));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: mocks.confirm } }));
vi.mock("@/settings/useSettingModel", () => ({
  useSettingModel: () =>
    computed({
      get: () => mocks.enabled,
      set: (value: boolean | string) => {
        mocks.enabled = value;
      },
    }),
}));
vi.mock("@/components/settings/custom/DeviceSelector.vue", () => ({ default: {} }));
vi.mock("~icons/lucide/play", () => ({ default: {} }));
vi.mock("@/utils/config", () => ({ isWin: true }));
vi.mock("@/core/player", () => ({ getActiveDeviceId: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ setDeviceVolume: vi.fn() }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ volume: 1 }) }));

const item = playerCategory
  .sections!.flatMap((section) => section.items)
  .find((item) => item.key === "preloadNextTrack")!;
const transitionItem = playerCategory
  .sections!.flatMap((section) => section.items)
  .find((item) => item.key === "transitionMode")!;
const Switch = defineComponent({
  name: "SSwitch",
  emits: ["update:modelValue"],
  setup:
    (_props, { emit }) =>
    () =>
      h("button", { onClick: () => emit("update:modelValue", true) }, "enable"),
});
const Select = defineComponent({
  name: "SSelect",
  emits: ["update:modelValue"],
  setup:
    (_props, { emit }) =>
    () =>
      h("button", { onClick: () => emit("update:modelValue", "crossfade") }, "crossfade"),
});

describe("开启预载的缓存确认", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = false;
    mocks.cache = { enabled: false, cacheStreaming: false };
    mocks.player.preloadNextTrack = false;
    mocks.player.transitionMode = "none";
    mocks.setSystem.mockResolvedValue(undefined);
  });

  for (const confirmed of [false, true]) {
    it(confirmed ? "确认后开启预载及两项缓存" : "取消后不改变预载和缓存设置", async () => {
      mocks.confirm.mockResolvedValue(confirmed);
      const wrapper = mount(SettingsItem, {
        props: { item },
        global: {
          plugins: [
            createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
          ],
          stubs: { SSwitch: Switch },
        },
      });
      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(mocks.confirm).toHaveBeenCalledOnce();
      expect(mocks.enabled).toBe(confirmed);
      if (confirmed) {
        expect(mocks.setSystem.mock.calls).toEqual([
          ["cache.songCache.enabled", true],
          ["cache.songCache.cacheStreaming", true],
        ]);
      } else {
        expect(mocks.setSystem).not.toHaveBeenCalled();
      }
      wrapper.unmount();
    });
  }

  it("两项缓存已经开启时无需再次确认", () => {
    mocks.cache = { enabled: true, cacheStreaming: true };
    expect(item.confirm!.when!(true)).toBe(false);
    expect(item.confirm!.when!(false)).toBe(false);
  });
});

describe("播放过渡设置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = "none";
    mocks.cache = { enabled: false, cacheStreaming: false };
    mocks.player.preloadNextTrack = false;
    mocks.player.transitionMode = "none";
    mocks.setSystem.mockResolvedValue(undefined);
  });

  for (const confirmed of [false, true]) {
    it(confirmed ? "开启交叉过渡时启用预载和缓存" : "取消确认时保留无过渡", async () => {
      mocks.confirm.mockResolvedValue(confirmed);
      const wrapper = mount(SettingsItem, {
        props: { item: transitionItem },
        global: {
          plugins: [
            createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
          ],
          stubs: { SSelect: Select },
        },
      });
      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(mocks.enabled).toBe(confirmed ? "crossfade" : "none");
      expect(mocks.player.preloadNextTrack).toBe(confirmed);
      expect(mocks.setSystem).toHaveBeenCalledTimes(confirmed ? 2 : 0);
      wrapper.unmount();
    });
  }
});
