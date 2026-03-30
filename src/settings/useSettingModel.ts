import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { computed, type WritableComputedRef } from "vue";

/** 按路径读取嵌套属性 */
const getByPath = (obj: Record<string, any>, path: string): any => {
  return path.split(".").reduce((o, k) => o?.[k], obj);
};

/** 按路径设置嵌套属性 */
const setByPath = (obj: Record<string, any>, path: string, value: any): void => {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
};

/**
 * 根据 binding 配置创建与 store 双向绑定的 computed
 * 仅在 SettingsItem 组件内按需调用
 */
export const useSettingModel = (binding: {
  store: "settings" | "theme";
  path: string;
}): WritableComputedRef<any> => {
  if (binding.store === "theme") {
    const store = useThemeStore();
    return computed({
      get: () => getByPath(store, binding.path),
      set: (v) => setByPath(store as Record<string, any>, binding.path, v),
    });
  }

  const store = useSettingsStore();

  // system.* 路径需要走 IPC 持久化
  if (binding.path.startsWith("system.")) {
    const ipcPath = binding.path.slice(7); // 去掉 "system." 前缀
    return computed({
      get: () => getByPath(store.system, ipcPath),
      set: (v) => store.setSystem(ipcPath, v),
    });
  }

  return computed({
    get: () => getByPath(store, binding.path),
    set: (v) => {
      setByPath(store as Record<string, any>, binding.path, v);
      store.afterLocalChange(binding.path, v);
    },
  });
};
