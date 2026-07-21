import type { SettingCategory, SettingItem } from "@/types/settings-schema";

/**
 * 从 SettingCategory 中按 key 顺序挑选顶层 SettingItem
 * 找不到的 key 静默跳过（用于平台条件项等场景，如非 Win 平台的 taskbarLyricEnabled）
 * @param category 设置分类
 * @param keys 需要挑选的 item.key 列表，顺序即输出顺序
 * @returns 选中且存在的 SettingItem 数组（含其 children，由 SettingsItem 自动渲染）
 */
export const pickItems = (category: SettingCategory, keys: string[]): SettingItem[] => {
  const items = category.sections?.flatMap((s) => s.items) ?? [];
  const map = new Map(items.map((item) => [item.key, item]));
  return keys.map((k) => map.get(k)).filter((v): v is SettingItem => !!v);
};
