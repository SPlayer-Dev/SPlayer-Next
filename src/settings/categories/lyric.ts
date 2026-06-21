import type { SettingCategory } from "@/types/settings-schema";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { useSettingsStore } from "@/stores/settings";
import AmllDbServerConfig from "@/components/settings/custom/AmllDbServerConfig.vue";
import LocalLyricRepoConfig from "@/components/settings/custom/LocalLyricRepoConfig.vue";
import LyricSourceOrderConfig from "@/components/settings/custom/LyricSourceOrderConfig.vue";
import LyricFormatOrderConfig from "@/components/settings/custom/LyricFormatOrderConfig.vue";
import ExcludeLyricsConfig from "@/components/settings/custom/ExcludeLyricsConfig.vue";
import IconLucideMic2 from "~icons/lucide/mic-2";

/** 来源偏好选项：auto + 全部平台（来自平台总表）+ self */
const lyricSourcePreferenceOptions = [
  { value: "auto", labelKey: "settings.lyricSourcePreference.auto" },
  ...ALL_PLATFORMS.map((platform) => ({
    value: platform,
    labelKey: `settings.lyricSourcePreference.${platform}`,
  })),
  { value: "self", labelKey: "settings.lyricSourcePreference.self" },
];

const lyricCategory: SettingCategory = {
  id: "lyric",
  icon: IconLucideMic2,
  sections: [
    {
      id: "lyricContent",
      items: [
        {
          key: "lyricSourcePreference",
          type: "select",
          binding: { store: "settings", path: "lyric.lyricSourcePreference" },
          options: lyricSourcePreferenceOptions,
          defaultValue: "auto",
        },
        {
          key: "smartPreferOnline",
          type: "switch",
          binding: { store: "settings", path: "lyric.smartPreferOnline" },
          defaultValue: false,
          visible: () => useSettingsStore().lyric.lyricSourcePreference === "auto",
        },
        {
          key: "lyricSourceOrder",
          type: "custom",
          component: LyricSourceOrderConfig,
        },
        {
          key: "lyricFormatOrder",
          type: "custom",
          component: LyricFormatOrderConfig,
        },
      ],
    },
    {
      id: "lyricTTML",
      items: [
        {
          key: "enableOnlineTTMLLyric",
          type: "switch",
          binding: { store: "settings", path: "system.lyric.enableOnlineTTMLLyric" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
        {
          key: "amllDbServer",
          type: "custom",
          component: AmllDbServerConfig,
          binding: { store: "settings", path: "system.lyric.amllDbServer" },
          visible: () => useSettingsStore().system.lyric.enableOnlineTTMLLyric,
        },
        {
          key: "enableLocalTTMLOverride",
          type: "switch",
          binding: { store: "settings", path: "system.localLyric.enableLocalTTMLOverride" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
        {
          key: "localLyricRepoDir",
          type: "custom",
          component: LocalLyricRepoConfig,
          binding: { store: "settings", path: "system.localLyric.repoDir" },
          visible: () => useSettingsStore().system.localLyric.enableLocalTTMLOverride,
        },
      ],
    },
    {
      id: "lyricExclude",
      items: [
        {
          key: "enableExcludeLyrics",
          type: "switch",
          binding: { store: "settings", path: "lyric.enableExcludeLyrics" },
          defaultValue: true,
        },
        {
          key: "excludeLyricsRules",
          type: "custom",
          component: ExcludeLyricsConfig,
          visible: () => useSettingsStore().lyric.enableExcludeLyrics,
        },
      ],
    },
  ],
};

export default lyricCategory;
