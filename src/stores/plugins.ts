import type { PluginInfo, MarketPlugin } from "@shared/types/plugin";

/** 插件管理 Pinia store */
export const usePluginsStore = defineStore("plugins", () => {
  const list = shallowRef<PluginInfo[]>([]);
  const loaded = ref(false);
  const marketPlugins = shallowRef<MarketPlugin[]>([]);
  const marketLoaded = ref(false);
  let unsubscribe: (() => void) | null = null;

  /** 仅 manifest.type 不为 "control" 的插件（音源类，含 type 缺省） */
  const sourcePlugins = computed(() =>
    list.value.filter((info) => info.manifest.type !== "control"),
  );

  /** manifest.type === "control" 的插件（控制类） */
  const controlPlugins = computed(() =>
    list.value.filter((info) => info.manifest.type === "control"),
  );

  /** 启用且就绪的插件贡献的歌曲菜单项，按插件归组（无 ui 权限的已被主进程过滤为空，不在此出现） */
  const menuContributions = computed(() =>
    list.value
      .filter(
        (info) =>
          info.enabled && info.status.state === "ready" && (info.status.menus?.length ?? 0) > 0,
      )
      .map((info) => ({
        pluginId: info.manifest.id,
        pluginName: info.manifest.name,
        menus: info.status.state === "ready" ? (info.status.menus ?? []) : [],
      })),
  );

  /** 拉取列表并建立状态订阅 */
  const load = async (): Promise<void> => {
    list.value = await window.api.plugins.list();
    loaded.value = true;
    if (!unsubscribe) {
      unsubscribe = window.api.plugins.onStatus((info) => {
        const next = list.value.slice();
        const idx = next.findIndex((item) => item.manifest.id === info.manifest.id);
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

  /** 从远端 URL 下载并导入 */
  const installFromUrl = async (
    url: string,
  ): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const res = await window.api.plugins.installFromUrl(url);
    if (res.ok) await load();
    return res;
  };

  /** 拉取插件市场列表 */
  const fetchMarket = async (force = false): Promise<{ ok: boolean; error?: string }> => {
    if (marketLoaded.value && !force) return { ok: true };
    const res = await window.api.plugins.market();
    if (res.ok) {
      marketPlugins.value = res.plugins;
      marketLoaded.value = true;
    }
    return { ok: res.ok, error: res.error };
  };

  /** 从市场安装 / 更新 */
  const installFromMarket = (
    plugin: MarketPlugin,
  ): Promise<{ ok: boolean; id?: string; error?: string }> => installFromUrl(plugin.updateUrl);

  const uninstall = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await window.api.plugins.uninstall(id);
    if (res.ok) list.value = list.value.filter((info) => info.manifest.id !== id);
    return res;
  };

  /**
   * 启用或禁用指定插件
   * @param id - 插件 ID
   * @param enabled - 目标启用状态
   */
  const setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    const info = list.value.find((item) => item.manifest.id === id);
    if (!info) return;
    // 本地先改，开关即时反映
    list.value = list.value.map((item) => (item.manifest.id === id ? { ...item, enabled } : item));
    await window.api.plugins.setEnabled(id, enabled);
  };

  /**
   * 写入控制类插件的单个配置项。
   * @param id - 插件 ID
   * @param key - 配置项 key
   * @param value - 新值
   */
  const setSetting = async (id: string, key: string, value: unknown): Promise<void> => {
    list.value = list.value.map((info) =>
      info.manifest.id === id
        ? { ...info, settingsValues: { ...(info.settingsValues ?? {}), [key]: value } }
        : info,
    );
    await window.api.plugins.setSetting(id, key, value);
  };

  /**
   * 手动检查插件更新：有新版时用返回的最新信息替换列表项，卡片随即显示更新提示。
   * @param id - 插件 ID
   * @returns ok 是否成功联网比对；hasUpdate 是否发现新版
   */
  const checkUpdate = async (
    id: string,
  ): Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo; error?: string }> => {
    const res = await window.api.plugins.checkUpdate(id);
    if (res.plugin) {
      const next = list.value.slice();
      const idx = next.findIndex((item) => item.manifest.id === id);
      if (idx >= 0) next[idx] = res.plugin;
      list.value = next;
    }
    return res;
  };

  /**
   * 一键更新插件：拉取 updateUrl 原地覆盖，成功后用返回的最新信息替换列表项。
   * @param id - 插件 ID
   * @returns ok 成功;失败时 fallbackUrl 为可手动打开的更新地址(若有)
   */
  const applyUpdate = async (
    id: string,
  ): Promise<{ ok: boolean; plugin?: PluginInfo; error?: string; fallbackUrl?: string }> => {
    const res = await window.api.plugins.applyUpdate(id);
    if (res.ok && res.plugin) {
      const next = list.value.slice();
      const idx = next.findIndex((item) => item.manifest.id === id);
      if (idx >= 0) next[idx] = res.plugin;
      list.value = next;
    }
    return res;
  };

  const dispose = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    list,
    loaded,
    sourcePlugins,
    controlPlugins,
    menuContributions,
    marketPlugins,
    fetchMarket,
    installFromMarket,
    load,
    pickAndInstall,
    installFromUrl,
    uninstall,
    setEnabled,
    setSetting,
    checkUpdate,
    applyUpdate,
    dispose,
  };
});
