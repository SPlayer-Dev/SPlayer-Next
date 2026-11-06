import type { Component } from "vue";
import type { SystemConfig } from "@shared/types/settings";
import IconLucideHome from "~icons/lucide/home";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideUser from "~icons/lucide/user";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideChartPie from "~icons/lucide/chart-pie";
import IconLucideLibrary from "~icons/lucide/library";
import IconMaterialSymbolsFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideStar from "~icons/lucide/star";
import IconLucideHistory from "~icons/lucide/history";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideCloud from "~icons/lucide/cloud";

/** 侧边栏固定导航项元数据 */
export interface SidebarNavEntry {
  /** 路由路径，同时作为菜单 key */
  key: string;
  /** i18n key */
  labelKey: string;
  icon: Component;
  /** 固定显示，不允许隐藏 */
  pinned?: true;
  /** 依赖的可开关功能，功能关闭时入口不可用 */
  feature?: "download" | "streaming";
}

const SIDEBAR_NAV_ENTRIES: SidebarNavEntry[] = [
  { key: "/", labelKey: "nav.home", icon: IconLucideHome, pinned: true },
  { key: "/library", labelKey: "nav.library", icon: IconLucideMusic },
  { key: "/artists/local", labelKey: "artist.label", icon: IconLucideUser },
  { key: "/albums/local", labelKey: "album.label", icon: IconLucideDisc3 },
  { key: "/folders", labelKey: "folder.label", icon: IconLucideFolder },
  { key: "/stats", labelKey: "stats.label", icon: IconLucideChartPie },
  { key: "/liked", labelKey: "nav.liked", icon: IconMaterialSymbolsFavoriteOutline },
  { key: "/favorites", labelKey: "nav.favorites", icon: IconLucideStar },
  { key: "/cloud", labelKey: "nav.cloud", icon: IconLucideCloud },
  { key: "/download", labelKey: "nav.download", icon: IconLucideDownload, feature: "download" },
  { key: "/streaming", labelKey: "nav.streaming", icon: IconLucideLibrary, feature: "streaming" },
  { key: "/history", labelKey: "nav.history", icon: IconLucideHistory },
];

/** key → 导航项元数据 */
export const SIDEBAR_NAV_META: Record<string, SidebarNavEntry> = Object.fromEntries(
  SIDEBAR_NAV_ENTRIES.map((entry) => [entry.key, entry]),
);

/**
 * 导航项依赖的功能是否已关闭
 * @param entry - 导航项
 * @param system - 系统配置
 * @returns 功能关闭时为 true
 */
export const isNavFeatureOff = (entry: SidebarNavEntry, system: SystemConfig): boolean =>
  !!entry.feature && !system[entry.feature].enabled;

/**
 * 按存档顺序重排列表：存档中不存在的项排在最前
 * 其余项按存档顺序跟随；空存档返回原列表
 * @param items - 自然顺序列表
 * @param order - 存档的 key 顺序
 * @returns 重排后的列表
 */
export const applySavedOrder = <T extends { key: string }>(items: T[], order: string[]): T[] => {
  if (order.length === 0) return items;
  const map = new Map(items.map((item) => [item.key, item]));
  const ordered: T[] = [];
  for (const key of order) {
    const item = map.get(key);
    if (!item) continue;
    ordered.push(item);
    map.delete(key);
  }
  return [...map.values(), ...ordered];
};
