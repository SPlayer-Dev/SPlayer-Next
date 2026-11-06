import { settingsSchema } from "@/settings/schema";
import type { SettingItem } from "@/types/settings-schema";

/** 设置搜索结果 */
export interface SettingSearchResult {
  categoryId: string;
  itemKey: string;
  parentKeys: string[];
  label: string;
  description: string;
  categoryLabel: string;
}

/**
 * 按标签、描述和关键词检索设置项
 * @param query - 搜索词
 * @param translate - i18n 翻译函数
 * @param hasKey - i18n 键是否存在
 * @returns 匹配的设置项
 */
export const searchSettings = (
  query: string,
  translate: (key: string) => string,
  hasKey: (key: string) => boolean,
): SettingSearchResult[] => {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];
  const out: SettingSearchResult[] = [];
  for (const cat of settingsSchema) {
    /**
     * 检索设置项及子项
     * @param items - 当前层设置项
     * @param parentKeys - 从外到内的父项键名
     */
    const searchItems = (items: SettingItem[], parentKeys: string[]): void => {
      for (const item of items) {
        if (item.visible && !item.visible()) continue;
        if (item.searchable !== false) {
          const labelKey = `settings.${item.key}.label`;
          const descriptionKey = item.descriptionKey ?? `settings.${item.key}.description`;
          const label = hasKey(labelKey) ? translate(labelKey) : "";
          const desc =
            !item.hideDescription && hasKey(descriptionKey) ? translate(descriptionKey) : "";
          const kw =
            item.keywords
              ?.filter((key) => hasKey(key))
              .map((key) => translate(key))
              .join(" ") ?? "";
          if (label && `${label} ${desc} ${kw}`.toLowerCase().includes(keyword)) {
            out.push({
              categoryId: cat.id,
              itemKey: item.key,
              parentKeys,
              label,
              description: desc,
              categoryLabel: translate(`settings.group.${cat.id}`),
            });
          }
        }
        if (item.children) {
          searchItems(item.children, [...parentKeys, item.key]);
        }
      }
    };
    for (const sec of cat.sections ?? []) {
      if (sec.visible && !sec.visible()) continue;
      searchItems(sec.items, []);
    }
  }
  return out;
};
