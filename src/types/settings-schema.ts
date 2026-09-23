import type { Component } from "vue";

/** 设置项控件类型 */
export type SettingWidgetType =
  "switch" | "select" | "slider" | "color" | "button" | "custom" | "text" | "number";

/** 选择项 */
export interface SettingOption {
  value: string | number | boolean;
  /** i18n key */
  labelKey?: string;
  /** 字面 label */
  label?: string;
}

/** 设置项变更前的确认配置 */
export interface SettingConfirm {
  /** 仅当新值满足条件时才确认 */
  when?: (nextValue: unknown) => boolean;
  /** 标题 i18n key */
  titleKey?: string;
  /** 正文 i18n key */
  contentKey: string;
  /** 对话框类型，默认 warning */
  type?: "default" | "info" | "warning" | "error";
  /** 确认按钮文案 i18n key */
  confirmTextKey?: string;
  /** 取消按钮文案 i18n key */
  cancelTextKey?: string;
}

/** 设置项 */
export interface SettingItem {
  /** 唯一 key，同时作为 i18n 前缀：settings.{key}.label / .description */
  key: string;
  /** 控件类型 */
  type: SettingWidgetType;
  /** store 绑定路径，如 { store: "settings", path: "lyric.fontSize" } */
  binding?: { store: "settings" | "theme"; path: string };
  /** select 选项 */
  options?: SettingOption[];
  /** slider / number 数值边界 */
  min?: number;
  max?: number;
  step?: number;
  /** slider 刻度标记 */
  marks?: Record<number, string>;
  /** number 单位后缀 */
  unit?: string;
  /** number / 文本输入框的 placeholder */
  placeholderKey?: string;
  /** color 控件是否启用透明度（默认 true） */
  showAlpha?: boolean;
  /** color 控件输出格式（默认 rgb） */
  colorFormat?: "rgb" | "hex";
  /** 默认值 */
  defaultValue?: unknown;
  /** 覆盖描述的 i18n key */
  descriptionKey?: string;
  /** 隐藏描述行 */
  hideDescription?: boolean;
  /** 条件禁用 */
  disabled?: () => boolean;
  /** 条件隐藏 */
  visible?: () => boolean;
  /** 变更前确认；用户取消则不应用本次变更（受控控件回弹原值） */
  confirm?: SettingConfirm;
  /** 点击或确认变更后的回调 */
  action?: (value?: unknown) => void | Promise<void>;
  /** custom 类型的组件 */
  component?: Component;
  /** custom 类型组件的属性 */
  componentProps?: Record<string, unknown>;
  /** custom：独占整行 */
  fullWidth?: boolean;
  /** 搜索用额外关键词（i18n keys） */
  keywords?: string[];
  /** 是否参与设置搜索，默认 true */
  searchable?: boolean;
  /** 子项 */
  children?: SettingItem[];
  /** 子项展开条件 */
  childrenCondition?: () => boolean;
  /** 是否完全隐藏子项 */
  hideChildren?: boolean;
  /** 标题旁的徽标 */
  tag?: SettingTag;
}

/** 标题旁徽标配置 */
export interface SettingTag {
  text: string;
  type?: "default" | "primary" | "cover" | "info" | "success" | "warning" | "error";
}

/** 设置分区 */
export interface SettingSection {
  /** i18n key: settings.section.{id} */
  id: string;
  items: SettingItem[];
  /** 标题旁的徽标 */
  tag?: SettingTag;
  /** 条件隐藏分区 */
  visible?: () => boolean;
}

/** 设置分类 */
export interface SettingCategory {
  /** i18n key: settings.group.{id}，同时作为菜单 key */
  id: string;
  icon: Component;
  /** 声明式区块 */
  sections?: SettingSection[];
  /** 整页自定义组件 */
  component?: Component;
}
