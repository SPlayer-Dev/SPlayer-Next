import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import PlatformAccount from "@/components/settings/custom/PlatformAccount.vue";
import IconLucideSettings from "~icons/lucide/settings";

const otherCategory: SettingCategory = {
  id: "other",
  icon: IconLucideSettings,
  sections: [
    {
      id: "platformLogin",
      tag: { text: "Beta" },
      items: [
        {
          key: "qmAccount",
          type: "custom",
          component: PlatformAccount,
          componentProps: { platform: "qqmusic" },
          fullWidth: true,
          keywords: [
            "settings.platformLogin.title",
            "settings.platformLogin.desc",
            "settings.platformLogin.loginWeb",
            "settings.platformLogin.manualCookie",
          ],
        },
        {
          key: "kgAccount",
          type: "custom",
          component: PlatformAccount,
          componentProps: { platform: "kugou" },
          fullWidth: true,
          keywords: [
            "settings.platformLogin.title",
            "settings.platformLogin.desc",
            "settings.platformLogin.loginQr",
            "settings.platformLogin.manualCookie",
          ],
        },
      ],
    },
    {
      id: "platformConfig",
      tag: { text: "Beta" },
      items: [
        {
          key: "kugouLoginVersion",
          type: "select",
          binding: { store: "settings", path: "system.system.kugouLoginVersion" },
          options: [
            { value: "standard", labelKey: "settings.kugouLoginVersion.standard" },
            { value: "concept", labelKey: "settings.kugouLoginVersion.concept" },
          ],
          defaultValue: "standard",
          confirm: {
            titleKey: "settings.confirm.kugouLoginVersionTitle",
            contentKey: "settings.confirm.kugouLoginVersionContent",
            type: "warning",
          },
        },
      ],
    },
    {
      id: "preset",
      items: [
        {
          key: "fuckDjMode",
          type: "switch",
          binding: { store: "settings", path: "preset.fuckDjMode" },
          defaultValue: false,
        },
        {
          key: "uncensorProfanity",
          type: "switch",
          binding: { store: "settings", path: "preset.uncensorProfanity" },
          defaultValue: false,
        },
        {
          key: "hideVipTag",
          type: "switch",
          binding: { store: "settings", path: "preset.hideVipTag" },
          defaultValue: false,
        },
        {
          key: "hideQualityTag",
          type: "switch",
          binding: { store: "settings", path: "preset.hideQualityTag" },
          defaultValue: false,
        },
        {
          key: "showSubtitle",
          type: "switch",
          binding: { store: "settings", path: "preset.showSubtitle" },
          defaultValue: true,
        },
        {
          key: "noPinyin",
          type: "switch",
          binding: { store: "settings", path: "preset.noPinyin" },
          defaultValue: false,
          visible: () => useSettingsStore().locale.startsWith("zh"),
        },
      ],
    },
  ],
};

export default otherCategory;
