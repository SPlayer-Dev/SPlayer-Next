import type { Component } from "vue";

/** 设置项控件类型 */
export type SettingWidgetType = "switch" | "select" | "slider" | "color" | "button" | "custom";

/** 选择项（select 用） */
export interface SettingOption {
  value: string | number | boolean;
  /** i18n key */
  labelKey?: string;
  /** 字面 label */
  label?: string;
}

/** 设置项 */
export interface SettingItem {
  /** 唯一 key，同时作为 i18n 前缀：settings.{key}.label / .description */
  key: string;
  /** 控件类型 */
  type: SettingWidgetType;
  /** store 绑定路径，如 { store: "settings", path: "player.lyricMode" } */
  binding?: { store: "settings" | "theme"; path: string };
  /** select 选项 */
  options?: SettingOption[];
  /** slider 参数 */
  min?: number;
  max?: number;
  step?: number;
  /** slider 刻度标记 */
  marks?: Record<number, string>;
  /** color 控件是否启用透明度（默认 true） */
  showAlpha?: boolean;
  /** color 控件输出格式（默认 rgb） */
  colorFormat?: "rgb" | "hex";
  /** 默认值 */
  defaultValue?: unknown;
  /** 覆盖描述的 i18n key */
  descriptionKey?: string;
  /** 条件禁用 */
  disabled?: () => boolean;
  /** button 类型的点击回调 */
  action?: () => void;
  /** custom 类型的组件 */
  component?: Component;
  /** 搜索用额外关键词（i18n keys） */
  keywords?: string[];
  /** 子项（折叠展开） */
  children?: SettingItem[];
  /** 子项展开条件（默认：父级值为 true 时展开） */
  childrenCondition?: () => boolean;
  /** 标题旁的徽标 */
  tag?: SettingTag;
}

/** 标题旁徽标配置 */
export interface SettingTag {
  text: string;
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
}

/** 设置分区（卡片区块） */
export interface SettingSection {
  /** i18n key: settings.section.{id} */
  id: string;
  items: SettingItem[];
  /** 标题旁的徽标 */
  tag?: SettingTag;
}

/** 设置分类（左侧菜单项） */
export interface SettingCategory {
  /** i18n key: settings.group.{id}，同时作为菜单 key */
  id: string;
  icon: Component;
  sections: SettingSection[];
}
