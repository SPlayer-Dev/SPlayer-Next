import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import IconLucideMonitor from "~icons/lucide/monitor";

const desktopLyricSection: SettingSection = {
  id: "desktopLyric",
  tag: { text: "Beta" },
  items: [
    {
      key: "desktopLyricEnabled",
      type: "switch",
      binding: { store: "settings", path: "isDesktopLyricOpen" },
      defaultValue: false,
    },
    {
      key: "desktopLyricFontSize",
      type: "select",
      binding: { store: "settings", path: "system.desktopLyric.fontSize" },
      defaultValue: 24,
      options: Array.from({ length: 96 - 20 + 1 }, (_, i) => {
        const n = 20 + i;
        return { value: n, label: `${n} px` };
      }),
    },
    {
      key: "desktopLyricFontWeight",
      type: "slider",
      binding: { store: "settings", path: "system.desktopLyric.fontWeight" },
      min: 100,
      max: 900,
      step: 100,
      defaultValue: 600,
      marks: { 100: "100", 400: "400", 700: "700", 900: "900" },
    },
    {
      key: "desktopLyricDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.doubleLine" },
      defaultValue: true,
    },
    {
      key: "desktopLyricAlign",
      type: "select",
      binding: { store: "settings", path: "system.desktopLyric.align" },
      options: [
        { value: "left", labelKey: "settings.desktopLyricAlign.left" },
        { value: "center", labelKey: "settings.desktopLyricAlign.center" },
        { value: "right", labelKey: "settings.desktopLyricAlign.right" },
        { value: "justify", labelKey: "settings.desktopLyricAlign.justify" },
      ],
      defaultValue: "center",
    },
    {
      key: "desktopLyricWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.wordByWord" },
      defaultValue: true,
    },
    {
      key: "desktopLyricAutoGenerateWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.autoGenerateWordByWord" },
      defaultValue: true,
    },
    {
      key: "desktopLyricShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.showTranslation" },
      defaultValue: true,
    },
    {
      key: "desktopLyricPlayedColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.playedColor" },
      defaultValue: "#ffffff",
      showAlpha: false,
    },
    {
      key: "desktopLyricUnplayedColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.unplayedColor" },
      defaultValue: "#7d7d7d",
      showAlpha: false,
    },
    {
      key: "desktopLyricStrokeColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.strokeColor" },
      defaultValue: "rgba(0, 0, 0, 0.5)",
    },
    {
      key: "desktopLyricBackgroundMask",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.backgroundMask" },
      defaultValue: false,
      children: [
        {
          key: "desktopLyricBackgroundMaskColor",
          type: "color",
          binding: { store: "settings", path: "system.desktopLyric.backgroundMaskColor" },
          defaultValue: "rgba(0, 0, 0, 0.3)",
        },
      ],
    },
    {
      key: "desktopLyricAlwaysShowSongInfo",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.alwaysShowSongInfo" },
      defaultValue: false,
    },
    {
      key: "desktopLyricAnimation",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.animation" },
      defaultValue: true,
    },
    {
      key: "desktopLyricLimitBounds",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.limitBounds" },
      defaultValue: false,
    },
    {
      key: "desktopLyricAlwaysOnTop",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.alwaysOnTop" },
      defaultValue: true,
    },
    {
      key: "desktopLyricLocked",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.locked" },
      defaultValue: false,
    },
  ],
};

const dynamicIslandSection: SettingSection = {
  id: "dynamicIsland",
  tag: { text: "Beta" },
  items: [
    {
      key: "dynamicIslandEnabled",
      type: "switch",
      binding: { store: "settings", path: "isDynamicIslandOpen" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandScale",
      type: "slider",
      binding: { store: "settings", path: "system.dynamicIsland.scale" },
      min: 0.5,
      max: 2,
      step: 0.05,
      defaultValue: 1,
      marks: { 0.5: "50%", 1: "100%", 2: "200%" },
    },
    {
      key: "dynamicIslandFontWeight",
      type: "slider",
      binding: { store: "settings", path: "system.dynamicIsland.fontWeight" },
      min: 100,
      max: 900,
      step: 100,
      defaultValue: 500,
      marks: { 100: "100", 500: "500", 900: "900" },
    },
    {
      key: "dynamicIslandWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.wordByWord" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.doubleLine" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.showTranslation" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandPlayedColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.playedColor" },
      defaultValue: "rgba(255, 255, 255, 1)",
      showAlpha: false,
    },
    {
      key: "dynamicIslandUnplayedColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.unplayedColor" },
      defaultValue: "rgba(255, 255, 255, 0.5)",
    },
    {
      key: "dynamicIslandBackgroundColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.backgroundColor" },
      defaultValue: "rgba(0, 0, 0, 1)",
    },
    {
      key: "dynamicIslandAlwaysOnTop",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.alwaysOnTop" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandSnapCentered",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.snapCentered" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandNonOcclusive",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.nonOcclusive" },
      defaultValue: false,
    },
  ],
};

/** Win 平台限定 */
const taskbarLyricSection: SettingSection = {
  id: "taskbarLyric",
  tag: { text: "Beta" },
  items: [
    {
      key: "taskbarLyricEnabled",
      type: "switch",
      binding: { store: "settings", path: "isTaskbarLyricOpen" },
      defaultValue: false,
    },
    {
      key: "taskbarLyricPosition",
      type: "select",
      binding: { store: "settings", path: "system.taskbarLyric.position" },
      options: [
        { value: "auto", labelKey: "settings.taskbarLyricPosition.auto" },
        { value: "left", labelKey: "settings.taskbarLyricPosition.left" },
        { value: "right", labelKey: "settings.taskbarLyricPosition.right" },
      ],
      defaultValue: "auto",
    },
    {
      key: "taskbarLyricAutoMaxWidth",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.autoMaxWidth" },
      defaultValue: true,
      childrenCondition: () => useSettingsStore().system.taskbarLyric.autoMaxWidth === false,
      children: [
        {
          key: "taskbarLyricMaxWidth",
          type: "slider",
          binding: { store: "settings", path: "system.taskbarLyric.maxWidth" },
          min: 200,
          max: 800,
          step: 20,
          defaultValue: 400,
          marks: { 200: "200", 400: "400", 800: "800" },
        },
      ],
    },
    {
      key: "taskbarLyricColorMode",
      type: "select",
      binding: { store: "settings", path: "system.taskbarLyric.colorMode" },
      options: [
        { value: "taskbar", labelKey: "settings.taskbarLyricColorMode.taskbar" },
        { value: "light", labelKey: "settings.taskbarLyricColorMode.light" },
        { value: "dark", labelKey: "settings.taskbarLyricColorMode.dark" },
      ],
      defaultValue: "taskbar",
    },
    {
      key: "taskbarLyricFontSize",
      type: "slider",
      binding: { store: "settings", path: "system.taskbarLyric.fontSize" },
      min: 12,
      max: 20,
      step: 1,
      defaultValue: 14,
      marks: { 12: "12", 14: "14", 17: "17", 20: "20" },
    },
    {
      key: "taskbarLyricShowCover",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.showCover" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.wordByWord" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.doubleLine" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.showTranslation" },
      defaultValue: true,
    },
  ],
};

const externalLyricCategory: SettingCategory = {
  id: "externalLyric",
  icon: IconLucideMonitor,
  sections: [
    desktopLyricSection,
    dynamicIslandSection,
    // taskbarLyric 仅 Windows 可用
    ...(navigator.platform.startsWith("Win") ? [taskbarLyricSection] : []),
  ],
};

export default externalLyricCategory;
