import type { PluginInfo } from "@shared/types/plugin";

/** 插件管理 Pinia store */
export const usePluginsStore = defineStore("plugins", () => {
  const list = shallowRef<PluginInfo[]>([]);
  const loaded = ref(false);
  let unsubscribe: (() => void) | null = null;

  /** 拉取列表并建立状态订阅 */
  const load = async (): Promise<void> => {
    list.value = await window.api.plugins.list();
    loaded.value = true;
    if (!unsubscribe) {
      unsubscribe = window.api.plugins.onStatus((info) => {
        const next = list.value.slice();
        const idx = next.findIndex((i) => i.manifest.id === info.manifest.id);
        if (idx >= 0) next[idx] = info;
        else next.push(info);
        list.value = next;
      });
    }
  };

  /** 通过原生文件选择框导入插件 */
  const pickAndInstall = async (): Promise<{
    ok: boolean;
    id?: string;
    error?: string;
    cancelled?: boolean;
  }> => {
    const res = await window.api.plugins.pickAndInstall();
    if (res.ok) await load();
    return res;
  };

  const uninstall = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await window.api.plugins.uninstall(id);
    if (res.ok) list.value = list.value.filter((i) => i.manifest.id !== id);
    return res;
  };

  const setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    await window.api.plugins.setEnabled(id, enabled);
    const next = list.value.slice();
    const idx = next.findIndex((i) => i.manifest.id === id);
    if (idx >= 0) {
      next[idx] = { ...next[idx], enabled };
      list.value = next;
    }
  };

  const dispose = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  return { list, loaded, load, pickAndInstall, uninstall, setEnabled, dispose };
});
