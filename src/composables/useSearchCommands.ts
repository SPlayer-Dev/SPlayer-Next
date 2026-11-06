import type { Component, Ref } from "vue";
import type { HotkeyActionId } from "@shared/types/hotkey";
import { HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";
import { SIDEBAR_NAV_META, isNavFeatureOff } from "@/utils/sidebarNav";
import { useSettingsStore } from "@/stores/settings";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { dispatch } from "@/core/hotkey/registry";
import { useHotkeyStore } from "@/stores/hotkey";
import { formatAccelerator } from "@shared/utils/accelerator";
import { isMac } from "@/utils/config";
import IconLucideSettings from "~icons/lucide/settings";
import IconLucideCompass from "~icons/lucide/compass";
import IconLucideCommand from "~icons/lucide/command";

type SearchSettingsFn = typeof import("@/settings/searchSettings").searchSettings;

/** 设置结果条数上限 */
const SETTING_LIMIT = 8;

/** 搜索窗内无意义的动作：搜索窗本身已打开，页内搜索需要页面焦点 */
const EXCLUDED_ACTIONS = new Set<HotkeyActionId>(["view.openSearch", "view.searchInPage"]);

/** 命令项 */
export interface SearchCommandItem {
  id: string;
  label: string;
  subtitle?: string;
  icon?: Component;
  /** 已格式化的应用内快捷键 */
  shortcut?: string;
  /** 是否为本地曲库结果 */
  local?: boolean;
  /** 右侧显示跳转箭头 */
  arrow?: boolean;
  action: () => void;
}

/** 命令分组 */
export interface SearchCommandSection {
  kind: string;
  icon: Component;
  label: string;
  items: SearchCommandItem[];
}

/**
 * 搜索窗命令模式：设置项、页面跳转与常用操作
 * @param keyword - 去掉前缀「/」并转小写后的命令关键词
 * @param active - 是否处于命令模式
 * @param close - 关闭搜索窗
 * @returns 过滤后的命令分组
 */
export const useSearchCommands = (
  keyword: Ref<string>,
  active: Ref<boolean>,
  close: () => void,
) => {
  const { t, te } = useI18n();
  const router = useRouter();
  const settingsDialog = useSettingsDialog();
  const hotkey = useHotkeyStore();
  const settings = useSettingsStore();

  /**
   * 动作当前的应用内快捷键
   * @param id - 动作 ID
   * @returns 格式化后的快捷键，未绑定为空串
   */
  const shortcutOf = (id: HotkeyActionId): string =>
    formatAccelerator(hotkey.bindings[id]?.inApp ?? null, isMac);

  /** 设置 schema 会连带引入全部设置组件，首次进入命令模式时才加载 */
  const searchSettings = shallowRef<SearchSettingsFn | null>(null);
  watch(
    active,
    async (isActive) => {
      if (!isActive || searchSettings.value) return;
      searchSettings.value = (await import("@/settings/searchSettings")).searchSettings;
    },
    { immediate: true },
  );

  /**
   * 关闭搜索窗后执行
   * @param run - 要执行的动作
   */
  const closeThen = (run: () => void) => (): void => {
    close();
    run();
  };

  const sections = computed<SearchCommandSection[]>(() => {
    const word = keyword.value;
    if (!active.value || !word) return [];
    const settingItems = searchSettings.value
      ? searchSettings
          .value(
            word,
            (key) => t(key),
            (key) => te(key),
          )
          .slice(0, SETTING_LIMIT)
          .map<SearchCommandItem>((result) => ({
            id: `setting-${result.categoryId}-${result.itemKey}`,
            label: result.label,
            subtitle: result.categoryLabel,
            action: closeThen(() =>
              settingsDialog.show(result.categoryId, result.itemKey, result.parentKeys),
            ),
          }))
      : [];
    const pageItems = Object.values(SIDEBAR_NAV_META)
      .filter((entry) => !isNavFeatureOff(entry, settings.system))
      .map((entry) => ({ entry, label: t(entry.labelKey) }))
      .filter(({ entry, label }) => `${label} ${entry.key}`.toLowerCase().includes(word))
      .map<SearchCommandItem>(({ entry, label }) => ({
        id: `page-${entry.key}`,
        label,
        subtitle: entry.key,
        icon: entry.icon,
        action: closeThen(() => router.push(entry.key)),
      }));
    const actionItems = HOTKEY_ACTIONS.filter((meta) => !EXCLUDED_ACTIONS.has(meta.id))
      .map((meta) => ({ meta, label: t(meta.labelKey) }))
      .filter(({ label }) => label.toLowerCase().includes(word))
      .map<SearchCommandItem>(({ meta, label }) => ({
        id: `action-${meta.id}`,
        label,
        shortcut: shortcutOf(meta.id),
        action: closeThen(() => dispatch(meta.id)),
      }));
    return [
      {
        kind: "settings",
        icon: IconLucideSettings,
        label: t("settings.title"),
        items: settingItems,
      },
      {
        kind: "pages",
        icon: IconLucideCompass,
        label: t("nav.searchSection.pages"),
        items: pageItems,
      },
      {
        kind: "actions",
        icon: IconLucideCommand,
        label: t("nav.searchSection.actions"),
        items: actionItems,
      },
    ].filter((section) => section.items.length > 0);
  });

  return { sections };
};
