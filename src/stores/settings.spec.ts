import { createPinia, setActivePinia } from "pinia";
import persistedState from "pinia-plugin-persistedstate";
import { createApp } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

const noopUnsubscribe = (): void => undefined;

const apiMock = {
  config: { getAll: async () => ({}), set: () => {} },
  desktopLyric: { onConfigChange: noopUnsubscribe },
  dynamicIsland: { onConfigChange: noopUnsubscribe },
  window: {
    onDesktopLyricVisibilityChange: noopUnsubscribe,
    onDynamicIslandVisibilityChange: noopUnsubscribe,
    onTaskbarLyricVisibilityChange: noopUnsubscribe,
    isDesktopLyricOpen: () => Promise.resolve(false),
    isDynamicIslandOpen: () => Promise.resolve(false),
    isTaskbarLyricOpen: () => Promise.resolve(false),
  },
  player: { setFadeDuration: () => Promise.resolve() },
};

/** 构造已挂接持久化插件的 pinia；install(app) 把插件真正移入激活列表并触发 hydrate */
const installSettingsPinia = (): void => {
  const pinia = createPinia();
  pinia.use(persistedState);
  createApp({}).use(pinia);
  setActivePinia(pinia);
};

beforeEach(() => {
  window.api = apiMock as never;
  localStorage.clear();
  installSettingsPinia();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 读取持久化 store 里的 preset（含迁移后的原始键） */
const presetState = (): Record<string, unknown> =>
  useSettingsStore().$state.preset as Record<string, unknown>;

/** 读取 localStorage 中实际写入的 preset 存档 */
const persistedPreset = (): Record<string, unknown> => {
  const raw = localStorage.getItem("settings");
  return raw ? ((JSON.parse(raw) as { preset?: Record<string, unknown> }).preset ?? {}) : {};
};

describe("脏标开关旧存档迁移", () => {
  it("旧存档 showExplicitTag=false 迁移为 hideExplicitTag=true 并写回存档", () => {
    localStorage.setItem("settings", JSON.stringify({ preset: { showExplicitTag: false } }));

    const store = useSettingsStore();

    expect(store.preset.hideExplicitTag).toBe(true);
    expect(presetState()).not.toHaveProperty("showExplicitTag");
    expect(persistedPreset()).toMatchObject({ hideExplicitTag: true });
    expect(persistedPreset()).not.toHaveProperty("showExplicitTag");
  });

  it("旧存档 showExplicitTag=true 迁移为 hideExplicitTag=false 并写回存档", () => {
    localStorage.setItem("settings", JSON.stringify({ preset: { showExplicitTag: true } }));

    const store = useSettingsStore();

    expect(store.preset.hideExplicitTag).toBe(false);
    expect(presetState()).not.toHaveProperty("showExplicitTag");
    expect(persistedPreset()).toMatchObject({ hideExplicitTag: false });
    expect(persistedPreset()).not.toHaveProperty("showExplicitTag");
  });

  it("无旧键时保持默认 hideExplicitTag=false 且不额外写回存档", () => {
    localStorage.setItem("settings", JSON.stringify({ preset: {} }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const store = useSettingsStore();

    expect(store.preset.hideExplicitTag).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem("settings")).toBe(JSON.stringify({ preset: {} }));
  });
});
