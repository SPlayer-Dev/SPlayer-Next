import type { SettingCategory } from "@/types/settings-schema";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { useSettingsStore } from "@/stores/settings";
import AmllDbServerConfig from "@/components/settings/custom/AmllDbServerConfig.vue";
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
          childrenCondition: () => useSettingsStore().lyric.lyricSourcePreference === "auto",
          children: [
            {
              key: "smartPreferOnline",
              type: "switch",
              binding: { store: "settings", path: "lyric.smartPreferOnline" },
              defaultValue: false,
            },
          ],
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
        {
          key: "enableOnlineTTMLLyric",
          type: "switch",
          binding: { store: "settings", path: "system.lyric.enableOnlineTTMLLyric" },
          defaultValue: false,
          tag: { text: "Beta" },
          children: [
            {
              key: "amllDbServer",
              type: "custom",
              component: AmllDbServerConfig,
              binding: { store: "settings", path: "system.lyric.amllDbServer" },
            },
          ],
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
          children: [
            {
              key: "excludeLyricsRules",
              type: "custom",
              component: ExcludeLyricsConfig,
            },
          ],
        },
      ],
    },
    {
      id: "lyricGeneral",
      items: [
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
      id: "lyricDisplay",
      items: [
        {
          key: "enableWordHighlight",
          type: "switch",
          binding: { store: "settings", path: "lyric.enableWordHighlight" },
          defaultValue: true,
        },
        {
          key: "enableFloatAnimation",
          type: "switch",
          binding: { store: "settings", path: "lyric.enableFloatAnimation" },
          defaultValue: false,
        },
        {
          key: "enableEmphasizeEffect",
          type: "switch",
          binding: { store: "settings", path: "lyric.enableEmphasizeEffect" },
          defaultValue: false,
        },
        {
          key: "enableBlur",
          type: "switch",
          binding: { store: "settings", path: "lyric.enableBlur" },
          defaultValue: false,
        },
        {
          key: "hidePassedLines",
          type: "switch",
          binding: { store: "settings", path: "lyric.hidePassedLines" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "lyricSpring",
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
      id: "lyricLayout",
      items: [
        {
          key: "alignPosition",
          type: "slider",
          binding: { store: "settings", path: "lyric.alignPosition" },
          min: 0.1,
          max: 0.9,
          step: 0.05,
          defaultValue: 0.35,
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
          marks: { 0: "0", 0.2: "0.2", 1: "1" },
        },
      ],
    },
  ],
};

export default lyricCategory;
