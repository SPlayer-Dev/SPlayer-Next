import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import FontConfig from "@/components/settings/custom/FontConfig.vue";
import BackgroundImagePicker from "@/components/settings/custom/BackgroundImagePicker.vue";
import SidebarCustomizeConfig from "@/components/settings/custom/SidebarCustomizeConfig.vue";
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
          key: "sidebarCustomize",
          type: "custom",
          component: SidebarCustomizeConfig,
        },
        {
          key: "showStatsInSidebar",
          type: "switch",
          binding: { store: "settings", path: "appearance.showStatsInSidebar" },
          defaultValue: true,
        },
        {
          key: "showQualitySwitch",
          type: "switch",
          binding: { store: "settings", path: "appearance.showQualitySwitch" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "playerBar",
      items: [
        {
          key: "showLyricInBar",
          type: "switch",
          binding: { store: "settings", path: "player.showLyricInBar" },
          defaultValue: true,
        },
        {
          key: "showProgressTooltip",
          type: "switch",
          binding: { store: "settings", path: "player.showProgressTooltip" },
          defaultValue: true,
          children: [
            {
              key: "showProgressLyric",
              type: "switch",
              binding: { store: "settings", path: "player.showProgressLyric" },
              defaultValue: false,
            },
          ],
        },
        {
          key: "snapToLyric",
          type: "switch",
          binding: { store: "settings", path: "player.snapToLyric" },
          defaultValue: false,
        },
        {
          key: "timeFormat",
          type: "select",
          binding: { store: "settings", path: "player.timeFormat" },
          options: [
            { value: "current-total", labelKey: "settings.timeFormat.currentTotal" },
            { value: "remaining-total", labelKey: "settings.timeFormat.remainingTotal" },
            { value: "current-remaining", labelKey: "settings.timeFormat.currentRemaining" },
          ],
          defaultValue: "current-total",
          descriptionKey: "settings.timeFormat.description",
        },
      ],
    },
    {
      id: "nowPlaying",
      items: [
        {
          key: "playerBgType",
          type: "select",
          binding: { store: "settings", path: "player.playerBgType" },
          options: [
            { value: "blur", labelKey: "settings.playerBgType.blur" },
            { value: "solid", labelKey: "settings.playerBgType.solid" },
            { value: "animation", labelKey: "settings.playerBgType.animation" },
          ],
          defaultValue: "blur",
          confirm: {
            when: (next) => next === "animation",
            titleKey: "settings.confirm.highResourceTitle",
            contentKey: "settings.confirm.highResourceContent",
            type: "warning",
          },
          childrenCondition: () => useSettingsStore().player.playerBgType === "animation",
          hideChildren: true,
          children: [
            {
              key: "playerBgFlowSpeed",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFlowSpeed" },
              min: 0.1,
              max: 10,
              step: 0.1,
              defaultValue: 4,
              marks: { 0.1: "0.1", 4: "4", 10: "10" },
            },
            {
              key: "playerBgRenderScale",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgRenderScale" },
              min: 0.5,
              max: 2,
              step: 0.1,
              defaultValue: 0.5,
              marks: { 0.5: "0.5", 1: "1", 2: "2" },
            },
            {
              key: "playerBgFps",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFps" },
              min: 24,
              max: 120,
              step: 2,
              defaultValue: 30,
              marks: { 24: "24", 60: "60", 120: "120" },
            },
            {
              key: "playerBgFreezeOnPause",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgFreezeOnPause" },
              defaultValue: false,
            },
            {
              key: "playerBgBeat",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgBeat" },
              defaultValue: false,
            },
          ],
        },
        {
          key: "coverLayout",
          type: "select",
          binding: { store: "settings", path: "player.coverLayout" },
          options: [
            { value: "default", labelKey: "settings.coverLayout.default" },
            { value: "fullscreen", labelKey: "settings.coverLayout.fullscreen" },
          ],
          defaultValue: "default",
        },
        {
          key: "coverLyricRatio",
          type: "slider",
          binding: { store: "settings", path: "player.coverLyricRatio" },
          min: 0.3,
          max: 0.6,
          step: 0.05,
          defaultValue: 0.45,
          marks: { 0.3: "30%", 0.45: "45%", 0.6: "60%" },
        },
        {
          key: "autoCenterCover",
          type: "switch",
          binding: { store: "settings", path: "player.autoCenterCover" },
          defaultValue: true,
        },
        {
          key: "showPlaybackSource",
          type: "switch",
          binding: { store: "settings", path: "player.showPlaybackSource" },
          defaultValue: false,
        },
        {
          key: "followCoverColor",
          type: "switch",
          binding: { store: "settings", path: "player.followCoverColor" },
          defaultValue: true,
        },
        {
          key: "autoImmersive",
          type: "switch",
          binding: { store: "settings", path: "player.autoImmersive" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default appearanceCategory;
