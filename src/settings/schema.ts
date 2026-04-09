import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import DeviceSelector from "@/components/settings/custom/DeviceSelector.vue";
import IconLucideCog from "~icons/lucide/cog";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideMic2 from "~icons/lucide/mic-2";
import IconLucidePalette from "~icons/lucide/palette";
import IconLucideGlobe from "~icons/lucide/globe";

export const settingsSchema: SettingCategory[] = [
  {
    id: "general",
    icon: IconLucideCog,
    sections: [
      {
        id: "language",
        items: [
          {
            key: "language",
            type: "select",
            binding: { store: "settings", path: "locale" },
            options: [
              { value: "zh-CN", labelKey: "settings.language.zhCN" },
              { value: "en-US", labelKey: "settings.language.enUS" },
            ],
            defaultValue: "zh-CN",
          },
        ],
      },
      {
        id: "systemConfig",
        items: [
          {
            key: "rememberWindowState",
            type: "switch",
            binding: { store: "settings", path: "system.system.rememberWindowState" },
            defaultValue: true,
          },
          {
            key: "taskbarProgress",
            type: "switch",
            binding: { store: "settings", path: "system.system.taskbarProgress" },
            defaultValue: true,
          },
        ],
      },
    ],
  },
  {
    id: "player",
    icon: IconLucidePlay,
    sections: [
      {
        id: "playback",
        items: [
          {
            key: "playerBgType",
            type: "select",
            binding: { store: "settings", path: "player.playerBgType" },
            options: [
              { value: "blur", labelKey: "settings.playerBgType.blur" },
              { value: "solid", labelKey: "settings.playerBgType.solid" },
            ],
            defaultValue: "blur",
          },
          {
            key: "autoCenterCover",
            type: "switch",
            binding: { store: "settings", path: "player.autoCenterCover" },
            defaultValue: true,
          },
          {
            key: "followCoverColor",
            type: "switch",
            binding: { store: "settings", path: "player.followCoverColor" },
            defaultValue: true,
          },
        ],
      },
      {
        id: "playControl",
        items: [
          {
            key: "autoPlay",
            type: "switch",
            binding: { store: "settings", path: "system.player.autoPlay" },
            defaultValue: true,
          },
          {
            key: "rememberLastTrack",
            type: "switch",
            binding: { store: "settings", path: "system.player.rememberLastTrack" },
            defaultValue: false,
          },
          {
            key: "fadeEnabled",
            type: "switch",
            binding: { store: "settings", path: "system.player.fadeEnabled" },
            defaultValue: true,
            children: [
              {
                key: "fadeDuration",
                type: "slider",
                binding: { store: "settings", path: "system.player.fadeDuration" },
                min: 100,
                max: 600,
                step: 100,
                defaultValue: 200,
                marks: { 100: "100", 200: "200", 600: "600" },
              },
            ],
          },
          {
            key: "loudnessNormalization",
            type: "switch",
            binding: { store: "settings", path: "system.player.loudnessNormalization" },
            defaultValue: false,
          },
        ],
      },
      {
        id: "device",
        items: [
          {
            key: "outputDevice",
            type: "custom",
            component: DeviceSelector,
          },
        ],
      },
    ],
  },
  {
    id: "lyric",
    icon: IconLucideMic2,
    sections: [
      {
        id: "lyricGeneral",
        items: [
          {
            key: "lyricMode",
            type: "select",
            binding: { store: "settings", path: "lyric.lyricMode" },
            options: [
              { value: "effects", labelKey: "settings.lyricMode.effects" },
              { value: "simple", labelKey: "settings.lyricMode.simple" },
            ],
            defaultValue: "effects",
          },
          {
            key: "adaptiveFontSize",
            type: "switch",
            binding: { store: "settings", path: "lyric.adaptiveFontSize" },
            defaultValue: true,
          },
          {
            key: "fontSize",
            type: "slider",
            binding: { store: "settings", path: "lyric.fontSize" },
            min: 30,
            max: 64,
            step: 1,
            defaultValue: 48,
            marks: { 30: "30", 48: "48", 64: "64" },
          },
          {
            key: "fontWeight",
            type: "slider",
            binding: { store: "settings", path: "lyric.fontWeight" },
            min: 100,
            max: 900,
            step: 100,
            defaultValue: 700,
            marks: { 100: "100", 400: "400", 700: "700", 900: "900" },
          },
          {
            key: "showTranslation",
            type: "switch",
            binding: { store: "settings", path: "lyric.showTranslation" },
            defaultValue: true,
          },
          {
            key: "showRomanization",
            type: "switch",
            binding: { store: "settings", path: "lyric.showRomanization" },
            defaultValue: true,
          },
        ],
      },
      {
        id: "effectsDisplay",
        items: [
          {
            key: "enableWordHighlight",
            type: "switch",
            binding: { store: "settings", path: "lyric.enableWordHighlight" },
            defaultValue: true,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
          },
          {
            key: "enableFloatAnimation",
            type: "switch",
            binding: { store: "settings", path: "lyric.enableFloatAnimation" },
            defaultValue: false,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
          },
          {
            key: "enableEmphasizeEffect",
            type: "switch",
            binding: { store: "settings", path: "lyric.enableEmphasizeEffect" },
            defaultValue: false,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
          },
          {
            key: "enableBlur",
            type: "switch",
            binding: { store: "settings", path: "lyric.enableBlur" },
            defaultValue: false,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
          },
          {
            key: "hidePassedLines",
            type: "switch",
            binding: { store: "settings", path: "lyric.hidePassedLines" },
            defaultValue: false,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
          },
        ],
      },
      {
        id: "effectsSpring",
        items: [
          {
            key: "springPreset",
            type: "select",
            binding: { store: "settings", path: "lyric.springPreset" },
            options: [
              { value: "default", labelKey: "settings.springPreset.default" },
              { value: "smooth", labelKey: "settings.springPreset.smooth" },
              { value: "responsive", labelKey: "settings.springPreset.responsive" },
              { value: "jello", labelKey: "settings.springPreset.jello" },
              { value: "heavy", labelKey: "settings.springPreset.heavy" },
              { value: "noBounce", labelKey: "settings.springPreset.noBounce" },
              { value: "custom", labelKey: "settings.springPreset.custom" },
            ],
            defaultValue: "default",
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
            childrenCondition: () => useSettingsStore().lyric.springPreset === "custom",
            children: [
              {
                key: "springMass",
                type: "slider",
                binding: { store: "settings", path: "lyric.springMass" },
                min: 0.1,
                max: 5,
                step: 0.1,
                defaultValue: 0.9,
                marks: { 0.1: "0.1", 0.9: "0.9", 5: "5" },
              },
              {
                key: "springDamping",
                type: "slider",
                binding: { store: "settings", path: "lyric.springDamping" },
                min: 1,
                max: 50,
                step: 0.5,
                defaultValue: 15,
                marks: { 1: "1", 15: "15", 50: "50" },
              },
              {
                key: "springStiffness",
                type: "slider",
                binding: { store: "settings", path: "lyric.springStiffness" },
                min: 10,
                max: 300,
                step: 5,
                defaultValue: 90,
                marks: { 10: "10", 90: "90", 300: "300" },
              },
            ],
          },
        ],
      },
      {
        id: "effectsLayout",
        items: [
          {
            key: "alignPosition",
            type: "slider",
            binding: { store: "settings", path: "lyric.alignPosition" },
            min: 0.1,
            max: 0.9,
            step: 0.05,
            defaultValue: 0.35,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
            marks: { 0.1: "0.1", 0.35: "0.35", 0.9: "0.9" },
          },
          {
            key: "wordFadeWidth",
            type: "slider",
            binding: { store: "settings", path: "lyric.wordFadeWidth" },
            min: 0.1,
            max: 1,
            step: 0.1,
            defaultValue: 0.5,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
            marks: { 0.1: "0.1", 0.5: "0.5", 1: "1" },
          },
          {
            key: "inactiveAlpha",
            type: "slider",
            binding: { store: "settings", path: "lyric.inactiveAlpha" },
            min: 0,
            max: 1,
            step: 0.05,
            defaultValue: 0.2,
            disabled: () => useSettingsStore().lyric.lyricMode !== "effects",
            marks: { 0: "0", 0.2: "0.2", 1: "1" },
          },
        ],
      },
    ],
  },
  {
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
          },
          {
            key: "globalTint",
            type: "switch",
            binding: { store: "theme", path: "globalTint" },
            defaultValue: false,
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
        ],
      },
    ],
  },
  {
    id: "services",
    icon: IconLucideGlobe,
    sections: [
      {
        id: "media",
        items: [
          {
            key: "systemMediaControls",
            type: "switch",
            binding: { store: "settings", path: "system.media.systemMediaControls" },
            defaultValue: true,
          },
        ],
      },
      {
        id: "discord",
        items: [
          {
            key: "discordEnabled",
            type: "switch",
            binding: { store: "settings", path: "system.media.discord.enabled" },
            defaultValue: false,
            children: [
              {
                key: "discordShowWhenPaused",
                type: "switch",
                binding: { store: "settings", path: "system.media.discord.showWhenPaused" },
                defaultValue: false,
              },
              {
                key: "discordDisplayMode",
                type: "select",
                binding: { store: "settings", path: "system.media.discord.displayMode" },
                options: [
                  { value: "name", labelKey: "settings.discordDisplayMode.name" },
                  { value: "details", labelKey: "settings.discordDisplayMode.details" },
                  { value: "state", labelKey: "settings.discordDisplayMode.state" },
                ],
                defaultValue: "name",
              },
            ],
          },
        ],
      },
    ],
  },
];
