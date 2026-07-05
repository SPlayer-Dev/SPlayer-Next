import type { SettingCategory } from "@/types/settings-schema";
import IconLucideSettings from "~icons/lucide/settings";

const otherCategory: SettingCategory = {
  id: "other",
  icon: IconLucideSettings,
  sections: [
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
      ],
    },
  ],
};

export default otherCategory;
