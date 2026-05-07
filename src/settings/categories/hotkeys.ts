import type { SettingCategory } from "@/types/settings-schema";
import HotkeyConfig from "@/components/settings/custom/HotkeyConfig.vue";
import IconLucideKeyboard from "~icons/lucide/keyboard";

const hotkeysCategory: SettingCategory = {
  id: "hotkeys",
  icon: IconLucideKeyboard,
  sections: [
    {
      id: "hotkeys",
      items: [
        {
          key: "hotkeys",
          type: "custom",
          component: HotkeyConfig,
          fullWidth: true,
        },
      ],
    },
  ],
};

export default hotkeysCategory;
