import type { SettingCategory } from "@/types/settings-schema";
import { useThemeStore } from "@/stores/theme";
import FontConfig from "@/components/settings/custom/FontConfig.vue";
import BackgroundImagePicker from "@/components/settings/custom/BackgroundImagePicker.vue";
import IconLucidePalette from "~icons/lucide/palette";

const appearanceCategory: SettingCategory = {
  id: "appearance",
  icon: IconLucidePalette,
  sections: [
    {
      id: "theme",
      items: [
        {
          key: "themeMode",
          type: "select",
          binding: { store: "theme", path: "mode" },
          options: [
            { value: "light", labelKey: "settings.themeMode.light" },
            { value: "dark", labelKey: "settings.themeMode.dark" },
            { value: "system", labelKey: "settings.themeMode.system" },
          ],
          defaultValue: "system",
          // 图片背景下强制暗色，禁用此开关
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
        {
          key: "themeSource",
          type: "select",
          binding: { store: "theme", path: "source" },
          options: [
            { value: "default", labelKey: "settings.themeSource.default" },
            { value: "custom", labelKey: "settings.themeSource.custom" },
            { value: "cover", labelKey: "settings.themeSource.cover" },
            { value: "solid", labelKey: "settings.themeSource.solid" },
          ],
          defaultValue: "default",
          childrenCondition: () => useThemeStore().source === "custom",
          hideChildren: true,
          children: [
            {
              key: "customColor",
              type: "color",
              binding: { store: "theme", path: "customColor" },
              defaultValue: "#fe7971",
              showAlpha: false,
              colorFormat: "hex",
            },
          ],
        },
        {
          key: "globalTint",
          type: "switch",
          binding: { store: "theme", path: "globalTint" },
          defaultValue: false,
          // 图片背景下强制开启全局着色，禁用切换
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
      ],
    },
    {
      id: "appearanceStyle",
      items: [
        {
          key: "appearanceStyle",
          type: "select",
          binding: { store: "theme", path: "appearanceStyle" },
          options: [
            { value: "solid", labelKey: "settings.appearanceStyle.solid" },
            { value: "image", labelKey: "settings.appearanceStyle.image" },
          ],
          defaultValue: "solid",
          childrenCondition: () => useThemeStore().appearanceStyle === "image",
          hideChildren: true,
          children: [
            {
              key: "backgroundImage",
              type: "custom",
              component: BackgroundImagePicker,
            },
            {
              key: "backgroundBlur",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.blur" },
              min: 0,
              max: 80,
              step: 1,
              defaultValue: 0,
              marks: { 0: "0", 20: "20", 40: "40", 80: "80" },
            },
            {
              key: "backgroundDim",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.dim" },
              min: 0.3,
              max: 0.9,
              step: 0.05,
              defaultValue: 0.4,
              marks: { 0.3: "0.3", 0.4: "0.4", 0.9: "0.9" },
            },
            {
              key: "backgroundScale",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.scale" },
              min: 1,
              max: 2,
              step: 0.05,
              defaultValue: 1.2,
              marks: { 1: "1", 1.2: "1.2", 2: "2" },
            },
          ],
        },
      ],
    },
    {
      id: "font",
      items: [
        {
          key: "fontConfig",
          type: "custom",
          component: FontConfig,
        },
      ],
    },
    {
      id: "layout",
      items: [
        {
          key: "layoutMode",
          type: "select",
          binding: { store: "settings", path: "appearance.layoutMode" },
          options: [
            { value: "default", labelKey: "settings.layoutMode.default" },
            { value: "sidebar-full", labelKey: "settings.layoutMode.sidebarFull" },
            { value: "floating", labelKey: "settings.layoutMode.floating" },
          ],
          defaultValue: "default",
        },
        {
          key: "routeTransition",
          type: "select",
          binding: { store: "settings", path: "appearance.routeTransition" },
          options: [
            { value: "none", labelKey: "settings.routeTransition.none" },
            { value: "fade", labelKey: "settings.routeTransition.fade" },
            { value: "slide", labelKey: "settings.routeTransition.slide" },
            { value: "zoom", labelKey: "settings.routeTransition.zoom" },
          ],
          defaultValue: "fade",
        },
        {
          key: "sidebarCollapsed",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarCollapsed" },
          defaultValue: false,
        },
        {
          key: "sidebarPlaylistCover",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarPlaylistCover" },
          defaultValue: false,
        },
        {
          key: "showQualitySwitch",
          type: "switch",
          binding: { store: "settings", path: "appearance.showQualitySwitch" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default appearanceCategory;
